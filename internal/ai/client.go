package ai

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"stream-tribunal/internal/config"
)

type Client struct {
	cfg        config.AIConfig
	httpClient *http.Client
	endpoint   string
	isMock     bool
}

type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ChatCompletionRequest struct {
	Model       string        `json:"model"`
	Messages    []ChatMessage `json:"messages"`
	Temperature float64       `json:"temperature"`
	Stream      bool          `json:"stream"`
}

type StreamChunk struct {
	Choices []struct {
		Delta struct {
			Content string `json:"content"`
		} `json:"delta"`
		FinishReason *string `json:"finish_reason"`
	} `json:"choices"`
}

func NewClient(cfg config.AIConfig) *Client {
	endpoint := "https://api.groq.com/openai/v1/chat/completions"
	switch cfg.Provider {
	case "cerebras":
		endpoint = "https://api.cerebras.ai/v1/chat/completions"
	case "ollama":
		endpoint = "http://localhost:11434/v1/chat/completions"
	}

	client := &Client{
		cfg:      cfg,
		endpoint: endpoint,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		isMock: cfg.APIKey == "" && cfg.Provider != "ollama",
	}

	return client
}

func (c *Client) StreamCompletion(ctx context.Context, messages []ChatMessage, onDelta func(string) error) error {
	if c.isMock {
		return c.simulateStream(ctx, onDelta)
	}

	reqBody := ChatCompletionRequest{
		Model:       c.cfg.Model,
		Messages:    messages,
		Temperature: c.cfg.Temperature,
		Stream:      true,
	}

	raw, err := json.Marshal(reqBody)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(raw))
	if err != nil {
		return err
	}

	req.Header.Set("Content-Type", "application/json")
	if c.cfg.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.cfg.APIKey)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("ai api request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("ai api returned status %d: %s", resp.StatusCode, string(body))
	}

	reader := bufio.NewReader(resp.Body)
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			if err == io.EOF {
				break
			}
			return err
		}

		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "data: ") {
			continue
		}

		payload := strings.TrimPrefix(line, "data: ")
		if payload == "[DONE]" {
			break
		}

		var chunk StreamChunk
		if err := json.Unmarshal([]byte(payload), &chunk); err != nil {
			continue
		}

		if len(chunk.Choices) > 0 && chunk.Choices[0].Delta.Content != "" {
			if err := onDelta(chunk.Choices[0].Delta.Content); err != nil {
				return err
			}
		}
	}

	return nil
}

func (c *Client) simulateStream(ctx context.Context, onDelta func(string) error) error {
	mockPhrases := []string{
		"[slam] Суд слушает дело номер 404! ",
		"Подсудимый обвиняется в вопиющем нарушении законов здравого смысла. ",
		"Прицел смотрел в потолок, а граната отскочила прямо в товарища по команде! ",
		"[objection] Защита пытается все свалить на кота, но улики неумолимы! ",
		"Присяжные, приготовьтесь вынести свой суровый вердикт.",
	}

	for _, phrase := range mockPhrases {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(120 * time.Millisecond):
			words := strings.Split(phrase, " ")
			for _, word := range words {
				if err := onDelta(word + " "); err != nil {
					return err
				}
				time.Sleep(30 * time.Millisecond)
			}
		}
	}
	return nil
}

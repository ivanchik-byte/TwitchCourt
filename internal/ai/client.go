package ai

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
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
	mockLines  []string
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

func NewClient(cfg config.AIConfig) (*Client, error) {
	endpoint, err := ResolveEndpoint(cfg.Provider, cfg.BaseURL)
	if err != nil {
		return nil, err
	}

	client := &Client{
		cfg:        cfg,
		endpoint:   endpoint,
		httpClient: &http.Client{Timeout: 90 * time.Second},
		isMock:     cfg.APIKey == "" && strings.TrimSpace(cfg.BaseURL) == "" && cfg.Provider != "ollama",
		mockLines:  append([]string(nil), cfg.MockLines...),
	}
	if client.isMock {
		log.Printf("AI mock mode active (no API key): verdicts use canned phrases, not a model")
	}

	return client, nil
}

// ResolveEndpoint resolves the chat-completions URL: explicit base_url
// wins, then known providers, otherwise an error (never a silent default).
func ResolveEndpoint(provider, baseURL string) (string, error) {
	if strings.TrimSpace(baseURL) != "" {
		base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
		if strings.HasSuffix(base, "/chat/completions") {
			return base, nil
		}
		if strings.HasSuffix(base, "/v1") {
			return base + "/chat/completions", nil
		}
		return base + "/v1/chat/completions", nil
	}
	switch provider {
	case "cerebras":
		return "https://api.cerebras.ai/v1/chat/completions", nil
	case "ollama":
		return "http://localhost:11434/v1/chat/completions", nil
	case "groq", "":
		return "https://api.groq.com/openai/v1/chat/completions", nil
	default:
		return "", fmt.Errorf("unknown provider %q without base_url", provider)
	}
}

// mergeExtraBody injects router params into the request root.
// Standard fields always win on conflict.
func mergeExtraBody(raw []byte, extra map[string]any) ([]byte, error) {
	if len(extra) == 0 {
		return raw, nil
	}
	var body map[string]any
	if err := json.Unmarshal(raw, &body); err != nil {
		return nil, err
	}
	for k, v := range extra {
		if _, taken := body[k]; !taken {
			body[k] = v
		}
	}
	return json.Marshal(body)
}

// IsMock reports whether completions are simulated locally.
func (c *Client) IsMock() bool {
	return c == nil || c.isMock
}

func (c *Client) StreamCompletion(ctx context.Context, messages []ChatMessage, onDelta func(string) error) error {
	if c.isMock {
		return c.simulateStream(ctx, onDelta)
	}
	if !c.cfg.Stream {
		return c.singleCompletion(ctx, messages, onDelta)
	}

	// bound every completion: caller cancel (panic button) still wins
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

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
	raw, err = mergeExtraBody(raw, c.cfg.ExtraBody)
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

// singleCompletion is the non-streaming fallback for providers without SSE
func (c *Client) singleCompletion(ctx context.Context, messages []ChatMessage, onDelta func(string) error) error {
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	raw, err := json.Marshal(ChatCompletionRequest{
		Model:       c.cfg.Model,
		Messages:    messages,
		Temperature: c.cfg.Temperature,
		Stream:      false,
	})
	if err != nil {
		return err
	}
	raw, err = mergeExtraBody(raw, c.cfg.ExtraBody)
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

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("ai api returned status %d: %s", resp.StatusCode, string(body))
	}

	var done struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(body, &done); err != nil {
		return err
	}
	if len(done.Choices) == 0 {
		return fmt.Errorf("ai api returned no choices")
	}
	return onDelta(done.Choices[0].Message.Content)
}

func (c *Client) simulateStream(ctx context.Context, onDelta func(string) error) error {
	for _, phrase := range c.mockLines {
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

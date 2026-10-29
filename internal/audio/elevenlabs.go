package audio

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

type ElevenLabs struct {
	key, voice, model, delivery string
	endpoint                    string
	client                      *http.Client
}

func NewElevenLabs(key, voice, model, delivery string) *ElevenLabs {
	if model == "" {
		model = "eleven_multilingual_v2"
	}
	return &ElevenLabs{key: key, voice: voice, model: model, delivery: delivery, endpoint: "https://api.elevenlabs.io", client: &http.Client{Timeout: 30 * time.Second}}
}

func (s *ElevenLabs) Synthesize(ctx context.Context, text string) ([]byte, error) {
	if s.key == "" || s.voice == "" {
		return nil, errors.New("elevenlabs: укажите API-ключ и Voice ID")
	}
	settings := map[string]any{"stability": 0.5, "similarity_boost": 0.75}
	if s.delivery == "restrained" {
		settings["stability"] = 0.8
	}
	if s.delivery == "expressive" {
		settings["stability"] = 0.35
	}
	if s.model == "eleven_v3" {
		settings = map[string]any{"stability": 0.5}
		if s.delivery == "restrained" {
			settings["stability"] = 1.0
		}
		if s.delivery == "expressive" {
			settings["stability"] = 0.0
			text = "[curious] " + text
		}
	}
	body, err := json.Marshal(map[string]any{"text": text, "model_id": s.model, "voice_settings": settings})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.endpoint+"/v1/text-to-speech/"+url.PathEscape(s.voice)+"?output_format=mp3_44100_128", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("xi-api-key", s.key)
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, errors.New("elevenlabs: нет связи с сервисом")
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusOK:
	case 401, 403:
		return nil, errors.New("elevenlabs: проверьте API-ключ, доступ к голосу и разрешение Text to Speech")
	case 429:
		return nil, errors.New("elevenlabs: исчерпана квота или превышен лимит запросов")
	case 404:
		return nil, errors.New("elevenlabs: голос не найден, проверьте Voice ID")
	default:
		return nil, fmt.Errorf("elevenlabs: сервис вернул HTTP %d", resp.StatusCode)
	}
	clip, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20+1))
	if err != nil {
		return nil, err
	}
	if len(clip) < 100 || len(clip) > 8<<20 {
		return nil, errors.New("elevenlabs: получен пустой или слишком большой аудиофайл")
	}
	return clip, nil
}

func (s *ElevenLabs) Close() error { return nil }

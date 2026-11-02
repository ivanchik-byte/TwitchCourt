package bot

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
)

var ErrModerationNotConfigured = errors.New("Для модерации задайте Twitch OAuth, Client ID и ID стримера. Токену нужно право moderator:manage:banned_users.")

func helixModerationError(status int) error {
	switch status {
	case 401, 403:
		return errors.New("Twitch отказал: проверьте токен, права moderator:manage:banned_users и ID модератора.")
	case 429:
		return errors.New("Twitch ограничил частоту действий. Повторите позже.")
	case 400, 409:
		return errors.New("Twitch не применил действие: проверьте состояние бана и права на этого участника.")
	default:
		return fmt.Errorf("Twitch вернул HTTP %d. Действие не подтверждено.", status)
	}
}

func (c *UnbanClient) Moderate(ctx context.Context, login, action string, seconds int, reason string) error {
	if !c.configured() {
		return ErrModerationNotConfigured
	}
	query := url.Values{"login": {login}}
	lookup, err := http.NewRequestWithContext(ctx, http.MethodGet, c.apiBase+"/users?"+query.Encode(), nil)
	if err != nil {
		return err
	}
	c.headers(lookup)
	response, err := c.http.Do(lookup)
	if err != nil {
		return errors.New("Нет связи с Twitch. Действие не подтверждено.")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return helixModerationError(response.StatusCode)
	}
	var users struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if json.NewDecoder(io.LimitReader(response.Body, 65536)).Decode(&users) != nil || len(users.Data) != 1 || users.Data[0].ID == "" {
		return errors.New("Twitch не нашёл участника по этому нику.")
	}
	query = url.Values{"broadcaster_id": {c.broadcasterID}, "moderator_id": {c.moderatorID}}
	method := http.MethodPost
	var body *bytes.Reader
	switch action {
	case "pardon":
		method = http.MethodDelete
		query.Set("user_id", users.Data[0].ID)
		body = bytes.NewReader(nil)
	case "ban", "timeout":
		fields := map[string]any{"user_id": users.Data[0].ID, "reason": string([]rune(reason)[:min(len([]rune(reason)), 500)])}
		if action == "timeout" {
			fields["duration"] = max(1, min(seconds, 1209600))
		}
		raw, _ := json.Marshal(map[string]any{"data": fields})
		body = bytes.NewReader(raw)
	default:
		return errors.New("Неизвестное действие модерации.")
	}
	request, err := http.NewRequestWithContext(ctx, method, c.apiBase+"/moderation/bans?"+query.Encode(), body)
	if err != nil {
		return err
	}
	c.headers(request)
	request.Header.Set("Content-Type", "application/json")
	reply, err := c.http.Do(request)
	if err != nil {
		return errors.New("Нет связи с Twitch. Действие не подтверждено.")
	}
	defer reply.Body.Close()
	want := http.StatusOK
	if method == http.MethodDelete {
		want = http.StatusNoContent
	}
	if reply.StatusCode != want {
		return helixModerationError(reply.StatusCode)
	}
	return nil
}

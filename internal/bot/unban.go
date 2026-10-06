package bot

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"
)

// UnbanRequest is a pardon appeal awaiting the streamer's verdict.
type UnbanRequest struct {
	ID        string `json:"id"`
	UserID    string `json:"user_id"`
	UserLogin string `json:"user_login"`
	UserName  string `json:"user"`
	Text      string `json:"text"`
	CreatedAt string `json:"created_at"`
}

// UnbanClient manages Twitch unban requests via Helix API.
type UnbanClient struct {
	token         string
	clientID      string
	broadcasterID string
	moderatorID   string
	apiBase       string
	http          *http.Client
}

func NewUnbanClient(token, clientID, broadcasterID, moderatorID string) *UnbanClient {
	if moderatorID == "" {
		moderatorID = broadcasterID
	}
	return &UnbanClient{
		token:         token,
		clientID:      clientID,
		broadcasterID: broadcasterID,
		moderatorID:   moderatorID,
		apiBase:       "https://api.twitch.tv/helix",
		http:          &http.Client{Timeout: 10 * time.Second},
	}
}

func (c *UnbanClient) configured() bool {
	return c.token != "" && c.clientID != "" && c.broadcasterID != ""
}

func (c *UnbanClient) headers(req *http.Request) {
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Client-Id", c.clientID)
}

// FetchPending returns appeals awaiting a verdict.
func (c *UnbanClient) FetchPending(ctx context.Context) ([]UnbanRequest, error) {
	if !c.configured() {
		return nil, fmt.Errorf("unban court not configured")
	}
	query := url.Values{}
	query.Set("broadcaster_id", c.broadcasterID)
	query.Set("moderator_id", c.moderatorID)
	query.Set("status", "pending")
	query.Set("first", "20")
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		c.apiBase+"/moderation/unban_requests?"+query.Encode(), nil)
	if err != nil {
		return nil, err
	}
	c.headers(req)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("helix unban list status %d", resp.StatusCode)
	}
	var envelope struct {
		Data []struct {
			ID        string `json:"id"`
			UserID    string `json:"user_id"`
			UserLogin string `json:"user_login"`
			UserName  string `json:"user_name"`
			Text      string `json:"text"`
			CreatedAt string `json:"created_at"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		return nil, err
	}
	out := make([]UnbanRequest, 0, len(envelope.Data))
	for _, item := range envelope.Data {
		name := item.UserName
		if name == "" {
			name = item.UserLogin
		}
		out = append(out, UnbanRequest{
			ID:        item.ID,
			UserID:    item.UserID,
			UserLogin: item.UserLogin,
			UserName:  name,
			Text:      item.Text,
			CreatedAt: item.CreatedAt,
		})
	}
	return out, nil
}

// Resolve approves or denies one appeal; the verdict lands on Twitch at once.
func (c *UnbanClient) Resolve(ctx context.Context, id string, approve bool, resolutionText string) error {
	if !c.configured() {
		return fmt.Errorf("unban court not configured")
	}
	if id == "" {
		return fmt.Errorf("empty unban request id")
	}
	status := "denied"
	if approve {
		status = "approved"
	}
	query := url.Values{}
	query.Set("broadcaster_id", c.broadcasterID)
	query.Set("moderator_id", c.moderatorID)
	query.Set("unban_request_id", id)
	query.Set("status", status)
	if resolutionText != "" {
		query.Set("resolution_text", resolutionText)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPatch,
		c.apiBase+"/moderation/unban_requests?"+query.Encode(), nil)
	if err != nil {
		return err
	}
	c.headers(req)
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("helix unban resolve status %d", resp.StatusCode)
	}
	return nil
}

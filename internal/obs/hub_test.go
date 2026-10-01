package obs

import "testing"
import "time"

func TestBroadcastWithoutClients(t *testing.T) {
	h := NewHub(nil)
	go h.Run()

	for i := 0; i < 200; i++ {
		done := make(chan error, 1)
		go func() {
			done <- h.BroadcastEvent(EventSubtitles, SubtitlesPayload{Speaker: "s", Text: "t"})
		}()
		select {
		case err := <-done:
			if err != nil {
				t.Fatalf("broadcast failed: %v", err)
			}
		case <-time.After(time.Second):
			t.Fatal("broadcast blocked with no clients")
		}
	}
}

func TestSlowClientDropped(t *testing.T) {
	h := NewHub(nil)
	go h.Run()

	stuck := &Client{hub: h, send: make(chan []byte)}
	h.register <- stuck
	time.Sleep(50 * time.Millisecond)

	for i := 0; i < 80; i++ {
		_ = h.BroadcastEvent(EventPanic, map[string]string{"status": "muted"})
	}
	time.Sleep(100 * time.Millisecond)

	h.mu.RLock()
	_, alive := h.clients[stuck]
	h.mu.RUnlock()
	if alive {
		t.Fatal("slow client should have been dropped")
	}
}

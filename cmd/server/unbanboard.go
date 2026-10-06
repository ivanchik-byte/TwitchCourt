package main

import (
	"context"
	"log"
	"sync"
	"time"

	"stream-tribunal/internal/bot"
)

// unbanBoard caches pending pardon appeals between Helix polls
type unbanBoard struct {
	mu    sync.Mutex
	items []bot.UnbanRequest
}

func newUnbanBoard() *unbanBoard {
	return &unbanBoard{}
}

func (b *unbanBoard) list() []bot.UnbanRequest {
	b.mu.Lock()
	defer b.mu.Unlock()
	out := make([]bot.UnbanRequest, len(b.items))
	copy(out, b.items)
	return out
}

func (b *unbanBoard) refresh(ctx context.Context, court *bot.UnbanClient) {
	items, err := court.FetchPending(ctx)
	if err != nil {
		log.Printf("unban court refresh: %v", err)
		return
	}
	b.mu.Lock()
	b.items = items
	b.mu.Unlock()
}

func (b *unbanBoard) watch(ctx context.Context, court *bot.UnbanClient) {
	b.refresh(ctx, court)
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			b.refresh(ctx, court)
		}
	}
}

package ai

import (
	"strings"
	"testing"
)

func TestSentenceChunker(t *testing.T) {
	chunker := NewSentenceChunker()

	chunks := chunker.Feed("[slam] Привет всем! ")
	if len(chunks) != 1 {
		t.Fatalf("expected 1 chunk, got %d", len(chunks))
	}
	if chunks[0].Animation != "slam" {
		t.Errorf("expected animation 'slam', got '%s'", chunks[0].Animation)
	}
	if chunks[0].Text != "Привет всем!" {
		t.Errorf("expected text 'Привет всем!', got '%s'", chunks[0].Text)
	}

	chunks = chunker.Feed("[objection] Это ложь! Вы ")
	if len(chunks) != 1 {
		t.Fatalf("expected 1 chunk, got %d", len(chunks))
	}
	if chunks[0].Animation != "objection" {
		t.Errorf("expected animation 'objection', got '%s'", chunks[0].Animation)
	}
	if chunks[0].Text != "Это ложь!" {
		t.Errorf("expected text 'Это ложь!', got '%s'", chunks[0].Text)
	}

	chunks = chunker.Feed("не стреляли в птиц.")
	if len(chunks) != 1 {
		t.Fatalf("expected 1 chunk, got %d", len(chunks))
	}
	if chunks[0].Text != "Вы не стреляли в птиц." {
		t.Errorf("expected text 'Вы не стреляли в птиц.', got '%s'", chunks[0].Text)
	}

	chunks = chunker.Feed("И вообще")
	if len(chunks) != 0 {
		t.Errorf("expected 0 chunks from incomplete sentence, got %d", len(chunks))
	}

	last := chunker.Flush()
	if last == nil {
		t.Fatal("expected flushed chunk, got nil")
	}
	if last.Text != "И вообще" {
		t.Errorf("expected 'И вообще', got '%s'", last.Text)
	}
}

func TestPhaseChunkerBansObjection(t *testing.T) {
	chunker := NewPhaseChunker("objection")

	chunks := chunker.Feed("[objection] Ты виновен! ")
	if len(chunks) != 1 {
		t.Fatalf("expected 1 chunk, got %d", len(chunks))
	}
	if chunks[0].Animation == "objection" {
		t.Errorf("banned tag leaked into animation: %q", chunks[0].Animation)
	}
	if strings.Contains(chunks[0].Text, "[objection]") {
		t.Errorf("banned tag leaked into text: %q", chunks[0].Text)
	}

	chunks = chunker.Feed("[slam] Слушай сюда! ")
	if len(chunks) != 1 || chunks[0].Animation != "slam" {
		t.Fatalf("allowed tag must pass, got %+v", chunks)
	}
}

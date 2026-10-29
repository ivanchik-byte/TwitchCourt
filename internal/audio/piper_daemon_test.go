package audio

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"stream-tribunal/internal/config"
)

func TestPiperUsesCompletedWavAndNeverMocksMissingFiles(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture")
	}
	dir := t.TempDir()
	expected := append([]byte("RIFF"), make([]byte, 100)...)
	for name, content := range map[string][]byte{"voice.onnx": {}, "voice.onnx.json": {}, "fixture.wav": expected} {
		if err := os.WriteFile(filepath.Join(dir, name), content, 0600); err != nil {
			t.Fatal(err)
		}
	}
	script := filepath.Join(dir, "piper")
	if err := os.WriteFile(script, []byte("#!/bin/sh\nwhile [ $# -gt 0 ]; do\n  if [ \"$1\" = --output_file ]; then shift; output=$1; fi\n  shift\ndone\ncat >/dev/null\ncp \"$(dirname \"$0\")/fixture.wav\" \"$output\"\n"), 0700); err != nil {
		t.Fatal(err)
	}
	cfg := config.TTSConfig{Enabled: true, PiperBinary: script, ModelPath: filepath.Join(dir, "voice.onnx"), ConfigPath: filepath.Join(dir, "voice.onnx.json"), Speed: 1.15}
	voice, _ := NewPiperDaemon(cfg)
	clip, err := voice.Synthesize(context.Background(), "Суд слушает.")
	if err != nil || !bytes.Equal(clip, expected) {
		t.Fatal("did not read completed WAV", err)
	}
	voice.Close()
	if _, err := voice.Synthesize(context.Background(), "hello"); err == nil {
		t.Fatal("closed voice still runs")
	}
	cfg.PiperBinary = filepath.Join(dir, "missing")
	missing, _ := NewPiperDaemon(cfg)
	if clip, err := missing.Synthesize(context.Background(), "hello"); err == nil || len(clip) != 0 {
		t.Fatal("missing Piper was silently replaced with beep")
	}
}

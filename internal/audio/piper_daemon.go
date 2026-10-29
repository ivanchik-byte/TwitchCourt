package audio

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"math"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"

	"stream-tribunal/internal/config"
)

type PiperDaemon struct {
	cfg     config.TTSConfig
	sem     chan struct{}
	mu      sync.Mutex
	cancel  context.CancelFunc
	closed  bool
	problem error
}

func NewPiperDaemon(cfg config.TTSConfig) (*PiperDaemon, error) {
	p := &PiperDaemon{cfg: cfg, sem: make(chan struct{}, 1)}
	if !cfg.Enabled {
		return p, nil
	}
	if _, err := exec.LookPath(cfg.PiperBinary); err != nil {
		p.problem = errors.New("Piper: не найден исполняемый файл, проверьте путь к Piper")
	} else if _, err := os.Stat(cfg.ModelPath); err != nil {
		p.problem = errors.New("Piper: не найден файл модели .onnx")
	} else if _, err := os.Stat(cfg.ConfigPath); err != nil {
		p.problem = errors.New("Piper: не найден конфиг модели .onnx.json")
	}
	return p, nil
}

func (p *PiperDaemon) IsMock() bool { return !p.cfg.Enabled }

func (p *PiperDaemon) Synthesize(ctx context.Context, text string) ([]byte, error) {
	if strings.TrimSpace(text) == "" {
		return nil, nil
	}
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case p.sem <- struct{}{}:
	}
	defer func() { <-p.sem }()
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return nil, errors.New("Piper: движок остановлен")
	}
	runCtx, cancel := context.WithCancel(ctx)
	p.cancel = cancel
	p.mu.Unlock()
	defer cancel()
	if !p.cfg.Enabled {
		return generateMockBeepWav(text)
	}
	if p.problem != nil {
		return nil, p.problem
	}
	output, err := os.CreateTemp("", "tribunal-piper-*.wav")
	if err != nil {
		return nil, err
	}
	output.Close()
	defer os.Remove(output.Name())
	speed := p.cfg.Speed
	if speed <= 0 {
		speed = 1
	}
	cmd := exec.CommandContext(runCtx, p.cfg.PiperBinary, "--model", p.cfg.ModelPath,
		"--config", p.cfg.ConfigPath, "--output_file", output.Name(),
		"--speaker", strconv.Itoa(p.cfg.SpeakerID), "--length_scale", strconv.FormatFloat(1/speed, 'f', 3, 64))
	cmd.Stdin = strings.NewReader(text + "\n")
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("Piper не смог синтезировать речь: %w", err)
	}
	stat, err := os.Stat(output.Name())
	if err != nil {
		return nil, err
	}
	if stat.Size() > 8<<20 {
		return nil, errors.New("Piper: слишком большой аудиофайл")
	}
	clip, err := os.ReadFile(output.Name())
	if err != nil {
		return nil, err
	}
	if len(clip) < 44 || !bytes.HasPrefix(clip, []byte("RIFF")) {
		return nil, errors.New("Piper: получен некорректный WAV")
	}
	return clip, nil
}

func (p *PiperDaemon) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.closed = true
	if p.cancel != nil {
		p.cancel()
	}
	return nil
}

func generateMockBeepWav(text string) ([]byte, error) {
	sampleRate := 22050
	durationSeconds := float64(len([]rune(text))) * 0.05
	if durationSeconds < 0.4 {
		durationSeconds = 0.4
	}
	if durationSeconds > 3.0 {
		durationSeconds = 3.0
	}

	numSamples := int(float64(sampleRate) * durationSeconds)
	dataSize := numSamples * 2

	var buf bytes.Buffer
	buf.WriteString("RIFF")
	binary.Write(&buf, binary.LittleEndian, uint32(36+dataSize))
	buf.WriteString("WAVE")
	buf.WriteString("fmt ")
	binary.Write(&buf, binary.LittleEndian, uint32(16))
	binary.Write(&buf, binary.LittleEndian, uint16(1))
	binary.Write(&buf, binary.LittleEndian, uint16(1))
	binary.Write(&buf, binary.LittleEndian, uint32(sampleRate))
	binary.Write(&buf, binary.LittleEndian, uint32(sampleRate*2))
	binary.Write(&buf, binary.LittleEndian, uint16(2))
	binary.Write(&buf, binary.LittleEndian, uint16(16))
	buf.WriteString("data")
	binary.Write(&buf, binary.LittleEndian, uint32(dataSize))

	freq := 440.0
	for i := 0; i < numSamples; i++ {
		t := float64(i) / float64(sampleRate)
		envelope := 1.0
		if t < 0.05 {
			envelope = t / 0.05
		} else if t > durationSeconds-0.05 {
			envelope = (durationSeconds - t) / 0.05
		}
		val := math.Sin(2*math.Pi*freq*t) * 12000.0 * envelope
		binary.Write(&buf, binary.LittleEndian, int16(val))
	}

	return buf.Bytes(), nil
}

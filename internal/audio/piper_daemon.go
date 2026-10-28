package audio

import (
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"os"
	"os/exec"
	"sync"

	"stream-tribunal/internal/config"
)

type PiperDaemon struct {
	cfg    config.TTSConfig
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout *bufio.Reader
	mu     sync.Mutex
	sem    chan struct{}
	isMock bool
	closed bool
}

type PiperInput struct {
	Text      string `json:"text"`
	SpeakerID int    `json:"speaker_id,omitempty"`
}

func (p *PiperDaemon) IsMock() bool { return p.isMock }

func NewPiperDaemon(cfg config.TTSConfig) (*PiperDaemon, error) {
	daemon := &PiperDaemon{cfg: cfg, sem: make(chan struct{}, 1)}

	if !cfg.Enabled {
		daemon.isMock = true
		log.Printf("piper TTS disabled, mock beep mode active")
		return daemon, nil
	}

	if _, err := os.Stat(cfg.PiperBinary); errors.Is(err, os.ErrNotExist) {
		log.Printf("piper binary not found at '%s', fallback to audio synthesis mock mode", cfg.PiperBinary)
		daemon.isMock = true
		return daemon, nil
	}

	if err := daemon.startProcess(); err != nil {
		log.Printf("failed to launch piper process (%v), fallback to mock mode", err)
		daemon.isMock = true
		return daemon, nil
	}

	return daemon, nil
}

func (p *PiperDaemon) startProcess() error {
	cmd := exec.Command(p.cfg.PiperBinary,
		"--model", p.cfg.ModelPath,
		"--config", p.cfg.ConfigPath,
		"--json-input",
		"--output_file", "-",
	)

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return fmt.Errorf("stdin pipe error: %w", err)
	}

	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		stdin.Close()
		return fmt.Errorf("stdout pipe error: %w", err)
	}

	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		stdin.Close()
		stdoutPipe.Close()
		return fmt.Errorf("stderr pipe error: %w", err)
	}

	if err := cmd.Start(); err != nil {
		stdin.Close()
		stdoutPipe.Close()
		return fmt.Errorf("process start error: %w", err)
	}

	go func() {
		drain := make([]byte, 4096)
		for {
			if _, err := stderrPipe.Read(drain); err != nil {
				return
			}
		}
	}()

	p.cmd = cmd
	p.stdin = stdin
	p.stdout = bufio.NewReader(stdoutPipe)
	return nil
}

func (p *PiperDaemon) Synthesize(ctx context.Context, text string) ([]byte, error) {
	if text == "" {
		return nil, nil
	}

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	default:
	}

	// Serialize pipe I/O without holding mu: Close() never blocks on synthesis.
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case p.sem <- struct{}{}:
	}
	defer func() { <-p.sem }()

	p.mu.Lock()
	isMock := p.isMock
	closed := p.closed
	stdin := p.stdin
	stdout := p.stdout
	speaker := p.cfg.SpeakerID
	p.mu.Unlock()

	if closed {
		return nil, fmt.Errorf("piper daemon closed")
	}
	if isMock {
		return generateMockBeepWav(text)
	}

	req := PiperInput{
		Text:      text,
		SpeakerID: speaker,
	}
	encoded, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	encoded = append(encoded, '\n')

	type ioResult struct {
		data []byte
		err  error
	}
	done := make(chan ioResult, 1)
	go func() {
		if _, err := stdin.Write(encoded); err != nil {
			done <- ioResult{nil, fmt.Errorf("failed writing to piper stdin: %w", err)}
			return
		}

		header := make([]byte, 44)
		if _, err := io.ReadFull(stdout, header); err != nil {
			done <- ioResult{nil, fmt.Errorf("failed reading wav header: %w", err)}
			return
		}

		dataSize := binary.LittleEndian.Uint32(header[40:44])
		if dataSize > 25*1024*1024 {
			done <- ioResult{nil, fmt.Errorf("invalid wav chunk size: %d", dataSize)}
			return
		}

		audioBuffer := make([]byte, dataSize)
		if _, err := io.ReadFull(stdout, audioBuffer); err != nil {
			done <- ioResult{nil, fmt.Errorf("failed reading audio payload: %w", err)}
			return
		}

		fullWav := make([]byte, 0, 44+dataSize)
		fullWav = append(fullWav, header...)
		fullWav = append(fullWav, audioBuffer...)
		done <- ioResult{fullWav, nil}
	}()

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case r := <-done:
		return r.data, r.err
	}
}

func (p *PiperDaemon) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	p.closed = true
	if p.stdin != nil {
		p.stdin.Close()
	}
	if p.cmd != nil && p.cmd.Process != nil {
		return p.cmd.Process.Kill()
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

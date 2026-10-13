package audio

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"html"
	"math"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

const (
	edgeWSSURL     = "wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1?Ocp-Apim-Subscription-Key=6A5AA1D4EAFF4E9FB37E23D68491D6F4"
	edgeGECToken   = "6A5AA1D4EAFF4E9FB37E23D68491D6F4"
	edgeGECVersion = "1-140.0.3485.14"
	edgeUserAgent  = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0"
)

// breakTagRe matches pause tags in escaped text.
var breakTagRe = regexp.MustCompile(`&lt;break time=&#34;(\d{1,4})ms&#34;/&gt;`)

// rawBreakRe matches break pause tags before xml escaping
var rawBreakRe = regexp.MustCompile(`(?i)<break(\s+time="(\d{1,4})ms")?\s*/?>`)

var rawBreakMs = regexp.MustCompile(`(\d{1,4})ms`)

func ssmlBody(text, voice, rate, volume, pitch string) string {
	// strip Silero stress marks for Edge TTS
	cleaned := strings.ReplaceAll(strings.TrimSpace(text), "+", "")
	cleaned = rawBreakRe.ReplaceAllStringFunc(cleaned, func(tag string) string {
		ms := "300"
		if m := rawBreakMs.FindStringSubmatch(tag); len(m) == 2 {
			ms = m[1]
		}
		return `<break time="` + ms + `ms"/>`
	})
	escaped := html.EscapeString(cleaned)
	escaped = breakTagRe.ReplaceAllString(escaped, `<break time="${1}ms" />`)
	liveRate, livePitch := lively(escaped, rate, pitch)
	rate, pitch = liveRate, livePitch
	return fmt.Sprintf(
		"<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>"+
			"<voice name='%s'>"+
			"<prosody pitch='%s' rate='%s' volume='%s'>"+
			"%s"+
			"</prosody>"+
			"</voice>"+
			"</speak>",
		voice, pitch, rate, volume, escaped)
}

// lively raises rate and pitch on exclamations for emotional delivery
func lively(escaped, rate, pitch string) (string, string) {
	trimmed := strings.TrimSpace(escaped)
	switch {
	case strings.HasSuffix(trimmed, "!"):
		return shiftRate(rate, 10), shiftPitch(pitch, 5)
	default:
		return rate, pitch
	}
}

func shiftRate(rate string, delta int) string {
	var base int
	fmt.Sscanf(strings.TrimSuffix(rate, "%"), "%d", &base)
	return fmt.Sprintf("%+d%%", base+delta)
}

func shiftPitch(pitch string, delta int) string {
	var base int
	fmt.Sscanf(strings.TrimSuffix(pitch, "Hz"), "%d", &base)
	return fmt.Sprintf("%+dHz", base+delta)
}

// secMSGEC computes Edge Sec-MS-GEC token.
func secMSGEC() string {
	ticks := float64(time.Now().UTC().Unix()) + 11644473600
	ticks = math.Floor(ticks/300) * 300
	ticks *= 1e9 / 100
	sum := sha256.Sum256([]byte(fmt.Sprintf("%.0f%s", ticks, edgeGECToken)))
	return fmt.Sprintf("%X", sum)
}

func edgeRequestID() string {
	return strings.ReplaceAll(uuid.New().String(), "-", "")
}

func edgeTimestamp() string {
	return time.Now().UTC().Format("Mon Jan 02 2006 15:04:05 GMT+0000 (Coordinated Universal Time)")
}

func directSynthesize(ctx context.Context, text, voice, rate, volume, pitch string) ([]byte, error) {
	url := edgeWSSURL + "&Sec-MS-GEC=" + secMSGEC() +
		"&Sec-MS-GEC-Version=" + edgeGECVersion +
		"&ConnectionId=" + edgeRequestID()

	header := http.Header{}
	header.Set("Pragma", "no-cache")
	header.Set("Cache-Control", "no-cache")
	header.Set("Origin", "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold")
	header.Set("Sec-WebSocket-Protocol", "synthesize")
	header.Set("User-Agent", edgeUserAgent)
	header.Set("Accept-Encoding", "gzip, deflate, br")
	header.Set("Accept-Language", "en-US,en;q=0.9")

	dialer := websocket.Dialer{EnableCompression: true}
	conn, _, err := dialer.DialContext(ctx, url, header)
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	configMsg := fmt.Sprintf(
		"X-Timestamp:%s\r\n"+
			"Content-Type:application/json; charset=utf-8\r\n"+
			"Path:speech.config\r\n\r\n"+
			`{"context":{"synthesis":{"audio":{"metadataoptions":{`+
			`"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},`+
			`"outputFormat":"audio-24khz-160kbitrate-mono-mp3"`+
			"}}}}",
		edgeTimestamp())
	if err := conn.WriteMessage(websocket.TextMessage, []byte(configMsg)); err != nil {
		return nil, err
	}

	ssmlMsg := fmt.Sprintf(
		"X-RequestId:%s\r\n"+
			"Content-Type:application/ssml+xml\r\n"+
			"X-Timestamp:%sZ\r\n"+
			"Path:ssml\r\n\r\n"+
			"%s",
		edgeRequestID(), edgeTimestamp(), ssmlBody(text, voice, rate, volume, pitch))
	if err := conn.WriteMessage(websocket.TextMessage, []byte(ssmlMsg)); err != nil {
		return nil, err
	}

	var buf bytes.Buffer
	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}
		msgType, data, err := conn.ReadMessage()
		if err != nil {
			return nil, err
		}
		if msgType == websocket.TextMessage {
			if isTurnEnd(data) {
				break
			}
			continue
		}
		if len(data) < 2 {
			continue
		}
		headerLen := int(binary.BigEndian.Uint16(data[:2]))
		if headerLen+2 > len(data) {
			continue
		}
		headerText := string(data[2 : headerLen+2])
		if !strings.Contains(headerText, "Path:audio") {
			continue
		}
		buf.Write(data[headerLen+2:])
	}
	if buf.Len() == 0 {
		return nil, fmt.Errorf("edge direct: empty audio")
	}
	return buf.Bytes(), nil
}

func isTurnEnd(data []byte) bool {
	idx := bytes.Index(data, []byte("\r\n\r\n"))
	if idx < 0 {
		return false
	}
	return strings.Contains(string(data[:idx]), "Path:turn.end")
}

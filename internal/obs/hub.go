package obs

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait      = 5 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 512 * 1024
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 64 * 1024,
	// local only: same host, loopback, or empty (OBS/curl). keeps random sites out.
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" {
			return true
		}
		u, err := url.Parse(origin)
		if err != nil || u.Hostname() == "" {
			return false
		}
		originHost := strings.ToLower(u.Hostname())
		reqHost := strings.ToLower(r.Host)
		if h, _, err := net.SplitHostPort(reqHost); err == nil {
			reqHost = h
		}
		if originHost == reqHost {
			return true
		}
		switch originHost {
		case "localhost", "127.0.0.1", "::1":
			return true
		}
		return false
	},
}

type Client struct {
	hub  *Hub
	conn *websocket.Conn
	send chan []byte
}

type Hub struct {
	clients    map[*Client]bool
	broadcast  chan []byte
	register   chan *Client
	unregister chan *Client
	mu         sync.RWMutex
	onAction   func(action string, payload []byte)
	dropped    atomic.Int64
	// Secret gates the WS upgrade when set (nil = open LAN board).
	Secret func() string
}

func NewHub(actionHandler func(action string, payload []byte)) *Hub {
	return &Hub{
		clients:    make(map[*Client]bool),
		broadcast:  make(chan []byte, 512),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		onAction:   actionHandler,
	}
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
			}
			h.mu.Unlock()

		case message := <-h.broadcast:
			h.mu.Lock()
			for client := range h.clients {
				select {
				case client.send <- message:
				default:
					close(client.send)
					delete(h.clients, client)
				}
			}
			h.mu.Unlock()
		}
	}
}

func (h *Hub) BroadcastEvent(eventType EventType, payload interface{}) error {
	msg := EventMessage{
		Type:    eventType,
		Payload: payload,
	}
	raw, err := json.Marshal(msg)
	if err != nil {
		return err
	}

	select {
	case h.broadcast <- raw:
	default:
		n := h.dropped.Add(1)
		log.Printf("obs hub broadcast queue full, dropped %s event #%d", eventType, n)
		return fmt.Errorf("obs broadcast queue full (dropped #%d)", n)
	}
	return nil
}

func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	if h.Secret != nil && h.Secret() != "" {
		got := r.URL.Query().Get("secret")
		if got == "" || subtle.ConstantTimeCompare([]byte(got), []byte(h.Secret())) != 1 {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	client := &Client{
		hub:  h,
		conn: conn,
		send: make(chan []byte, 64),
	}
	h.register <- client

	go client.writePump()
	go client.readPump()
}

func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	windowStart := time.Now()
	windowCount := 0
	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			break
		}
		// flood guard: >30 actions/sec per socket = goodbye
		now := time.Now()
		if now.Sub(windowStart) >= time.Second {
			windowStart, windowCount = now, 0
		}
		windowCount++
		if windowCount > 30 {
			break
		}

		var envelope struct {
			Action  string          `json:"action"`
			Payload json.RawMessage `json:"payload"`
		}
		if err := json.Unmarshal(message, &envelope); err == nil && c.hub.onAction != nil {
			c.hub.onAction(envelope.Action, envelope.Payload)
		}
	}
}

func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

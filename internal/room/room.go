// Package room holds per-session state: the text, the active writer, connected
// clients and pending write requests. All state is guarded by Room.mu.
package room

import (
	"crypto/subtle"
	"encoding/json"
	"sync"
	"time"

	"livetype/internal/ids"
	"livetype/internal/limits"
)

// Websocket close codes the room asks the transport to use.
const (
	CloseTerminal  = 4000 // client must not reconnect (bad key, room gone, replaced)
	CloseGoingAway = 1001
	ClosePolicy    = 1008
)

type Error struct{ Code, Message string }

func (e *Error) Error() string { return e.Message }

var (
	ErrBadKey      = &Error{"bad_key", "Invalid host key."}
	ErrNotWriter   = &Error{"not_writer", "You are not the active writer."}
	ErrTooLarge    = &Error{"too_large", "Text is larger than 200 KB."}
	ErrRoomFull    = &Error{"room_full", "This session is full."}
	ErrQueueFull   = &Error{"room_full", "Too many pending requests, try again later."}
	ErrRateLimited = &Error{"rate_limited", "Too many messages, slow down."}
	ErrBadMessage  = &Error{"bad_message", "Malformed or unexpected message."}
	ErrNotHost     = &Error{"bad_message", "Only the host can do that."}
	ErrNoRequest   = &Error{"bad_message", "That viewer has no pending request."}
	ErrClosed      = &Error{"room_closed", "This session has ended."}
)

// Client is one websocket connection. The room queues messages on out; the
// transport drains it and closes the socket once done is closed.
type Client struct {
	out    chan []byte
	done   chan struct{}
	once   sync.Once
	code   int
	reason string

	host     bool   // set once by JoinHost
	viewerID string // set once by JoinViewer
}

func NewClient() *Client {
	return &Client{out: make(chan []byte, limits.SendBuffer), done: make(chan struct{})}
}

func (c *Client) Out() <-chan []byte    { return c.out }
func (c *Client) Done() <-chan struct{} { return c.done }

// CloseStatus is valid after Done is closed.
func (c *Client) CloseStatus() (int, string) { return c.code, c.reason }

func (c *Client) Kick(code int, reason string) {
	c.once.Do(func() {
		c.code, c.reason = code, reason
		close(c.done)
	})
}

// send never blocks: a client whose buffer is full is dropped.
func (c *Client) send(b []byte) {
	select {
	case c.out <- b:
	default:
		c.Kick(ClosePolicy, "Connection too slow")
	}
}

// Frame is the error message sent to the client.
func (e *Error) Frame() []byte { return encode(errorMsg{"error", e.Code, e.Message}) }

func (c *Client) SendError(e *Error) { c.send(e.Frame()) }

type viewer struct {
	conns map[*Client]struct{}
	timer *time.Timer // forgets the viewer once the grace period passes with no connections
}

type request struct {
	ViewerID string `json:"viewerId"`
	Name     string `json:"name"`
}

type Room struct {
	ID      string
	hostKey string
	created time.Time
	grace   time.Duration

	mu         sync.Mutex
	closed     bool
	text       string
	rev        int64
	writerID   string // "" means the host holds the pen
	writerName string
	host       *Client
	hostLeft   time.Time
	viewers    map[string]*viewer
	conns      int // viewer connections across all viewers
	pending    []request
}

func newRoom(id, hostKey string, grace time.Duration, now time.Time) *Room {
	return &Room{
		ID: id, hostKey: hostKey, created: now, grace: grace,
		hostLeft: now, // a host that never connects counts as gone since creation
		viewers:  map[string]*viewer{},
	}
}

// Outbound messages. writer is only ever {name}: viewer IDs are bearer
// credentials, so they are shown to the host only, never broadcast.
type (
	writerInfo struct {
		Name string `json:"name"`
	}
	welcomeMsg struct {
		Type        string      `json:"type"`
		ViewerID    string      `json:"viewerId,omitempty"`
		Role        string      `json:"role"`
		Text        string      `json:"text"`
		Rev         int64       `json:"rev"`
		Writer      *writerInfo `json:"writer"`
		ViewerCount int         `json:"viewerCount"`
		HostOnline  bool        `json:"hostOnline"`
	}
	snapshotMsg struct {
		Type   string      `json:"type"`
		Text   string      `json:"text"`
		Rev    int64       `json:"rev"`
		Writer *writerInfo `json:"writer"`
	}
	roleMsg struct {
		Type   string `json:"type"`
		Role   string `json:"role"`
		Reason string `json:"reason,omitempty"`
	}
	requestStateMsg struct {
		Type  string `json:"type"`
		State string `json:"state"`
	}
	requestsMsg struct {
		Type string    `json:"type"`
		List []request `json:"list"`
	}
	presenceMsg struct {
		Type        string `json:"type"`
		ViewerCount int    `json:"viewerCount"`
		HostOnline  bool   `json:"hostOnline"`
	}
	ackMsg struct {
		Type string `json:"type"`
		Rev  int64  `json:"rev"`
	}
	errorMsg struct {
		Type    string `json:"type"`
		Code    string `json:"code"`
		Message string `json:"message"`
	}
)

func encode(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err) // only fixed structs of strings and ints are encoded
	}
	return b
}

func (r *Room) writer() *writerInfo {
	if r.writerID == "" {
		return nil
	}
	return &writerInfo{r.writerName}
}

func (r *Room) snapshot() []byte {
	return encode(snapshotMsg{"snapshot", r.text, r.rev, r.writer()})
}

func (r *Room) welcome(c *Client, role string) []byte {
	return encode(welcomeMsg{"welcome", c.viewerID, role, r.text, r.rev, r.writer(), r.conns, r.host != nil})
}

func roleChange(role, reason string) []byte { return encode(roleMsg{"role", role, reason}) }

func requestState(state string) []byte { return encode(requestStateMsg{"request_state", state}) }

func (r *Room) broadcast(msg []byte, except *Client) {
	if r.host != nil && r.host != except {
		r.host.send(msg)
	}
	for _, v := range r.viewers {
		for c := range v.conns {
			if c != except {
				c.send(msg)
			}
		}
	}
}

func (r *Room) sendViewer(id string, msg []byte) {
	if v := r.viewers[id]; v != nil {
		for c := range v.conns {
			c.send(msg)
		}
	}
}

func (r *Room) sendRequests() {
	if r.host != nil {
		r.host.send(encode(requestsMsg{"requests", append([]request{}, r.pending...)}))
	}
}

func (r *Room) broadcastPresence() {
	r.broadcast(encode(presenceMsg{"presence", r.conns, r.host != nil}), nil)
}

// JoinHost attaches c as the host. A previous host connection is closed, so
// two host tabs never both hold the pen.
func (r *Room) JoinHost(c *Client, key string) error {
	if subtle.ConstantTimeCompare([]byte(key), []byte(r.hostKey)) != 1 {
		return ErrBadKey
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return ErrClosed
	}
	if r.host != nil {
		r.host.Kick(CloseTerminal, "The host page was opened in another tab.")
	}
	c.host = true
	r.host = c
	c.send(r.welcome(c, "host"))
	r.sendRequests()
	r.broadcastPresence()
	return nil
}

// JoinViewer attaches c as a viewer. An unknown or empty id gets a fresh
// server-generated one, readable from the welcome message.
func (r *Room) JoinViewer(c *Client, id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return ErrClosed
	}
	if r.conns >= limits.MaxViewers {
		return ErrRoomFull
	}
	v := r.viewers[id]
	if v == nil {
		id = ids.Key()
		v = &viewer{conns: map[*Client]struct{}{}}
		r.viewers[id] = v
	}
	if v.timer != nil {
		v.timer.Stop()
		v.timer = nil
	}
	v.conns[c] = struct{}{}
	r.conns++
	c.viewerID = id

	role := "viewer"
	if r.writerID == id {
		role = "writer"
	}
	c.send(r.welcome(c, role))
	if r.pendingIndex(id) >= 0 {
		c.send(requestState("pending"))
	}
	r.broadcastPresence()
	return nil
}

// Leave detaches c. A viewer's write access and pending request survive for
// the grace period so a page refresh keeps them.
func (r *Room) Leave(c *Client) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return
	}
	if c.host {
		if r.host == c {
			r.host = nil
			r.hostLeft = time.Now()
			r.broadcastPresence()
		}
		return
	}
	v := r.viewers[c.viewerID]
	if v == nil {
		return
	}
	if _, ok := v.conns[c]; !ok {
		return
	}
	delete(v.conns, c)
	r.conns--
	if len(v.conns) == 0 {
		id := c.viewerID
		v.timer = time.AfterFunc(r.grace, func() { r.forget(id) })
	}
	r.broadcastPresence()
}

// forget drops a viewer that stayed disconnected through the grace period:
// its pending request is removed, its write access returns to the host and
// its ID is no longer recognized.
func (r *Room) forget(id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	v := r.viewers[id]
	if r.closed || v == nil || len(v.conns) > 0 {
		return
	}
	delete(r.viewers, id)
	if r.removePending(id) {
		r.sendRequests()
	}
	if r.writerID == id {
		r.setWriter("", "", "")
	}
}

// Close disconnects everyone. Later joins fail with ErrClosed.
func (r *Room) Close(code int, reason string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.closed = true
	if r.host != nil {
		r.host.Kick(code, reason)
	}
	for _, v := range r.viewers {
		for c := range v.conns {
			c.Kick(code, reason)
		}
	}
}

func (r *Room) expired(now time.Time, idleTTL, maxAge time.Duration) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return now.Sub(r.created) >= maxAge || (r.host == nil && now.Sub(r.hostLeft) >= idleTTL)
}

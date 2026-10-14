package ws

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"livetype/internal/limits"
	"livetype/internal/room"
)

type testServer struct {
	url string
	mgr *room.Manager
	id  string
	key string
}

func newServer(t *testing.T) *testServer {
	t.Helper()
	mgr := room.NewManager(room.Config{IdleTTL: time.Hour, MaxAge: time.Hour, WriterGrace: 2 * time.Second})
	mux := http.NewServeMux()
	mux.Handle("GET /ws/{roomId}", &Handler{Rooms: mgr})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	id, key, err := mgr.Create()
	if err != nil {
		t.Fatal(err)
	}
	return &testServer{url: "ws" + strings.TrimPrefix(srv.URL, "http"), mgr: mgr, id: id, key: key}
}

type client struct {
	t    *testing.T
	conn *websocket.Conn
}

func (s *testServer) dial(t *testing.T, hello map[string]any) *client {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, s.url+"/ws/"+s.id, nil)
	if err != nil {
		t.Fatal(err)
	}
	conn.SetReadLimit(1 << 20)
	t.Cleanup(func() { conn.CloseNow() })
	c := &client{t: t, conn: conn}
	hello["type"] = "hello"
	c.send(hello)
	return c
}

func (s *testServer) host(t *testing.T) *client {
	c := s.dial(t, map[string]any{"role": "host", "hostKey": s.key})
	c.expect("welcome")
	c.expect("requests") // the initial, empty list
	return c
}

func (s *testServer) viewer(t *testing.T, id string) (*client, map[string]any) {
	c := s.dial(t, map[string]any{"role": "viewer", "viewerId": id})
	return c, c.expect("welcome")
}

func (c *client) send(m map[string]any) {
	c.t.Helper()
	b, _ := json.Marshal(m)
	if err := c.conn.Write(context.Background(), websocket.MessageText, b); err != nil {
		c.t.Fatal(err)
	}
}

// expect reads until a message of type typ arrives, skipping others.
func (c *client) expect(typ string) map[string]any {
	c.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	for {
		_, b, err := c.conn.Read(ctx)
		if err != nil {
			c.t.Fatalf("waiting for %q: %v", typ, err)
		}
		var m map[string]any
		json.Unmarshal(b, &m)
		if m["type"] == typ {
			return m
		}
	}
}

func (c *client) expectError(code string) {
	c.t.Helper()
	if m := c.expect("error"); m["code"] != code {
		c.t.Fatalf("error = %v, want code %q", m, code)
	}
}

// expectClose reads until the server closes the connection with code.
func (c *client) expectClose(code websocket.StatusCode) {
	c.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	for {
		if _, _, err := c.conn.Read(ctx); err != nil {
			if got := websocket.CloseStatus(err); got != code {
				c.t.Fatalf("closed with %v (%v), want %v", got, err, code)
			}
			return
		}
	}
}

func TestUpdateReachesTwoViewers(t *testing.T) {
	s := newServer(t)
	h := s.host(t)
	v1, _ := s.viewer(t, "")
	v2, _ := s.viewer(t, "")

	start := time.Now()
	h.send(map[string]any{"type": "update", "text": "hello world"})
	for _, v := range []*client{v1, v2} {
		if m := v.expect("snapshot"); m["text"] != "hello world" {
			t.Fatalf("snapshot = %v", m)
		}
	}
	if d := time.Since(start); d > 200*time.Millisecond {
		t.Errorf("update took %v to reach viewers", d)
	}
	if m := h.expect("ack"); m["rev"] != 1.0 {
		t.Fatalf("ack = %v", m)
	}
}

func TestLateJoinerSeesText(t *testing.T) {
	s := newServer(t)
	h := s.host(t)
	h.send(map[string]any{"type": "update", "text": "already here"})
	h.expect("ack")
	if _, w := s.viewer(t, ""); w["text"] != "already here" || w["rev"] != 1.0 {
		t.Fatalf("late welcome = %v", w)
	}
}

func TestRequestGrantWriteRevoke(t *testing.T) {
	s := newServer(t)
	h := s.host(t)
	v, w := s.viewer(t, "")
	other, _ := s.viewer(t, "")
	id := w["viewerId"].(string)

	v.send(map[string]any{"type": "request_write", "name": "Ann"})
	if m := v.expect("request_state"); m["state"] != "pending" {
		t.Fatalf("request_state = %v", m)
	}
	list := h.expect("requests")["list"].([]any)
	if len(list) != 1 || list[0].(map[string]any)["viewerId"] != id {
		t.Fatalf("requests = %v", list)
	}

	h.send(map[string]any{"type": "grant", "viewerId": id})
	if m := v.expect("role"); m["role"] != "writer" {
		t.Fatalf("role = %v", m)
	}
	snap := other.expect("snapshot")
	if snap["writer"].(map[string]any)["name"] != "Ann" {
		t.Fatalf("snapshot after grant = %v", snap)
	}
	if _, leaked := snap["writer"].(map[string]any)["id"]; leaked {
		t.Fatal("writer's viewer ID broadcast to other viewers")
	}

	v.send(map[string]any{"type": "update", "text": "from Ann"})
	v.expect("ack")
	if m := other.expect("snapshot"); m["text"] != "from Ann" {
		t.Fatalf("other viewer got %v", m)
	}
	h.expect("snapshot") // the hand-over itself
	if m := h.expect("snapshot"); m["text"] != "from Ann" {
		t.Fatalf("host got %v", m)
	}

	h.send(map[string]any{"type": "revoke"})
	if m := v.expect("role"); m["role"] != "viewer" {
		t.Fatalf("role after revoke = %v", m)
	}
	h.expect("role")
	v.send(map[string]any{"type": "update", "text": "too late"})
	v.expectError("not_writer")
	h.send(map[string]any{"type": "update", "text": "host again"})
	h.expect("ack")
}

func TestRejections(t *testing.T) {
	s := newServer(t)
	h := s.host(t)

	t.Run("wrong host key", func(t *testing.T) {
		c := s.dial(t, map[string]any{"role": "host", "hostKey": "nope"})
		c.expectError("bad_key")
		c.expectClose(room.CloseTerminal)
	})

	t.Run("non-writer update", func(t *testing.T) {
		h.send(map[string]any{"type": "update", "text": "kept"})
		h.expect("ack")
		v, _ := s.viewer(t, "")
		v.send(map[string]any{"type": "update", "text": "overwritten"})
		v.expectError("not_writer")
		if _, w := s.viewer(t, ""); w["text"] != "kept" {
			t.Fatalf("text = %q", w["text"])
		}
	})

	t.Run("oversized text", func(t *testing.T) {
		h.send(map[string]any{"type": "update", "text": strings.Repeat("x", limits.MaxTextBytes+1)})
		h.expectError("too_large")
	})

	t.Run("oversized frame closes only that connection", func(t *testing.T) {
		v, _ := s.viewer(t, "")
		v.conn.Write(context.Background(), websocket.MessageText, make([]byte, limits.MaxMessageBytes+1))
		v.expectClose(websocket.StatusMessageTooBig)
		h.send(map[string]any{"type": "update", "text": "still alive"})
		h.expect("ack")
	})

	t.Run("flood is rate limited", func(t *testing.T) {
		v, _ := s.viewer(t, "")
		for range 3 * limits.MessageBurst {
			v.send(map[string]any{"type": "cancel_request"})
		}
		v.expectError("rate_limited")
	})

	t.Run("garbage", func(t *testing.T) {
		v, _ := s.viewer(t, "")
		v.conn.Write(context.Background(), websocket.MessageText, []byte("{not json"))
		v.expectError("bad_message")
		v.send(map[string]any{"type": "grant", "viewerId": "x"})
		v.expectError("bad_message")
	})

	t.Run("missing hello times out", func(t *testing.T) {
		if testing.Short() {
			t.Skip("waits for the hello timeout")
		}
		conn, _, err := websocket.Dial(context.Background(), s.url+"/ws/"+s.id, nil)
		if err != nil {
			t.Fatal(err)
		}
		defer conn.CloseNow()
		ctx, cancel := context.WithTimeout(context.Background(), limits.HelloTimeout+2*time.Second)
		defer cancel()
		conn.Read(ctx)
		if ctx.Err() != nil {
			t.Fatal("server kept a silent connection open past the hello timeout")
		}
	})

	t.Run("unknown room", func(t *testing.T) {
		conn, _, err := websocket.Dial(context.Background(), s.url+"/ws/doesnotexist", nil)
		if err != nil {
			t.Fatal(err)
		}
		defer conn.CloseNow()
		(&client{t: t, conn: conn}).expectClose(room.CloseTerminal)
	})
}

func TestReconnectKeepsViewerIDAndPen(t *testing.T) {
	s := newServer(t)
	h := s.host(t)
	v, w := s.viewer(t, "")
	id := w["viewerId"].(string)
	v.send(map[string]any{"type": "request_write", "name": "Ann"})
	h.expect("requests")
	h.send(map[string]any{"type": "grant", "viewerId": id})
	v.expect("role")

	v.conn.Close(websocket.StatusGoingAway, "refresh")
	v2, w2 := s.viewer(t, id)
	if w2["viewerId"] != id || w2["role"] != "writer" {
		t.Fatalf("welcome after refresh = %v", w2)
	}
	v2.send(map[string]any{"type": "update", "text": "still writing"})
	v2.expect("ack")

	if _, w3 := s.viewer(t, "made-up-id"); w3["viewerId"] == "made-up-id" {
		t.Fatal("server accepted a client-chosen viewer ID")
	}
}

func TestRoomExpiryDisconnectsClients(t *testing.T) {
	s := newServer(t)
	v, _ := s.viewer(t, "")
	s.mgr.Sweep(time.Now().Add(2 * time.Hour))
	v.expectClose(room.CloseTerminal)
}

// Package ws upgrades connections, runs the hello handshake and pumps
// messages between a websocket and its room.
package ws

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"

	"livetype/internal/limits"
	"livetype/internal/room"
)

type Handler struct {
	Rooms          *room.Manager
	OriginPatterns []string // extra allowed Origin hosts; the request's own host is always allowed
	wg             sync.WaitGroup
}

// Wait blocks until every connection handler has returned.
func (h *Handler) Wait() { h.wg.Wait() }

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.wg.Add(1)
	defer h.wg.Done()
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: h.OriginPatterns})
	if err != nil {
		return // Accept has already written the HTTP error
	}
	defer conn.CloseNow()
	conn.SetReadLimit(limits.MaxMessageBytes)
	ctx := r.Context()

	rm := h.Rooms.Get(r.PathValue("roomId"))
	if rm == nil {
		conn.Close(room.CloseTerminal, room.ErrClosed.Message)
		return
	}
	c, err := hello(ctx, conn, rm)
	if err != nil {
		var e *room.Error
		if !errors.As(err, &e) {
			return // hello timed out or the socket died
		}
		if e != room.ErrClosed {
			wctx, cancel := context.WithTimeout(ctx, limits.WriteTimeout)
			conn.Write(wctx, websocket.MessageText, e.Frame())
			cancel()
		}
		conn.Close(room.CloseTerminal, e.Message)
		return
	}

	wrote := make(chan struct{})
	go func() {
		defer close(wrote)
		writePump(ctx, conn, c)
	}()
	// Run in reverse: leave the room, stop the write pump, wait for it.
	defer func() { <-wrote }()
	defer c.Kick(int(websocket.StatusNormalClosure), "")
	defer rm.Leave(c)
	readPump(ctx, conn, rm, c)
}

// hello reads the mandatory first message and joins the room.
func hello(ctx context.Context, conn *websocket.Conn, rm *room.Room) (*room.Client, error) {
	hctx, cancel := context.WithTimeout(ctx, limits.HelloTimeout)
	defer cancel()
	_, data, err := conn.Read(hctx)
	if err != nil {
		return nil, err
	}
	var m inbound
	if json.Unmarshal(data, &m) != nil || m.Type != "hello" {
		return nil, room.ErrBadMessage
	}
	c := room.NewClient()
	switch m.Role {
	case "host":
		err = rm.JoinHost(c, m.HostKey)
	case "viewer":
		err = rm.JoinViewer(c, m.ViewerID)
	default:
		err = room.ErrBadMessage
	}
	return c, err
}

func readPump(ctx context.Context, conn *websocket.Conn, rm *room.Room, c *room.Client) {
	var limiter limits.Limiter
	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			return
		}
		if !limiter.Allow(time.Now()) {
			c.SendError(room.ErrRateLimited)
			continue
		}
		var m inbound
		if json.Unmarshal(data, &m) != nil {
			c.SendError(room.ErrBadMessage)
			continue
		}
		var e *room.Error
		if errors.As(dispatch(rm, c, m), &e) {
			c.SendError(e)
		}
	}
}

func writePump(ctx context.Context, conn *websocket.Conn, c *room.Client) {
	ping := time.NewTicker(limits.PingInterval)
	defer ping.Stop()
	for {
		select {
		case msg := <-c.Out():
			wctx, cancel := context.WithTimeout(ctx, limits.WriteTimeout)
			err := conn.Write(wctx, websocket.MessageText, msg)
			cancel()
			if err != nil {
				conn.CloseNow() // unblocks readPump
				return
			}
		case <-ping.C:
			pctx, cancel := context.WithTimeout(ctx, limits.WriteTimeout)
			err := conn.Ping(pctx)
			cancel()
			if err != nil {
				conn.CloseNow()
				return
			}
		case <-c.Done():
			code, reason := c.CloseStatus()
			conn.Close(websocket.StatusCode(code), reason)
			return
		}
	}
}

package room

import (
	"strings"
	"unicode"

	"livetype/internal/limits"
)

// isWriter: the host holds the pen unless a viewer has been granted it.
// r.host == c also rejects a host connection replaced by a newer tab.
func (r *Room) isWriter(c *Client) bool {
	if c.host {
		return r.host == c && r.writerID == ""
	}
	return r.writerID != "" && r.writerID == c.viewerID
}

// Update replaces the text. Everyone except the sender gets a snapshot; the
// sender gets an ack so its own editor is never overwritten.
func (r *Room) Update(c *Client, text string) error {
	if len(text) > limits.MaxTextBytes {
		return ErrTooLarge
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.isWriter(c) {
		return ErrNotWriter
	}
	r.text = text
	r.rev++
	c.send(encode(ackMsg{"ack", r.rev}))
	r.broadcast(r.snapshot(), c)
	return nil
}

// setWriter moves the pen to viewer id, or back to the host when id is "".
// reason is shown to a viewer who loses it.
func (r *Room) setWriter(id, name, reason string) {
	old := r.writerID
	if old == id {
		return
	}
	r.writerID, r.writerName = id, name
	if old != "" {
		r.sendViewer(old, roleChange("viewer", reason))
	}
	if id == "" {
		if r.host != nil {
			r.host.send(roleChange("host", ""))
		}
	} else {
		r.sendViewer(id, roleChange("writer", ""))
	}
	r.broadcast(r.snapshot(), nil)
}

func (r *Room) RequestWrite(c *Client, name string) error {
	if c.host {
		return ErrBadMessage
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.writerID == c.viewerID {
		return nil
	}
	req := request{c.viewerID, cleanName(name)}
	if i := r.pendingIndex(c.viewerID); i >= 0 {
		r.pending[i] = req // a repeated request replaces the old one
	} else if len(r.pending) >= limits.MaxPending {
		return ErrQueueFull
	} else {
		r.pending = append(r.pending, req)
	}
	r.sendViewer(c.viewerID, requestState("pending"))
	r.sendRequests()
	return nil
}

func (r *Room) CancelRequest(c *Client) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !c.host && r.removePending(c.viewerID) {
		r.sendViewer(c.viewerID, requestState("none"))
		r.sendRequests()
	}
	return nil
}

func (r *Room) Release(c *Client) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if c.host || !r.isWriter(c) {
		return ErrNotWriter
	}
	r.setWriter("", "", "")
	return nil
}

func (r *Room) Grant(c *Client, viewerID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.host != c {
		return ErrNotHost
	}
	i := r.pendingIndex(viewerID)
	if i < 0 {
		return ErrNoRequest
	}
	name := r.pending[i].Name
	r.removePending(viewerID)
	r.sendRequests()
	r.setWriter(viewerID, name, "The host gave control to someone else.")
	return nil
}

func (r *Room) Deny(c *Client, viewerID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.host != c {
		return ErrNotHost
	}
	if !r.removePending(viewerID) {
		return ErrNoRequest
	}
	r.sendViewer(viewerID, requestState("denied"))
	r.sendRequests()
	return nil
}

func (r *Room) Revoke(c *Client) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.host != c {
		return ErrNotHost
	}
	r.setWriter("", "", "The host took back control.")
	return nil
}

func (r *Room) pendingIndex(id string) int {
	for i, p := range r.pending {
		if p.ViewerID == id {
			return i
		}
	}
	return -1
}

func (r *Room) removePending(id string) bool {
	i := r.pendingIndex(id)
	if i < 0 {
		return false
	}
	r.pending = append(r.pending[:i], r.pending[i+1:]...)
	return true
}

// cleanName strips control and format characters (incl. bidi overrides),
// trims, and caps the display name at MaxNameRunes.
func cleanName(s string) string {
	s = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || unicode.Is(unicode.Cf, r) {
			return -1
		}
		return r
	}, s)
	s = strings.TrimSpace(s)
	if r := []rune(s); len(r) > limits.MaxNameRunes {
		s = strings.TrimSpace(string(r[:limits.MaxNameRunes]))
	}
	if s == "" {
		return "Anonymous"
	}
	return s
}

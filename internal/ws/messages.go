package ws

import "livetype/internal/room"

// inbound is every client-to-server message; each type uses a subset of fields.
// Server-to-client messages are built by the room package.
type inbound struct {
	Type     string `json:"type"`
	Role     string `json:"role"`     // hello
	HostKey  string `json:"hostKey"`  // hello
	ViewerID string `json:"viewerId"` // hello, grant, deny
	Text     string `json:"text"`     // update
	Name     string `json:"name"`     // request_write
}

func dispatch(r *room.Room, c *room.Client, m inbound) error {
	switch m.Type {
	case "update":
		return r.Update(c, m.Text)
	case "request_write":
		return r.RequestWrite(c, m.Name)
	case "cancel_request":
		return r.CancelRequest(c)
	case "release_write":
		return r.Release(c)
	case "grant":
		return r.Grant(c, m.ViewerID)
	case "deny":
		return r.Deny(c, m.ViewerID)
	case "revoke":
		return r.Revoke(c)
	default:
		return room.ErrBadMessage
	}
}

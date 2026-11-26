package room

import (
	"sort"
	"strconv"
)

// The host's "Watching" list: who is connected, with a raised hand or the
// pen. Viewer IDs are never included; names are what viewers typed.

type watcher struct {
	Name   string `json:"name"`
	Hand   bool   `json:"hand,omitempty"`
	Writer bool   `json:"writer,omitempty"`
}

type watchersMsg struct {
	Type string    `json:"type"`
	List []watcher `json:"list"`
}

// SetName records the name a viewer typed, so the host sees it.
func (r *Room) SetName(c *Client, name string) error {
	if c.host {
		return ErrBadMessage
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.setName(c.viewerID, cleanName(name))
	return nil
}

func (r *Room) setName(id, name string) {
	if v := r.viewers[id]; v != nil && name != "" && v.name != name {
		v.name = name
		r.sendWatchers()
	}
}

func (r *Room) sendWatchers() {
	if r.host == nil {
		return
	}
	type row struct {
		n int
		w watcher
	}
	rows := []row{}
	for id, v := range r.viewers {
		if len(v.conns) == 0 {
			continue
		}
		name := v.name
		if name == "" {
			name = "Guest " + strconv.Itoa(v.n)
		}
		rows = append(rows, row{v.n, watcher{name, r.hands[id], r.writerID == id}})
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].n < rows[j].n })
	list := make([]watcher, len(rows))
	for i, x := range rows {
		list[i] = x.w
	}
	r.host.send(encode(watchersMsg{"watchers", list}))
}

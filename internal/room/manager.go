package room

import (
	"context"
	"errors"
	"log"
	"sync"
	"time"

	"livetype/internal/ids"
	"livetype/internal/limits"
)

var ErrTooManyRooms = errors.New("too many active rooms")

type Config struct {
	IdleTTL     time.Duration // delete a room this long after its host left
	MaxAge      time.Duration // delete a room this long after creation
	WriterGrace time.Duration // how long a disconnected viewer keeps write access / its request
}

type Manager struct {
	cfg   Config
	mu    sync.Mutex
	rooms map[string]*Room
}

func NewManager(cfg Config) *Manager {
	return &Manager{cfg: cfg, rooms: map[string]*Room{}}
}

// Create makes a room and returns its ID and host key. The key is not
// retrievable later.
func (m *Manager) Create() (id, hostKey string, err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.rooms) >= limits.MaxRooms {
		return "", "", ErrTooManyRooms
	}
	id = ids.RoomID()
	for m.rooms[id] != nil {
		id = ids.RoomID()
	}
	hostKey = ids.Key()
	m.rooms[id] = newRoom(id, hostKey, m.cfg.WriterGrace, time.Now())
	return id, hostKey, nil
}

func (m *Manager) Get(id string) *Room {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.rooms[id]
}

// Sweep deletes expired rooms and disconnects their clients.
func (m *Manager) Sweep(now time.Time) int {
	m.mu.Lock()
	var dead []*Room
	for id, r := range m.rooms {
		if r.expired(now, m.cfg.IdleTTL, m.cfg.MaxAge) {
			delete(m.rooms, id)
			dead = append(dead, r)
		}
	}
	m.mu.Unlock()
	for _, r := range dead {
		r.Close(CloseTerminal, "This session has ended.")
	}
	return len(dead)
}

// RunJanitor sweeps every interval until ctx is done.
func (m *Manager) RunJanitor(ctx context.Context, interval time.Duration) {
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-t.C:
			if n := m.Sweep(now); n > 0 {
				log.Printf("janitor: removed %d expired room(s)", n)
			}
		}
	}
}

// CloseAll disconnects every client, for shutdown. Clients will retry and
// find their room gone.
func (m *Manager) CloseAll() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, r := range m.rooms {
		r.Close(CloseGoingAway, "Server restarting.")
	}
}

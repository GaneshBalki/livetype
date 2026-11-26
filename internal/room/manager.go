package room

import (
	"context"
	"errors"
	"log"
	"sync"
	"time"

	"livetype/internal/ids"
	"livetype/internal/limits"
	"livetype/internal/store"
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
	store *store.Store // nil keeps rooms in memory only
}

func NewManager(cfg Config) *Manager {
	return &Manager{cfg: cfg, rooms: map[string]*Room{}}
}

// UseStore saves rooms to s and loads them back after a restart.
func (m *Manager) UseStore(s *store.Store) { m.store = s }

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

// Get returns the room, loading it from the store if it was saved before a
// restart. It returns nil for an unknown or expired room.
func (m *Manager) Get(id string) *Room {
	m.mu.Lock()
	r := m.rooms[id]
	m.mu.Unlock()
	if r != nil || m.store == nil {
		return r
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	data, err := m.store.Load(ctx, id)
	if err != nil {
		log.Printf("store: load %s: %v", id, err)
		return nil
	}
	now := time.Now()
	if data == nil {
		return nil
	}
	loaded, err := restore(id, data, m.cfg.WriterGrace, now)
	if err != nil {
		log.Printf("store: restore %s: %v", id, err)
		return nil
	}
	if loaded.expired(now, m.cfg.IdleTTL, m.cfg.MaxAge) {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if r := m.rooms[id]; r != nil {
		return r // loaded by another request meanwhile
	}
	if len(m.rooms) >= limits.MaxRooms {
		return nil
	}
	m.rooms[id] = loaded
	log.Printf("room %s restored", id)
	return loaded
}

// SaveAll writes every room that changed since its last save.
func (m *Manager) SaveAll(ctx context.Context) {
	if m.store == nil {
		return
	}
	m.mu.Lock()
	rooms := make([]*Room, 0, len(m.rooms))
	for _, r := range m.rooms {
		rooms = append(rooms, r)
	}
	m.mu.Unlock()
	for _, r := range rooms {
		data, ok := r.save()
		if !ok {
			continue
		}
		if err := m.store.Save(ctx, r.ID, r.created, data); err != nil {
			log.Printf("store: save %s: %v", r.ID, err)
			r.markDirty()
		}
	}
}

// RunSaver saves changed rooms every interval until ctx is done. A crash
// loses at most the last interval of typing.
func (m *Manager) RunSaver(ctx context.Context, interval time.Duration) {
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			m.SaveAll(ctx)
		}
	}
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
	if m.store != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		for _, r := range dead {
			if err := m.store.Delete(ctx, r.ID); err != nil {
				log.Printf("store: delete %s: %v", r.ID, err)
			}
		}
		// Rooms saved before a restart and never opened again.
		if err := m.store.Prune(ctx, m.cfg.MaxAge); err != nil {
			log.Printf("store: prune: %v", err)
		}
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

// End lets the host close their session now: everyone is disconnected, the
// host link stops working and the saved copy is deleted.
func (m *Manager) End(r *Room, c *Client) error {
	if !c.host {
		return ErrNotHost
	}
	m.mu.Lock()
	if m.rooms[r.ID] == r {
		delete(m.rooms, r.ID)
	}
	m.mu.Unlock()
	r.Close(CloseTerminal, "The host ended this session.")
	if m.store == nil {
		return nil
	}
	del := func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := m.store.Delete(ctx, r.ID); err != nil {
			log.Printf("store: delete %s: %v", r.ID, err)
		}
	}
	del()
	// A save that started just before Close could land after the delete.
	time.AfterFunc(5*time.Second, del)
	return nil
}

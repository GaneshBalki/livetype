package main

import (
	"net/http"
	"sync"
	"time"

	"livetype/internal/ws"
)

// Per-IP limits so one client cannot use up shared capacity: the global room
// cap (by creating rooms in a loop) or a room's viewer cap (by opening
// connections). A class behind one school network shares an IP, so the
// connection cap is generous.
const (
	roomsPerIP  = 10 // per roomsWindow
	roomsWindow = 10 * time.Minute
	roomsPerDay = 50 // sessions live up to 24 h, so this caps one network's share
	connsPerIP  = 60
)

type guard struct {
	mu    sync.Mutex
	rooms map[string][]time.Time // creation times within 24 h
	conns map[string]int         // open websockets
}

func newGuard() *guard {
	return &guard{rooms: map[string][]time.Time{}, conns: map[string]int{}}
}

// allowRoom records a room creation for ip, or reports that ip made too many.
func (g *guard) allowRoom(ip string, now time.Time) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	recent, short := g.rooms[ip][:0], 0
	for _, t := range g.rooms[ip] {
		if now.Sub(t) < 24*time.Hour {
			recent = append(recent, t)
			if now.Sub(t) < roomsWindow {
				short++
			}
		}
	}
	if short >= roomsPerIP || len(recent) >= roomsPerDay {
		g.rooms[ip] = recent
		return false
	}
	g.rooms[ip] = append(recent, now)
	return true
}

// prune drops IPs with no recent rooms so the map cannot grow without bound.
func (g *guard) prune(now time.Time) {
	g.mu.Lock()
	defer g.mu.Unlock()
	for ip, ts := range g.rooms {
		if len(ts) == 0 || now.Sub(ts[len(ts)-1]) >= 24*time.Hour {
			delete(g.rooms, ip)
		}
	}
}

// limitConns refuses a websocket when its IP already holds connsPerIP.
func (g *guard) limitConns(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := ws.ClientIP(r)
		g.mu.Lock()
		if g.conns[ip] >= connsPerIP {
			g.mu.Unlock()
			http.Error(w, "Too many connections from your network.", http.StatusTooManyRequests)
			return
		}
		g.conns[ip]++
		g.mu.Unlock()
		defer func() {
			g.mu.Lock()
			if g.conns[ip]--; g.conns[ip] <= 0 {
				delete(g.conns, ip)
			}
			g.mu.Unlock()
		}()
		next.ServeHTTP(w, r)
	})
}

package main

import (
	"testing"
	"time"
)

func TestAllowRoom(t *testing.T) {
	g, now := newGuard(), time.Now()
	for i := range roomsPerIP {
		if !g.allowRoom("1.2.3.4", now) {
			t.Fatalf("room %d refused", i+1)
		}
	}
	if g.allowRoom("1.2.3.4", now) {
		t.Fatal("room over the limit allowed")
	}
	if !g.allowRoom("5.6.7.8", now) {
		t.Fatal("another IP refused")
	}
	if !g.allowRoom("1.2.3.4", now.Add(roomsWindow)) {
		t.Fatal("refused after the window passed")
	}
	g.prune(now.Add(25 * time.Hour))
	if len(g.rooms) != 0 {
		t.Fatalf("prune left %d IPs", len(g.rooms))
	}
}

func TestRoomsPerDay(t *testing.T) {
	g, now := newGuard(), time.Now()
	allowed := 0
	for i := range 200 { // one room every 10 minutes for 33 hours
		if g.allowRoom("1.2.3.4", now.Add(time.Duration(i)*roomsWindow)) {
			allowed++
		}
	}
	// days 1 and 2 each allow roomsPerDay; 200 tries span < 1.4 days
	if allowed > 2*roomsPerDay || allowed < roomsPerDay {
		t.Fatalf("allowed %d", allowed)
	}
	if g.allowRoom("1.2.3.4", now.Add(199*roomsWindow+time.Minute)) {
		t.Fatal("over the daily cap allowed")
	}
}

package room

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"livetype/internal/limits"
)

func newTestRoom(t *testing.T) (*Room, *Client) {
	t.Helper()
	r := newRoom("room1", "secret", time.Hour, time.Now())
	h := NewClient()
	if err := r.JoinHost(h, "secret"); err != nil {
		t.Fatal(err)
	}
	return r, h
}

func joinViewer(t *testing.T, r *Room, id string) *Client {
	t.Helper()
	c := NewClient()
	if err := r.JoinViewer(c, id); err != nil {
		t.Fatal(err)
	}
	return c
}

// drain returns every queued message, decoded.
func drain(c *Client) []map[string]any {
	var out []map[string]any
	for {
		select {
		case b := <-c.out:
			var m map[string]any
			if err := json.Unmarshal(b, &m); err != nil {
				panic(err)
			}
			out = append(out, m)
		default:
			return out
		}
	}
}

// last returns the newest queued message of type typ, draining the rest.
func last(t *testing.T, c *Client, typ string) map[string]any {
	t.Helper()
	var found map[string]any
	for _, m := range drain(c) {
		if m["type"] == typ {
			found = m
		}
	}
	if found == nil {
		t.Fatalf("no %q message queued", typ)
	}
	return found
}

func wantErr(t *testing.T, got, want error) {
	t.Helper()
	if !errors.Is(got, want) {
		t.Fatalf("got error %v, want %v", got, want)
	}
}

func requestWrite(t *testing.T, r *Room, c *Client, name string) {
	t.Helper()
	if err := r.RequestWrite(c, name); err != nil {
		t.Fatal(err)
	}
}

func TestBadHostKey(t *testing.T) {
	r, _ := newTestRoom(t)
	wantErr(t, r.JoinHost(NewClient(), "wrong"), ErrBadKey)
}

func TestHostUpdateReachesViewersButNotSender(t *testing.T) {
	r, h := newTestRoom(t)
	v := joinViewer(t, r, "")
	drain(h)
	if err := r.Update(h, "hello"); err != nil {
		t.Fatal(err)
	}
	if s := last(t, v, "snapshot"); s["text"] != "hello" || s["rev"] != 1.0 {
		t.Fatalf("viewer snapshot = %v", s)
	}
	msgs := drain(h)
	if len(msgs) != 1 || msgs[0]["type"] != "ack" {
		t.Fatalf("host got %v, want only an ack", msgs)
	}
}

func TestNonWriterUpdateRejected(t *testing.T) {
	r, h := newTestRoom(t)
	v := joinViewer(t, r, "")
	r.Update(h, "original")
	wantErr(t, r.Update(v, "hijack"), ErrNotWriter)
	if r.text != "original" {
		t.Fatalf("text changed to %q", r.text)
	}
}

func TestTooLarge(t *testing.T) {
	r, h := newTestRoom(t)
	wantErr(t, r.Update(h, strings.Repeat("x", limits.MaxTextBytes+1)), ErrTooLarge)
}

func TestGrantDemotesPreviousWriter(t *testing.T) {
	r, h := newTestRoom(t)
	a, b := joinViewer(t, r, ""), joinViewer(t, r, "")
	requestWrite(t, r, a, "Ann")
	requestWrite(t, r, b, "Bob")

	if err := r.Grant(h, a.viewerID); err != nil {
		t.Fatal(err)
	}
	if m := last(t, a, "role"); m["role"] != "writer" {
		t.Fatalf("a role = %v", m)
	}
	if s := last(t, h, "snapshot"); s["writer"].(map[string]any)["name"] != "Ann" {
		t.Fatalf("host snapshot = %v", s)
	}
	wantErr(t, r.Update(h, "host types"), ErrNotWriter)
	if err := r.Update(a, "ann types"); err != nil {
		t.Fatal(err)
	}

	if err := r.Grant(h, b.viewerID); err != nil {
		t.Fatal(err)
	}
	if m := last(t, a, "role"); m["role"] != "viewer" {
		t.Fatalf("a not demoted: %v", m)
	}
	if m := last(t, b, "role"); m["role"] != "writer" {
		t.Fatalf("b role = %v", m)
	}
	wantErr(t, r.Update(a, "stale"), ErrNotWriter)
	if len(r.pending) != 0 {
		t.Fatalf("granted requests not cleared: %v", r.pending)
	}
}

func TestGrantNeedsPendingRequestAndHost(t *testing.T) {
	r, h := newTestRoom(t)
	a := joinViewer(t, r, "")
	wantErr(t, r.Grant(h, a.viewerID), ErrNoRequest)
	requestWrite(t, r, a, "Ann")
	wantErr(t, r.Grant(a, a.viewerID), ErrNotHost)
}

func TestDeny(t *testing.T) {
	r, h := newTestRoom(t)
	a := joinViewer(t, r, "")
	requestWrite(t, r, a, "Ann")
	if m := last(t, h, "requests"); len(m["list"].([]any)) != 1 {
		t.Fatalf("host requests = %v", m)
	}
	if err := r.Deny(h, a.viewerID); err != nil {
		t.Fatal(err)
	}
	if m := last(t, a, "request_state"); m["state"] != "denied" {
		t.Fatalf("a state = %v", m)
	}
	if m := last(t, h, "requests"); len(m["list"].([]any)) != 0 {
		t.Fatalf("host requests = %v", m)
	}
}

func TestRevokeAndRelease(t *testing.T) {
	r, h := newTestRoom(t)
	a := joinViewer(t, r, "")

	requestWrite(t, r, a, "Ann")
	r.Grant(h, a.viewerID)
	drain(h)
	if err := r.Revoke(h); err != nil {
		t.Fatal(err)
	}
	if m := last(t, a, "role"); m["role"] != "viewer" || m["reason"] == "" {
		t.Fatalf("a after revoke = %v", m)
	}
	if m := last(t, h, "role"); m["role"] != "host" {
		t.Fatalf("host after revoke = %v", m)
	}
	wantErr(t, r.Update(a, "x"), ErrNotWriter)
	if err := r.Update(h, "x"); err != nil {
		t.Fatal(err)
	}

	requestWrite(t, r, a, "Ann")
	r.Grant(h, a.viewerID)
	drain(h)
	if err := r.Release(a); err != nil {
		t.Fatal(err)
	}
	if m := last(t, h, "role"); m["role"] != "host" {
		t.Fatalf("host after release = %v", m)
	}
	wantErr(t, r.Release(a), ErrNotWriter)
	wantErr(t, r.Release(h), ErrNotWriter)
}

func TestWriterRefreshKeepsPenThenDisconnectReturnsIt(t *testing.T) {
	r, h := newTestRoom(t)
	a := joinViewer(t, r, "")
	id := a.viewerID
	requestWrite(t, r, a, "Ann")
	r.Grant(h, id)

	// Refresh: drop and rejoin with the stored ID inside the grace period.
	r.Leave(a)
	a2 := joinViewer(t, r, id)
	if a2.viewerID != id {
		t.Fatalf("id changed on rejoin: %q -> %q", id, a2.viewerID)
	}
	if w := last(t, a2, "welcome"); w["role"] != "writer" {
		t.Fatalf("rejoined writer welcome = %v", w)
	}

	// Real disconnect: grace period passes with no connection.
	r.Leave(a2)
	drain(h)
	r.forget(id)
	if r.writerID != "" {
		t.Fatal("writer kept the pen after the grace period")
	}
	if m := last(t, h, "role"); m["role"] != "host" {
		t.Fatalf("host = %v", m)
	}
	if a3 := joinViewer(t, r, id); a3.viewerID == id {
		t.Fatal("forgotten viewer ID was still recognized")
	}
}

func TestDisconnectedViewerRequestExpires(t *testing.T) {
	r, h := newTestRoom(t)
	a := joinViewer(t, r, "")
	requestWrite(t, r, a, "Ann")
	r.Leave(a)
	drain(h)
	r.forget(a.viewerID)
	if m := last(t, h, "requests"); len(m["list"].([]any)) != 0 {
		t.Fatalf("stale request survived: %v", m)
	}
}

func TestGraceTimerFires(t *testing.T) {
	r := newRoom("room1", "secret", 10*time.Millisecond, time.Now())
	h := NewClient()
	r.JoinHost(h, "secret")
	a := joinViewer(t, r, "")
	requestWrite(t, r, a, "Ann")
	r.Grant(h, a.viewerID)
	r.Leave(a)
	deadline := time.Now().Add(time.Second)
	for {
		r.mu.Lock()
		w := r.writerID
		r.mu.Unlock()
		if w == "" {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("grace timer never returned the pen to the host")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestDuplicateRequestReplaces(t *testing.T) {
	r, h := newTestRoom(t)
	a := joinViewer(t, r, "")
	requestWrite(t, r, a, "First")
	requestWrite(t, r, a, "Second")
	list := last(t, h, "requests")["list"].([]any)
	if len(list) != 1 || list[0].(map[string]any)["name"] != "Second" {
		t.Fatalf("requests = %v", list)
	}
}

func TestPendingRequestLimit(t *testing.T) {
	r, _ := newTestRoom(t)
	for range limits.MaxPending {
		requestWrite(t, r, joinViewer(t, r, ""), "v")
	}
	wantErr(t, r.RequestWrite(joinViewer(t, r, ""), "one too many"), ErrQueueFull)
}

func TestViewerLimit(t *testing.T) {
	r, _ := newTestRoom(t)
	for range limits.MaxViewers {
		joinViewer(t, r, "")
	}
	wantErr(t, r.JoinViewer(NewClient(), ""), ErrRoomFull)
}

func TestSecondHostTabReplacesFirst(t *testing.T) {
	r, h := newTestRoom(t)
	h2 := NewClient()
	if err := r.JoinHost(h2, "secret"); err != nil {
		t.Fatal(err)
	}
	select {
	case <-h.Done():
	default:
		t.Fatal("old host connection not closed")
	}
	wantErr(t, r.Update(h, "from old tab"), ErrNotWriter)
	if err := r.Update(h2, "from new tab"); err != nil {
		t.Fatal(err)
	}
}

func TestSlowClientDropped(t *testing.T) {
	r, h := newTestRoom(t)
	v := joinViewer(t, r, "")
	for range limits.SendBuffer + 1 {
		r.Update(h, "x")
	}
	select {
	case <-v.Done():
	default:
		t.Fatal("viewer with a full buffer was not dropped")
	}
}

func TestCleanName(t *testing.T) {
	for in, want := range map[string]string{
		"  Ann  ":                   "Ann",
		"a\x00b\nc‮d":               "abcd",
		"":                          "Anonymous",
		" \t ":                      "Anonymous",
		strings.Repeat("é", 30):     strings.Repeat("é", limits.MaxNameRunes),
		"<script>alert(1)</script>": "<script>alert(1)</script", // rendered with textContent, never parsed
	} {
		if got := cleanName(in); got != want {
			t.Errorf("cleanName(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestExpiry(t *testing.T) {
	m := NewManager(Config{IdleTTL: time.Hour, MaxAge: 24 * time.Hour, WriterGrace: time.Second})
	id, key, err := m.Create()
	if err != nil {
		t.Fatal(err)
	}
	r := m.Get(id)
	t0 := r.created

	// The host never connected: idle since creation.
	if n := m.Sweep(t0.Add(59 * time.Minute)); n != 0 {
		t.Fatal("room removed before the idle TTL")
	}

	// A connected host keeps the room alive past the idle TTL...
	h := NewClient()
	r.JoinHost(h, key)
	if n := m.Sweep(t0.Add(2 * time.Hour)); n != 0 {
		t.Fatal("room with a connected host was removed")
	}
	// ...but not past the max age.
	if n := m.Sweep(t0.Add(24 * time.Hour)); n != 1 || m.Get(id) != nil {
		t.Fatal("room not removed at max age")
	}
	select {
	case <-h.Done():
	default:
		t.Fatal("host not disconnected when the room expired")
	}
	wantErr(t, r.JoinViewer(NewClient(), ""), ErrClosed)
}

func TestExpiryAfterHostLeaves(t *testing.T) {
	m := NewManager(Config{IdleTTL: time.Hour, MaxAge: 24 * time.Hour})
	id, key, _ := m.Create()
	r := m.Get(id)
	h := NewClient()
	r.JoinHost(h, key)
	r.Leave(h)
	left := r.hostLeft
	if m.Sweep(left.Add(59*time.Minute)) != 0 {
		t.Fatal("removed too early")
	}
	if m.Sweep(left.Add(time.Hour)) != 1 {
		t.Fatal("idle room not removed")
	}
}

func TestRoomCap(t *testing.T) {
	m := NewManager(Config{IdleTTL: time.Hour, MaxAge: time.Hour})
	for range limits.MaxRooms {
		if _, _, err := m.Create(); err != nil {
			t.Fatal(err)
		}
	}
	if _, _, err := m.Create(); !errors.Is(err, ErrTooManyRooms) {
		t.Fatalf("got %v, want ErrTooManyRooms", err)
	}
}

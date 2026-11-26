package room

import (
	"context"
	"os"
	"testing"
	"time"

	"livetype/internal/store"
)

// typeText makes one update per string, each recorded as its own playback frame.
func typeText(t *testing.T, r *Room, c *Client, texts ...string) {
	t.Helper()
	for _, s := range texts {
		r.lastFrame = time.Time{}
		if err := r.Update(c, s); err != nil {
			t.Fatal(err)
		}
	}
}

func TestSaveRestore(t *testing.T) {
	r, h := newTestRoom(t)
	typeText(t, r, h, "hé", "héllo 👋", "<b>héllo</b> 👋 world")
	v := joinViewer(t, r, "")
	if err := r.Ask(v, "Ann", "why?"); err != nil {
		t.Fatal(err)
	}
	if err := r.Answer(h, "1", "because"); err != nil {
		t.Fatal(err)
	}
	want := replay(history(t, r, h))

	data, ok := r.save()
	if !ok {
		t.Fatal("dirty room not saved")
	}
	if _, ok := r.save(); ok {
		t.Fatal("unchanged room saved twice")
	}

	got, err := restore("room1", data, time.Hour, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if got.text != r.text || got.rev != r.rev || !got.created.Equal(r.created) {
		t.Fatalf("restored %q rev %d, want %q rev %d", got.text, got.rev, r.text, r.rev)
	}
	if err := got.JoinHost(NewClient(), "wrong"); err != ErrBadKey {
		t.Fatalf("wrong key: %v", err)
	}
	h2 := NewClient()
	if err := got.JoinHost(h2, "secret"); err != nil {
		t.Fatalf("host key after restore: %v", err)
	}
	if replay(history(t, got, h2)) != want || want != r.text {
		t.Fatal("playback differs after restore")
	}
	if len(got.questions) != 1 || got.questions[0].Answer != "because" || got.questions[0].viewerID != "" {
		t.Fatalf("questions: %+v", got.questions)
	}
	if got.writerID != "" || len(got.viewers) != 0 {
		t.Fatal("pen should be with the host and no viewers kept")
	}
	typeText(t, got, h2, "next") // keeps recording after restore
	if replay(history(t, got, h2)) != "next" {
		t.Fatal("recording broken after restore")
	}
}

// TestStoreRestart needs a Postgres: TEST_DATABASE_URL=postgres://... go test ./...
func TestStoreRestart(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	st, err := store.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	cfg := Config{IdleTTL: time.Hour, MaxAge: 24 * time.Hour, WriterGrace: time.Second}

	m := NewManager(cfg)
	m.UseStore(st)
	id, key, err := m.Create()
	if err != nil {
		t.Fatal(err)
	}
	r := m.Get(id)
	h := NewClient()
	if err := r.JoinHost(h, key); err != nil {
		t.Fatal(err)
	}
	typeText(t, r, h, "saved text")
	m.SaveAll(ctx)

	m2 := NewManager(cfg) // a restarted server
	m2.UseStore(st)
	r2 := m2.Get(id)
	if r2 == nil || r2.text != "saved text" {
		t.Fatalf("not restored: %+v", r2)
	}
	if err := r2.JoinHost(NewClient(), key); err != nil {
		t.Fatal(err)
	}
	if m2.Get("nosuchroom") != nil {
		t.Fatal("unknown room should be nil")
	}

	// An expired room is deleted from the store too.
	r2.created = time.Now().Add(-25 * time.Hour)
	m2.Sweep(time.Now())
	if m3 := NewManager(cfg); func() bool { m3.UseStore(st); return m3.Get(id) != nil }() {
		t.Fatal("expired room still in the store")
	}
}

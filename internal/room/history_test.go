package room

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"livetype/internal/limits"
)

// replay applies frames like the browser does: byte splices on UTF-8.
func replay(h historyMsg) string {
	b := []byte(h.Base)
	for _, f := range h.Frames {
		b = append(append(append([]byte{}, b[:f.At]...), f.Ins...), b[f.At+f.Del:]...)
	}
	return string(b)
}

func history(t *testing.T, r *Room, c *Client) historyMsg {
	t.Helper()
	c.lastHistory = time.Time{}
	if err := r.History(c); err != nil {
		t.Fatal(err)
	}
	var h historyMsg
	for _, m := range drain(c) {
		if m["type"] == "history" {
			b, _ := json.Marshal(m)
			json.Unmarshal(b, &h)
		}
	}
	return h
}

func TestSplice(t *testing.T) {
	for _, c := range [][2]string{
		{"", "abc"}, {"abc", ""}, {"abc", "abXc"}, {"héllo", "hállo"}, {"a😀b", "a😃b"},
		{"aaa", "aaaa"}, {"<b>x</b>", "<b>xy</b>"}, {"日本", "日本語"}, {"same", "same"},
	} {
		at, del, ins := splice(c[0], c[1])
		if got := c[0][:at] + ins + c[0][at+del:]; got != c[1] {
			t.Errorf("splice(%q,%q) gives %q", c[0], c[1], got)
		}
		if !json.Valid([]byte(`"` + strings.ReplaceAll(ins, `"`, `\"`) + `"`)) || strings.ContainsRune(ins, '�') {
			t.Errorf("splice(%q,%q) split a character: %q", c[0], c[1], ins)
		}
	}
}

func TestHistoryReplaysToCurrentText(t *testing.T) {
	r, h := newTestRoom(t)
	v := joinViewer(t, r, "")
	for _, s := range []string{"h", "he", "hé😀", "hé😀 <b>bold</b>"} {
		r.Update(h, s)
		r.lastFrame = time.Time{} // pretend a second passed
	}
	r.Update(h, "hé😀 <b>bold</b>!") // within the second: recorded on request
	r.RequestWrite(v, "Ann")
	r.Grant(h, v.viewerID)
	r.Update(v, "Ann wrote this")
	got := history(t, r, v)
	if replay(got) != "Ann wrote this" {
		t.Fatalf("replay gives %q", replay(got))
	}
	n := len(got.Frames)
	if got.Frames[n-1].W != "Ann" || got.Frames[n-2].W != "" || got.Frames[n-2].Ins == "" {
		t.Fatalf("writer names wrong: %+v", got.Frames[n-2:])
	}
	if r.History(v) != ErrHistoryTooSoon {
		t.Fatal("history not rate limited")
	}
}

func TestHistoryTrimsOldestIntoBase(t *testing.T) {
	r, h := newTestRoom(t)
	big := strings.Repeat("x", 100<<10)
	text := ""
	for i := 0; i < 15; i++ { // 1.5 MB of inserts > 1 MB cap
		text += big
		r.Update(h, text[:min(len(text), limits.MaxTextBytes)])
		r.lastFrame = time.Time{}
		if len(text) > limits.MaxTextBytes {
			text = ""
		}
	}
	got := history(t, r, h)
	if r.histBytes > limits.MaxHistoryBytes || len(got.Frames) >= 15 {
		t.Fatalf("not trimmed: %d bytes, %d frames", r.histBytes, len(got.Frames))
	}
	if replay(got) != r.text {
		t.Fatal("trimmed history no longer replays to the current text")
	}
}

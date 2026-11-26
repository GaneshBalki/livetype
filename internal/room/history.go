package room

import (
	"time"
	"unicode/utf8"

	"livetype/internal/limits"
)

// Typing playback. The room records how the text changed, at most once per
// second, as byte-offset splices against the previous recorded text. Once the
// record passes limits.MaxHistoryBytes the oldest frames are folded into base,
// so a long session keeps its most recent part.

type frame struct {
	T   int64  `json:"t"`           // ms since the room was created
	At  int    `json:"at"`          // byte offset in the previous text
	Del int    `json:"del"`         // bytes removed at At
	Ins string `json:"ins"`         // text inserted at At
	W   string `json:"w,omitempty"` // writer's name, "" for the host
}

type historyMsg struct {
	Type   string  `json:"type"`
	Base   string  `json:"base"`
	BaseT  int64   `json:"baseT"`
	BaseW  string  `json:"baseW,omitempty"`
	Frames []frame `json:"frames"`
}

const frameOverhead = 48 // rough JSON + struct cost per frame, so tiny frames still count

var ErrHistoryTooSoon = &Error{"rate_limited", "Replay was just loaded, try again in a few seconds."}

// History sends the recording to c. One request per limits.HistoryEvery per connection.
func (r *Room) History(c *Client) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now()
	if now.Sub(c.lastHistory) < limits.HistoryEvery {
		return ErrHistoryTooSoon
	}
	c.lastHistory = now
	r.record() // include edits from the last second
	c.send(encode(historyMsg{"history", r.base, r.baseT, r.baseW, append([]frame{}, r.frames...)}))
	return nil
}

// noteEdit is called after every accepted update.
func (r *Room) noteEdit(now time.Time) {
	r.lastEdit = now
	if now.Sub(r.lastFrame) >= time.Second {
		r.record()
	}
}

// record appends the change from the last recorded text to the current one.
func (r *Room) record() {
	if r.text == r.recorded {
		return
	}
	at, del, ins := splice(r.recorded, r.text)
	r.frames = append(r.frames, frame{r.lastEdit.Sub(r.created).Milliseconds(), at, del, ins, r.writerName})
	r.histBytes += len(ins) + frameOverhead
	r.recorded = r.text
	r.lastFrame = r.lastEdit
	for r.histBytes > limits.MaxHistoryBytes && len(r.frames) > 0 {
		f := r.frames[0]
		r.base = r.base[:f.At] + f.Ins + r.base[f.At+f.Del:]
		r.baseT, r.baseW = f.T, f.W
		r.histBytes -= len(f.Ins) + frameOverhead
		r.frames = r.frames[1:]
	}
}

// splice finds the smallest edit turning old into new: keep a common prefix
// and suffix, replace the middle. Cuts land on UTF-8 boundaries so ins is
// valid text (JSON would otherwise mangle a split character).
func splice(old, new string) (at, del int, ins string) {
	n := min(len(old), len(new))
	p := 0
	for p < n && old[p] == new[p] {
		p++
	}
	for p > 0 && !(boundary(old, p) && boundary(new, p)) {
		p--
	}
	s := 0
	for s < n-p && old[len(old)-1-s] == new[len(new)-1-s] {
		s++
	}
	for s > 0 && !(boundary(old, len(old)-s) && boundary(new, len(new)-s)) {
		s--
	}
	return p, len(old) - p - s, new[p : len(new)-s]
}

func boundary(s string, i int) bool { return i == len(s) || utf8.RuneStart(s[i]) }

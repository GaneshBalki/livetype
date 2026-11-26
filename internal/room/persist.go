package room

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"io"
	"time"

	"livetype/internal/limits"
)

// saved is the part of a room that survives a restart: the text, questions
// and playback record. Connections, write requests and raised hands do not;
// after a restart the pen is back with the host and viewers rejoin.
type saved struct {
	KeyHash   [32]byte   `json:"keyHash"`
	Created   time.Time  `json:"created"`
	Text      string     `json:"text"`
	Rev       int64      `json:"rev"`
	Questions []question `json:"questions"` // viewer IDs are dropped (unexported field)
	NextQ     int        `json:"nextQ"`
	Base      string     `json:"base"`
	BaseW     string     `json:"baseW"`
	BaseT     int64      `json:"baseT"`
	Recorded  string     `json:"recorded"`
	Frames    []frame    `json:"frames"`
	HistBytes int        `json:"histBytes"`
	LastFrame time.Time  `json:"lastFrame"`
}

// save returns the room's gzipped state if it changed since the last call.
func (r *Room) save() ([]byte, bool) {
	r.mu.Lock()
	if !r.dirty || r.closed {
		r.mu.Unlock()
		return nil, false
	}
	r.dirty = false
	b := encode(saved{r.keyHash, r.created, r.text, r.rev, r.questions, r.nextQ,
		r.base, r.baseW, r.baseT, r.recorded, r.frames, r.histBytes, r.lastFrame})
	r.mu.Unlock()
	var z bytes.Buffer
	w := gzip.NewWriter(&z)
	w.Write(b)
	w.Close()
	return z.Bytes(), true
}

// markDirty retries the save next time, after a failed write.
func (r *Room) markDirty() {
	r.mu.Lock()
	r.dirty = true
	r.mu.Unlock()
}

// restore rebuilds a room from save's output. The host counts as just left,
// so it has the idle TTL to come back.
func restore(id string, data []byte, grace time.Duration, now time.Time) (*Room, error) {
	zr, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	b, err := io.ReadAll(io.LimitReader(zr, 16*limits.MaxHistoryBytes))
	if err != nil {
		return nil, err
	}
	var s saved
	if err := json.Unmarshal(b, &s); err != nil {
		return nil, err
	}
	r := newRoom(id, "", grace, now)
	r.keyHash, r.created = s.KeyHash, s.Created
	r.text, r.rev = s.Text, s.Rev
	r.questions, r.nextQ = s.Questions, s.NextQ
	r.base, r.baseW, r.baseT, r.recorded = s.Base, s.BaseW, s.BaseT, s.Recorded
	r.frames, r.histBytes, r.lastFrame = s.Frames, s.HistBytes, s.LastFrame
	return r, nil
}

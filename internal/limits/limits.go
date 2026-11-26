// Package limits holds the server's size caps, timeouts and the per-connection rate limiter.
package limits

import "time"

const (
	MaxTextBytes    = 200 << 10 // largest accepted document
	MaxMessageBytes = 256 << 10 // websocket read limit
	MaxViewers      = 200       // viewer connections per room
	MaxPending      = 20        // pending write requests per room
	MaxLife         = 7 * 24 * time.Hour // a host can reset the 24 h timer, but no room lives longer
	MaxRooms        = 300       // ponytail: a maxed-out room holds ~0.7 MB; sized for Render free (512 MB). Raise with a bigger plan.
	MaxNameRunes    = 24

	MaxQuestionRunes = 280 // question or answer length
	MaxQuestions     = 50  // questions kept per room
	MaxOpenQuestions = 3   // unanswered questions per viewer
	// Per network (IP), so one person reconnecting as many viewers cannot
	// fill a room's lists. A class on one school network shares these.
	MaxOpenQuestionsPerIP = 15
	MaxPendingPerIP       = 8
	ReactEvery            = 300 * time.Millisecond

	// ponytail: per-room playback cap; 1000 rooms could hold 1 GB. Lower
	// MaxRooms or move history to disk if memory gets tight.
	MaxHistoryBytes = 512 << 10
	HistoryEvery    = 3 * time.Second

	MessagesPerSecond = 30
	MessageBurst      = 10

	SendBuffer   = 32 // queued outbound messages before a slow client is dropped
	HelloTimeout = 5 * time.Second
	WriteTimeout = 10 * time.Second
	PingInterval = 25 * time.Second
)

// Limiter is a token bucket. It is not safe for concurrent use; each
// connection's read loop owns one.
type Limiter struct {
	tokens float64
	last   time.Time
}

func (l *Limiter) Allow(now time.Time) bool {
	if l.last.IsZero() {
		l.tokens = MessageBurst
	} else {
		l.tokens = min(MessageBurst, l.tokens+now.Sub(l.last).Seconds()*MessagesPerSecond)
	}
	l.last = now
	if l.tokens < 1 {
		return false
	}
	l.tokens--
	return true
}

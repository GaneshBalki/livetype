// Package limits holds the server's size caps, timeouts and the per-connection rate limiter.
package limits

import "time"

const (
	MaxTextBytes    = 200 << 10 // largest accepted document
	MaxMessageBytes = 256 << 10 // websocket read limit
	MaxViewers      = 200       // viewer connections per room
	MaxPending      = 20        // pending write requests per room
	MaxRooms        = 1000
	MaxNameRunes    = 24

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

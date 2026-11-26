package room

import (
	"strconv"
	"strings"
	"time"
	"unicode"

	"livetype/internal/limits"
)

// Viewer interaction: emoji reactions, raised hands and questions. None of it
// touches the document, so it never interrupts the writer.

var (
	ErrBadEmoji      = &Error{"bad_message", "That reaction is not available."}
	ErrTooFast       = &Error{"rate_limited", "Slow down a little."}
	ErrEmptyQuestion = &Error{"bad_message", "Type a question first."}
	ErrTooManyAsked  = &Error{"room_full", "You have 3 open questions. Wait for an answer first."}
	ErrQuestionsFull = &Error{"room_full", "The question list is full, try again later."}
	ErrNoQuestion    = &Error{"bad_message", "That question no longer exists."}
)

// Emojis is the fixed reaction set; anything else is rejected, so viewers
// cannot broadcast arbitrary text through reactions.
var Emojis = map[string]bool{"👍": true, "❤️": true, "😂": true, "👏": true, "🎉": true, "🤔": true}

type question struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Text     string `json:"text"`
	Answer   string `json:"answer,omitempty"`
	Mine     bool   `json:"mine,omitempty"`
	viewerID string // never sent: viewer IDs are credentials
}

type (
	reactionMsg struct {
		Type  string `json:"type"`
		Emoji string `json:"emoji"`
	}
	handMsg struct {
		Type string `json:"type"`
		Up   bool   `json:"up"`
	}
	handsMsg struct {
		Type  string `json:"type"`
		Count int    `json:"count"`
	}
	questionsMsg struct {
		Type string     `json:"type"`
		List []question `json:"list"`
	}
)

// React broadcasts an emoji to everyone. Each connection may react at most
// once per limits.ReactEvery, so 200 viewers cannot flood the room.
func (r *Room) React(c *Client, emoji string) error {
	if !Emojis[emoji] {
		return ErrBadEmoji
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now()
	if now.Sub(c.lastReact) < limits.ReactEvery {
		return nil // dropped quietly: a fast double click is not an error
	}
	c.lastReact = now
	r.broadcast(encode(reactionMsg{"reaction", emoji}), nil)
	return nil
}

// Hand raises or lowers the viewer's hand. The host sees only the count.
func (r *Room) Hand(c *Client, up bool) error {
	if c.host {
		return ErrBadMessage
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.setHand(c.viewerID, up)
	return nil
}

// LowerHands is the host's "lower all".
func (r *Room) LowerHands(c *Client) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.host != c {
		return ErrNotHost
	}
	for id := range r.hands {
		r.setHand(id, false)
	}
	return nil
}

func (r *Room) setHand(id string, up bool) {
	if r.hands[id] == up {
		return
	}
	if up {
		r.hands[id] = true
	} else {
		delete(r.hands, id)
	}
	r.sendViewer(id, encode(handMsg{"hand", up}))
	r.sendHands()
}

func (r *Room) sendHands() {
	if r.host != nil {
		r.host.send(encode(handsMsg{"hands", len(r.hands)}))
	}
}

// Ask adds a question. It is visible to the host and the asker until the
// host answers it, then to everyone.
func (r *Room) Ask(c *Client, name, text string) error {
	if c.host {
		return ErrBadMessage
	}
	text = cleanText(text, limits.MaxQuestionRunes)
	if text == "" {
		return ErrEmptyQuestion
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	open := 0
	for _, q := range r.questions {
		if q.viewerID == c.viewerID && q.Answer == "" {
			open++
		}
	}
	if open >= limits.MaxOpenQuestions {
		return ErrTooManyAsked
	}
	if len(r.questions) >= limits.MaxQuestions {
		return ErrQuestionsFull
	}
	r.nextQ++
	r.questions = append(r.questions, question{
		ID: strconv.Itoa(r.nextQ), Name: cleanName(name), Text: text, viewerID: c.viewerID,
	})
	r.sendQuestions()
	return nil
}

// Answer publishes the host's reply; an answered question is shown to all.
func (r *Room) Answer(c *Client, id, text string) error {
	text = cleanText(text, limits.MaxQuestionRunes)
	if text == "" {
		return ErrEmptyQuestion
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.host != c {
		return ErrNotHost
	}
	i := r.questionIndex(id)
	if i < 0 {
		return ErrNoQuestion
	}
	r.questions[i].Answer = text
	r.sendQuestions()
	return nil
}

// Dismiss removes a question for everyone.
func (r *Room) Dismiss(c *Client, id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.host != c {
		return ErrNotHost
	}
	i := r.questionIndex(id)
	if i < 0 {
		return ErrNoQuestion
	}
	r.questions = append(r.questions[:i], r.questions[i+1:]...)
	r.sendQuestions()
	return nil
}

func (r *Room) questionIndex(id string) int {
	for i, q := range r.questions {
		if q.ID == id {
			return i
		}
	}
	return -1
}

// questionsFor is the list one client may see.
func (r *Room) questionsFor(c *Client) []byte {
	list := []question{}
	for _, q := range r.questions {
		mine := !c.host && q.viewerID == c.viewerID
		if c.host || mine || q.Answer != "" {
			q.Mine = mine
			list = append(list, q)
		}
	}
	return encode(questionsMsg{"questions", list})
}

func (r *Room) sendQuestions() {
	if r.host != nil {
		r.host.send(r.questionsFor(r.host))
	}
	for _, v := range r.viewers {
		for c := range v.conns {
			c.send(r.questionsFor(c))
		}
	}
}

// cleanText strips control and format characters except newlines, trims,
// and caps the length. The client shows it as text, never as HTML.
func cleanText(s string, max int) string {
	s = strings.Map(func(r rune) rune {
		if r == '\n' {
			return r
		}
		if unicode.IsControl(r) || unicode.Is(unicode.Cf, r) {
			return -1
		}
		return r
	}, s)
	s = strings.TrimSpace(s)
	if rs := []rune(s); len(rs) > max {
		s = strings.TrimSpace(string(rs[:max]))
	}
	return s
}

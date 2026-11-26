package room

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestReactionsAllowlistAndThrottle(t *testing.T) {
	r, h := newTestRoom(t)
	v := joinViewer(t, r, "")
	drain(h)
	drain(v)
	if r.React(v, "<b>x</b>") != ErrBadEmoji {
		t.Fatal("non-allowlisted emoji accepted")
	}
	if err := r.React(v, "👍"); err != nil {
		t.Fatal(err)
	}
	r.React(v, "👍") // inside ReactEvery: dropped
	if got := last(t, h, "reaction")["emoji"]; got != "👍" {
		t.Fatalf("host got %v", got)
	}
	if n := len(drain(v)); n != 1 {
		t.Fatalf("throttle: viewer got %d reactions, want 1", n)
	}
	v.lastReact = time.Time{}
	r.React(v, "🎉")
	last(t, h, "reaction")
}

func TestHands(t *testing.T) {
	r, h := newTestRoom(t)
	v := joinViewer(t, r, "")
	drain(h)
	r.Hand(v, true)
	if last(t, h, "hands")["count"] != 1.0 || last(t, v, "hand")["up"] != true {
		t.Fatal("hand not raised")
	}
	if r.LowerHands(v) != ErrNotHost {
		t.Fatal("viewer lowered all hands")
	}
	r.LowerHands(h)
	if last(t, h, "hands")["count"] != 0.0 || last(t, v, "hand")["up"] != false {
		t.Fatal("hands not lowered")
	}
	// A rejoin restores the raised state.
	r.Hand(v, true)
	v2 := joinViewer(t, r, v.viewerID)
	if last(t, v2, "hand")["up"] != true {
		t.Fatal("hand state lost on reconnect")
	}
}

func TestQuestionsVisibility(t *testing.T) {
	r, h := newTestRoom(t)
	asker := joinViewer(t, r, "")
	other := joinViewer(t, r, "")
	drain(h)
	drain(other)
	if r.Ask(asker, "Ann", "  ‮ ") != ErrEmptyQuestion {
		t.Fatal("blank question accepted")
	}
	if err := r.Ask(asker, "Ann", "Why <b>Go</b>?\x00"); err != nil {
		t.Fatal(err)
	}
	hl := last(t, h, "questions")["list"].([]any)
	q := hl[0].(map[string]any)
	if q["text"] != "Why <b>Go</b>?" || q["name"] != "Ann" || q["viewerId"] != nil {
		t.Fatalf("host sees %v", q)
	}
	if l := last(t, asker, "questions")["list"].([]any); len(l) != 1 || l[0].(map[string]any)["mine"] != true {
		t.Fatalf("asker sees %v", l)
	}
	if l := last(t, other, "questions")["list"].([]any); len(l) != 0 {
		t.Fatal("unanswered question leaked to another viewer")
	}
	if r.Answer(asker, "1", "x") != ErrNotHost {
		t.Fatal("viewer answered")
	}
	r.Answer(h, "1", "Simplicity.")
	if l := last(t, other, "questions")["list"].([]any); len(l) != 1 || l[0].(map[string]any)["answer"] != "Simplicity." {
		t.Fatalf("answered question not public: %v", l)
	}
	r.Dismiss(h, "1")
	if l := last(t, other, "questions")["list"].([]any); len(l) != 0 {
		t.Fatal("dismissed question still shown")
	}
	if r.Dismiss(h, "1") != ErrNoQuestion {
		t.Fatal("double dismiss")
	}
}

func TestQuestionLimits(t *testing.T) {
	r, _ := newTestRoom(t)
	v := joinViewer(t, r, "")
	for i := 0; i < 3; i++ {
		if err := r.Ask(v, "A", "q"); err != nil {
			t.Fatal(err)
		}
	}
	if r.Ask(v, "A", "q") != ErrTooManyAsked {
		t.Fatal("4th open question accepted")
	}
	r.Ask(joinViewer(t, r, ""), "B", strings.Repeat("é", 500))
	if n := len([]rune(r.questions[3].Text)); n != 280 {
		t.Fatalf("question not capped: %d runes", n)
	}
}

func TestWatchers(t *testing.T) {
	r, h := newTestRoom(t)
	a := joinViewer(t, r, "")
	joinViewer(t, r, "")
	r.SetName(a, " Asha‮ ")
	r.Hand(a, true)
	m := last(t, h, "watchers")
	list := m["list"].([]any)
	first, second := list[0].(map[string]any), list[1].(map[string]any)
	if len(list) != 2 || first["name"] != "Asha" || first["hand"] != true || second["name"] != "Guest 2" {
		t.Fatalf("watchers = %v", m)
	}
	if strings.Contains(fmt.Sprint(m), a.viewerID) {
		t.Fatal("viewer ID leaked to host list")
	}
	r.Leave(a)
	if n := len(last(t, h, "watchers")["list"].([]any)); n != 1 {
		t.Fatalf("after leave: %d watchers", n)
	}
}

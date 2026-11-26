package store

import (
	"context"
	"strings"
	"testing"
)

func TestOpenRefusesPlainTextRemote(t *testing.T) {
	_, err := Open(context.Background(), "postgres://u:secretpw@db.example.com/x?sslmode=disable")
	if err == nil || strings.Contains(err.Error(), "secretpw") {
		t.Fatalf("want a TLS error without the password, got %v", err)
	}
}

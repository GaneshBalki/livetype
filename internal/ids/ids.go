// Package ids generates room IDs and secret keys from crypto/rand.
package ids

import (
	"crypto/rand"
	"encoding/base32"
	"encoding/base64"
)

// Crockford's alphabet: lowercase, no i/l/o/u, so IDs read back unambiguously.
var roomEncoding = base32.NewEncoding("0123456789abcdefghjkmnpqrstvwxyz").WithPadding(base32.NoPadding)

func random(n int) []byte {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic("ids: crypto/rand failed: " + err.Error())
	}
	return b
}

// RoomID returns an 8-character base32 ID (40 random bits).
func RoomID() string { return roomEncoding.EncodeToString(random(5)) }

// Key returns 16 random bytes as unpadded base64url, used for host keys and viewer IDs.
func Key() string { return base64.RawURLEncoding.EncodeToString(random(16)) }

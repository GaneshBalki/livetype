// Package store saves rooms to Postgres so sessions survive a restart or
// redeploy. Each room is one row holding its gzipped state.
package store

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct{ db *pgxpool.Pool }

// Open connects and creates the table if needed.
func Open(ctx context.Context, url string) (*Store, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, errors.New("DATABASE_URL is not a valid Postgres URL") // the parse error can echo the password
	}
	// A remote database is only reached over TLS. pgx's default, sslmode=prefer,
	// would silently fall back to plain text, so drop those fallbacks.
	if h := cfg.ConnConfig.Host; h != "localhost" && h != "127.0.0.1" && !strings.HasPrefix(h, "/") {
		if cfg.ConnConfig.TLSConfig == nil {
			return nil, errors.New("DATABASE_URL turns off TLS (sslmode=disable); use sslmode=require")
		}
		tlsOnly := cfg.ConnConfig.Fallbacks[:0]
		for _, f := range cfg.ConnConfig.Fallbacks {
			if f.TLSConfig != nil {
				tlsOnly = append(tlsOnly, f)
			}
		}
		cfg.ConnConfig.Fallbacks = tlsOnly
	}
	db, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	_, err = db.Exec(ctx, `CREATE TABLE IF NOT EXISTS rooms (
		id      text PRIMARY KEY,
		data    bytea NOT NULL,
		created timestamptz NOT NULL,
		updated timestamptz NOT NULL
	)`)
	if err != nil {
		db.Close()
		return nil, err
	}
	if _, err = db.Exec(ctx, `ALTER TABLE rooms ADD COLUMN IF NOT EXISTS expires timestamptz`); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{db}, nil
}

func (s *Store) Close() { s.db.Close() }

func (s *Store) Save(ctx context.Context, id string, created, expires time.Time, data []byte) error {
	_, err := s.db.Exec(ctx, `INSERT INTO rooms (id, data, created, updated, expires) VALUES ($1, $2, $3, now(), $4)
		ON CONFLICT (id) DO UPDATE SET data = $2, updated = now(), expires = $4`, id, data, created, expires)
	return err
}

// Load returns the saved state, or nil when there is no such room.
func (s *Store) Load(ctx context.Context, id string) ([]byte, error) {
	var data []byte
	err := s.db.QueryRow(ctx, `SELECT data FROM rooms WHERE id = $1`, id).Scan(&data)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return data, err
}

func (s *Store) Delete(ctx context.Context, id string) error {
	_, err := s.db.Exec(ctx, `DELETE FROM rooms WHERE id = $1`, id)
	return err
}

// Prune deletes rooms past their expiry (rows saved before the expires column
// existed: created more than maxAge ago). Rooms that expire while
// loaded are deleted by the janitor; ones never reopened after a restart end here.
func (s *Store) Prune(ctx context.Context, maxAge time.Duration) error {
	_, err := s.db.Exec(ctx, `DELETE FROM rooms WHERE expires < now() OR (expires IS NULL AND created < $1)`, time.Now().Add(-maxAge))
	return err
}

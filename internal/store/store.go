// Package store saves rooms to Postgres so sessions survive a restart or
// redeploy. Each room is one row holding its gzipped state.
package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct{ db *pgxpool.Pool }

// Open connects and creates the table if needed.
func Open(ctx context.Context, url string) (*Store, error) {
	db, err := pgxpool.New(ctx, url)
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
	return &Store{db}, nil
}

func (s *Store) Close() { s.db.Close() }

func (s *Store) Save(ctx context.Context, id string, created time.Time, data []byte) error {
	_, err := s.db.Exec(ctx, `INSERT INTO rooms (id, data, created, updated) VALUES ($1, $2, $3, now())
		ON CONFLICT (id) DO UPDATE SET data = $2, updated = now()`, id, data, created)
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

// Prune deletes rooms created more than maxAge ago. Rooms that expire while
// loaded are deleted by the janitor; ones never reopened after a restart end here.
func (s *Store) Prune(ctx context.Context, maxAge time.Duration) error {
	_, err := s.db.Exec(ctx, `DELETE FROM rooms WHERE created < $1`, time.Now().Add(-maxAge))
	return err
}

package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"livetype/internal/room"
	"livetype/internal/ws"
	"livetype/web"
)

func main() {
	port := env("PORT", "8080")
	mgr := room.NewManager(room.Config{
		IdleTTL:     envDuration("ROOM_IDLE_TTL", 6*time.Hour),
		MaxAge:      envDuration("ROOM_MAX_AGE", 24*time.Hour),
		WriterGrace: envDuration("WRITER_GRACE", 10*time.Second),
	})
	wsh := &ws.Handler{Rooms: mgr}
	if o := os.Getenv("ALLOWED_ORIGIN"); o != "" {
		wsh.OriginPatterns = []string{o}
	}

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           securityHeaders(routes(mgr, wsh)),
		ReadHeaderTimeout: 10 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go mgr.RunJanitor(ctx, time.Minute)
	go func() {
		log.Printf("listening on :%s", port)
		if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}()

	<-ctx.Done()
	log.Print("shutting down")
	sctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(sctx); err != nil {
		log.Printf("http shutdown: %v", err)
	}
	mgr.CloseAll()
	done := make(chan struct{})
	go func() { wsh.Wait(); close(done) }()
	select {
	case <-done:
	case <-sctx.Done():
		log.Print("timed out waiting for websockets to close")
	}
}

func routes(mgr *room.Manager, wsh *ws.Handler) *http.ServeMux {
	mux := http.NewServeMux()
	static := http.FileServerFS(web.FS)
	mux.Handle("GET /css/", static)
	mux.Handle("GET /js/", static)
	mux.Handle("GET /img/", static)
	mux.HandleFunc("GET /{$}", page("index.html"))
	mux.HandleFunc("GET /h/{roomId}", page("host.html"))
	mux.HandleFunc("GET /v/{roomId}", page("view.html"))
	mux.Handle("GET /ws/{roomId}", wsh)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	mux.HandleFunc("POST /api/rooms", func(w http.ResponseWriter, _ *http.Request) {
		id, key, err := mgr.Create()
		if err != nil {
			http.Error(w, "Too many active sessions. Try again later.", http.StatusServiceUnavailable)
			return
		}
		log.Printf("room %s created", id)
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		json.NewEncoder(w).Encode(map[string]string{
			"roomId":    id,
			"hostKey":   key,
			"hostUrl":   "/h/" + id + "#k=" + key,
			"viewerUrl": "/v/" + id,
		})
	})
	return mux
}

// page serves the same HTML for every room; the page's JS reads the room ID
// from the path and finds out over the websocket whether the room exists.
func page(name string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		http.ServeFileFS(w, r, web.FS, name)
	}
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envDuration(key string, def time.Duration) time.Duration {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	d, err := time.ParseDuration(v)
	if err != nil || d <= 0 {
		log.Fatalf("%s: want a positive duration like 90s or 6h, got %q", key, v)
	}
	return d
}

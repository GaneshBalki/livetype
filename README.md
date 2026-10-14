# LiveType

A host types and anyone with the viewer link watches live. Viewers can ask for
write access, and the host approves, denies, or takes it back. There is one
writer at a time. State lives in memory, and the build is a single Go binary
with the web assets embedded.

## Run

```sh
go run ./cmd/server            # http://localhost:8080
```

Click **Start a session**. The page you land on is the private host link; share
the viewer link shown at the top.

With Docker:

```sh
docker build -t livetype .
docker run --rm -p 8080:8080 livetype
```

## Test

```sh
go vet ./...
go test -race ./...            # add -short to skip the 5 s hello-timeout test
```

## Configuration

| Variable         | Default | Meaning |
|------------------|---------|---------|
| `PORT`           | `8080`  | HTTP listen port. |
| `ALLOWED_ORIGIN` | unset   | Extra WebSocket origin to accept, as a host (`live.example.com`, `*.example.com`) or `scheme://host`. The page's own host is always accepted, so you only need this when a proxy rewrites the `Host` header. |
| `ROOM_IDLE_TTL`  | `6h`    | How long a room lives after its host disconnects. |
| `ROOM_MAX_AGE`   | `24h`   | Hard limit on a room's lifetime. |
| `WRITER_GRACE`   | `10s`   | How long a disconnected viewer keeps write access and its pending request, so a page refresh doesn't drop them. |

Durations use Go syntax (`90s`, `30m`, `6h`). An invalid value stops the server at startup.

## Deploy

**Run exactly one instance.** Rooms exist only in that process's memory, so a
second instance or a restart starts empty. Turn off autoscaling and
scale-to-zero.

The platform must support HTTPS and WebSockets. The page switches to `wss://`
by itself when it is served over HTTPS. The health check is `GET /healthz`.

The server pings each client every 25 s. Any proxy in front must allow the
WebSocket upgrade and have an idle timeout above that; 60 s or more is safe.

### Small VPS behind Caddy

```sh
docker run -d --restart unless-stopped -p 127.0.0.1:8080:8080 livetype
```

```caddy
live.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Caddy obtains the certificate, passes WebSocket upgrades through, and keeps the
`Host` header, so `ALLOWED_ORIGIN` is not needed.

### nginx

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 120s;
}
```

If you drop `proxy_set_header Host $host`, set `ALLOWED_ORIGIN` to the public
host. Otherwise browsers' WebSocket handshakes are refused with 403.

### Fly.io / Render

Deploy the Dockerfile as a web service on internal port 8080 with HTTPS
enforced. Pin it to one instance. On Fly, run `fly scale count 1` and set
`auto_stop_machines = "off"` in `fly.toml`. On Render, use one instance and no
autoscaling.

## Limits

These are fixed in `internal/limits`:

- text: 200 KB
- WebSocket message: 256 KB
- messages: 30 per second per connection, with a burst of 10
- viewers: 200 per room
- pending requests: 20 per room
- rooms: 1000 per server

Room creation (`POST /api/rooms`) has no per-IP limit. On a public deployment,
rate-limit that path at the proxy so one client can't use up the 1000 rooms.

Viewer identity is stored in `localStorage`, so tabs in the same browser count
as one viewer. To try a second viewer, use another browser or a private window.

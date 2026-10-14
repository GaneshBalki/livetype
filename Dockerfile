FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /livetype ./cmd/server

# Static binary with embedded web assets; no shell, runs as an unprivileged user.
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /livetype /livetype
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["/livetype"]

# LiveType

A real-time communication tool built around writing: you explain by typing,
your audience watches every keystroke, reacts and asks questions. It is not a
collaborative document editor.

A host types and anyone with the viewer link watches live. Viewers can ask for
write access, and the host approves, denies, or takes it back. There is one
writer at a time. State lives in memory, and the build is a single Go binary
with the web assets embedded.

## Features

- Audience interaction: emoji reactions, raise hand, and questions the host
  answers or dismisses. Kept separate from the document.
- Developer mode: switch the document to code (JavaScript, TypeScript, Python,
  Go, Rust, Java, C, C++, C#, SQL, Shell, JSON) for syntax colours, line
  numbers, auto-indent and a Copy code button.
- Sessions survive restarts and redeploys when a database is set (see below).
- Replay: watch how the text was typed, with a timeline and speed control.
- Live rich text: font, size, bold, italic, underline, strikethrough,
  sub/superscript, change case, font and highlight colors.
- Dark mode toggle that remembers your choice.
- Download the document as Word (.doc) or PDF.

See [CHANGELOG.md](CHANGELOG.md) for release notes.

## Run

```sh
go run ./cmd/server          # http://localhost:8080
go test ./...
```

Browser tests: see the header of `web/test/e2e.mjs`.

## Saving sessions (optional)

Without a database, sessions live in memory and are lost when the server
restarts or redeploys. Set `DATABASE_URL` to a Postgres connection string and
sessions are saved every 2 seconds and on shutdown, then restored when someone
reconnects. The table is created automatically.

What survives: the text, questions and answers, and the Replay recording. After
a restart the pen goes back to the host, and raised hands and pending write
requests are cleared. Host keys are stored only as a SHA-256 hash.

Free option: [Neon](https://neon.tech). Create a project, copy the connection
string, and add it in Render under the service's **Environment** settings as
`DATABASE_URL`.

To run the database test locally: `TEST_DATABASE_URL=postgres://... go test ./...`

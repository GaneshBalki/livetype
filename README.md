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

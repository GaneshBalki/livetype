# Changelog

All notable changes to LiveType are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [4.0.1] - 2026-11-26

### Added
- **Download code as a source file:** in code mode the Download menu offers
  the code as a file for its language, such as `devshire.py` or `devshire.go`.
- **Watching list** on the host page: everyone connected, by name, with ✋ for
  a raised hand and "Writing" for whoever holds the pen. Viewers who have not
  typed a name show as "Guest 1", "Guest 2" and so on.
- Viewers' names are remembered and shared as soon as they type one, in either
  the question or the write-request form.

### Changed
- Dropdowns (Text/language, font, size, case) have one consistent look. In
  Chromium-based browsers the open list is styled too.
- Host toolbar: Replay and Download are icon buttons at the right end of the
  toolbar, and stay usable while a viewer holds the pen.
- Viewer page: one name field at the top of the panel, used for questions,
  write requests and the host's watching list. Request to write sends at once
  (it asks for a name first if there is none). Only Ask is a filled button.
  Copy all, Replay and Download are icon buttons, like the host toolbar.
  A "Questions" heading shows where answers will appear.
- Share card: the link and its copy button are one box, and the private host link note moved
  into a small "i" button.
- Host and viewer pages no longer show the scrolling "What's new" ticker, so
  nothing moves on screen during a session.
- Empty panels (write requests, questions, watching) show one short line
  instead of a large dashed box.
- Questions: Dismiss is a small × next to Answer, on the same row.
- On phones the formatting toolbar is one row that scrolls sideways, with
  Bold, Italic and Underline first, instead of four wrapped rows.
- Text documents use a normal reading font (System UI) by default instead of
  monospace. Code mode stays monospace.
- On phones, notifications appear at the top so they don't cover the panel.

### Removed
- Change case (Aa) and Clear formatting, which did not work reliably.

### Fixed
- Highlight colour showed for viewers but not in the writer's own editor, and
  highlighted text was white on yellow in dark mode. It is now dark and readable.
- The highlight could not be removed. Clicking the highlight button on
  highlighted text now removes it; with only the cursor inside a highlight,
  it turns the highlight off for what you type next. Picking a colour from
  the palette always applies that colour.
- Download as PDF no longer switches the page to light mode when the theme
  follows the system, and the PDF no longer includes the watching list.
- Subscript and superscript buttons now look different (x₂ and x²).
- Replay with nothing recorded greys out all its controls and hides the
  "Host writing" label. The speed menu's "1×" is vertically centred.

### Security
- The watching list never contains viewer IDs, only names, which are cleaned
  like other names.

## [4.0.0] - 2026-11-26

### Changed
- **LiveType is now DevShire** (devshire.in). Existing session links keep working.
- New look: warm paper and ink colours with one orange accent, a serif
  headline and a new logo. Dark mode is black with green accents.
- New home page: one headline, one Start button, a live preview of a session,
  and three steps that explain how it works.
- Downloads are named `devshire.doc`.

### Fixed
- The home page no longer says sessions are kept in memory only (untrue since 3.1).

## [3.1.0] - 2026-11-26

### Added
- **Sessions survive restarts and redeploys.** With `DATABASE_URL` set to a
  Postgres database (for example Neon's free plan), each session is saved every
  2 seconds and when the server shuts down. After a restart, the host and viewer
  pages reconnect on their own and find their text, questions and answers, and
  Replay recording intact. A crash loses at most the last 2 seconds of typing.
- Without `DATABASE_URL`, nothing changes: sessions stay in memory only.

### Changed
- After a restart the pen returns to the host. Raised hands and pending write
  requests are cleared, and viewers rejoin with new IDs, so an unanswered
  question is still shown to the host but no longer to the viewer who asked it.
- Host keys are now kept only as a SHA-256 hash, in memory and in the database.
- Saved sessions are deleted when they expire (24 hours after creation, or 6
  hours after the host leaves).

### Notes
- New dependency: `github.com/jackc/pgx/v5` (Postgres driver).
- Saved data is gzipped JSON, at most about 1.2 MB per session before compression.

## [3.0.1] - 2026-11-26

### Fixed
- Viewer page: in code mode the blinking live cursor showed as a stray line
  below the code box. It is now hidden while the document is code.

## [3.0.0] - 2026-11-26

### Added
- **Developer mode:** the writer picks a language from the new "Text / language"
  menu at the start of the toolbar. The document then shows as code with syntax
  colours, line numbers and a Copy code button, for everyone watching and in Replay.
  Languages: JavaScript, TypeScript, Python, Go, Rust, Java, C, C++, C#, SQL,
  Shell, JSON and plain code.
- Code editing: Tab indents (Escape then Tab leaves the editor), Enter keeps the
  indent and adds one level after `{`, `[`, `(` or `:`.
- Switching back to Text keeps the text. Font and colour tools are hidden while
  the document is code, since code has no formatting.
- Downloads of a code document contain the plain code.

### Notes
- No server changes: a code document is stored as a single `<pre>` element.
  Highlighting is a small built-in tokenizer, not a full parser, so unusual
  syntax can be coloured wrong. Automatic code formatting is not included.

## [2.3.1] - 2026-11-26

### Fixed
- Formatting toolbar: the highlight and text colour pickers showed as loose
  colour boxes that looked like a bug. Each is now one button with a small ▾
  that opens the palette. The bar under the letter shows the current colour.

## [2.3.0] - 2026-11-26

### Added
- **Typing playback:** a Replay button on the host and viewer pages opens a
  player that shows how the text was written: play/pause, restart, speed
  (0.5×, 1×, 2×, 4×), a timeline to jump to any point, and who was writing at
  each moment. Pauses longer than 2 seconds are shortened.
- The server records changes at most once per second as small edits rather
  than full copies, up to 1 MB per session. Past that, the oldest part is merged
  into a starting snapshot, so long sessions keep their most recent part.

### Changed
- Viewer page: reactions, Raise hand, Request to write and questions moved into
  one panel on the right side of the document (below it on narrow screens).

### Notes
- Anyone with the viewer link can replay the session from its start, including
  edits made before they joined. Recordings live in memory and end with the session.

## [2.2.0] - 2026-11-26

### Added
- **Reactions:** viewers send one of six emoji, which float up on every screen.
  Limited to one reaction per 300 ms per connection.
- **Raise hand:** viewers raise or lower a hand. The host sees how many hands
  are up, gets a notification, and can lower them all.
- **Questions:** viewers ask questions (max 280 characters, 3 open per viewer,
  50 per session). The host sees them in the side panel, with a notification,
  and can answer or dismiss each one. A question is visible only to the host and
  the asker until it is answered, then to every viewer.

### Fixed
- Viewer page: Download as Word failed while the viewer held the pen.

### Security
- Reactions are limited to a fixed emoji set, so they cannot carry text.
- Questions and answers are cleaned of control characters on the server and
  shown as plain text, never HTML. Viewer IDs are never sent to other clients.

## [2.1.0] - 2026-11-26

### Added
- Scrolling "What's new" ticker in the header of the host and viewer pages,
  showing new features and tips. It pauses on hover, hides on small screens,
  and stops moving when the user prefers reduced motion.

### Changed
- Host page: removed the "Your document" header row, and moved the Download
  menu into the formatting toolbar (right end). Download stays available while
  a viewer holds the pen.
- More spacing between formatting toolbar buttons and groups.

## [2.0.0] - 2026-11-26

### Added
- **Rich text formatting toolbar** for whoever holds the pen (host or an approved viewer):
  font family, font size, grow/shrink, change case (Sentence case, lowercase,
  UPPERCASE, Capitalize Each Word, tOGGLE cASE), clear formatting, bold, italic,
  underline, strikethrough, subscript, superscript, highlight color and font color.
  Ctrl/Cmd+B, I and U work as shortcuts, and active styles are shown on the buttons.
- **Dark mode toggle** in the header of every page. It follows the system setting
  until the user picks, then remembers the choice across pages and visits.
- **Download** menu on the host and viewer pages:
  - **Word (.doc)** keeps the formatting.
  - **PDF** uses the browser's print dialog ("Save as PDF") and prints only the document.
- End-to-end browser test (`web/test/e2e.mjs`) and a sanitizer self-check page
  (`web/test/sanitize.html`).

### Changed
- **Breaking:** the shared document is now HTML instead of plain text. The editor is
  a rich-text area instead of a `<textarea>`. Clients from 1.x and 2.0 cannot share
  a session, so deploy server and clients together. Sessions are in memory, so no
  data migration is needed.
- Pasted content is inserted as plain text and takes the formatting at the cursor.
- Theme is controlled by a `data-theme` attribute (set by `js/theme.js`) instead
  of only the system color scheme.

### Security
- Every page rebuilds incoming document HTML from an allowlist (`js/sanitize.js`)
  before displaying it, because a viewer holding the pen can send arbitrary HTML.
  Only formatting tags and a small set of safe styles survive. Scripts, event
  handlers, links, images and `url()` values are removed.
- The Content-Security-Policy is unchanged and still blocks inline styles and scripts.

### Known limitations
- Download is `.doc` (HTML that Word opens), not `.docx`.
- Change case rewrites the selection as plain text, so mixed formatting inside it is lost.
- Formatting uses `document.execCommand`. It is deprecated but supported by all
  current browsers. Tested in Chromium. Firefox and Safari need a manual check.

## [1.0.0]

### Added
- Live typing session with a shareable viewer link, write requests, and host
  approve, deny and take-back controls. Single Go binary with embedded web assets.

[4.0.1]: https://github.com/GaneshBalki/livetype/compare/v4.0.0...v4.0.1
[4.0.0]: https://github.com/GaneshBalki/livetype/compare/v3.1.0...v4.0.0
[3.1.0]: https://github.com/GaneshBalki/livetype/compare/v3.0.1...v3.1.0
[3.0.1]: https://github.com/GaneshBalki/livetype/compare/v3.0.0...v3.0.1
[3.0.0]: https://github.com/GaneshBalki/livetype/compare/v2.3.1...v3.0.0
[2.3.1]: https://github.com/GaneshBalki/livetype/compare/v2.3.0...v2.3.1
[2.3.0]: https://github.com/GaneshBalki/livetype/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/GaneshBalki/livetype/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/GaneshBalki/livetype/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/GaneshBalki/livetype/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/GaneshBalki/livetype/releases/tag/v1.0.0

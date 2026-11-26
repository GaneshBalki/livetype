# Changelog

All notable changes to LiveType are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

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

[2.3.1]: https://github.com/GaneshBalki/livetype/compare/v2.3.0...v2.3.1
[2.3.0]: https://github.com/GaneshBalki/livetype/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/GaneshBalki/livetype/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/GaneshBalki/livetype/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/GaneshBalki/livetype/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/GaneshBalki/livetype/releases/tag/v1.0.0

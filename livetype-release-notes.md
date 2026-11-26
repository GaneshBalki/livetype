# GitHub release notes, one block per release
# For each one: Releases → Draft a new release → Tag (e.g. v3.1.0) on main → Title → paste the body.

---------------------------------------------------------------
TAG: v2.2.0    TITLE: v2.2.0 — Reactions, raised hands and questions
---------------------------------------------------------------
Viewers can now take part without interrupting the writer.

- **Reactions:** six emoji that float up on every screen.
- **Raise hand:** the host sees how many hands are up and can lower them all.
- **Questions:** viewers ask, the host answers or dismisses. A question stays private between the host and the asker until it is answered.

Fixed: Download as Word failed while a viewer held the pen.

Security: reactions are a fixed emoji set; questions are cleaned on the server and always shown as plain text.

---------------------------------------------------------------
TAG: v2.3.0    TITLE: v2.3.0 — Replay
---------------------------------------------------------------
- **Replay:** watch how the text was written, with play/pause, speed (0.5×–4×), a timeline and who was writing at each moment. Long pauses are shortened.
- Viewer page: reactions, hands and questions now sit in one side panel.

Note: anyone with the viewer link can replay the session from the start.

---------------------------------------------------------------
TAG: v2.3.1    TITLE: v2.3.1 — Cleaner colour buttons
---------------------------------------------------------------
Fixed: the highlight and text colour pickers looked like stray boxes. Each is now one button with a ▾ that opens the palette.

---------------------------------------------------------------
TAG: v3.0.0    TITLE: v3.0.0 — Developer mode
---------------------------------------------------------------
Pick a language in the toolbar and the document becomes code: syntax colours, line numbers and a Copy code button, for everyone watching and in Replay.

- 13 languages: JavaScript, TypeScript, Python, Go, Rust, Java, C, C++, C#, SQL, Shell, JSON, plain code.
- Tab indents, Enter keeps the indent. Esc then Tab leaves the editor.
- Switching back to Text keeps your text. Downloads contain the plain code.

---------------------------------------------------------------
TAG: v3.0.1    TITLE: v3.0.1 — Cursor fix in code mode
---------------------------------------------------------------
Fixed: viewers saw a stray blinking line under the code box. The live cursor is now hidden in code mode.

---------------------------------------------------------------
TAG: v3.1.0    TITLE: v3.1.0 — Sessions survive restarts
---------------------------------------------------------------
Sessions are now saved to a database every 2 seconds and on shutdown. After a restart or redeploy, everyone reconnects automatically and finds the text, questions, answers and Replay intact.

- Optional: set `DATABASE_URL` (Postgres, e.g. Neon free plan). Without it, sessions stay in memory as before.
- After a restart the pen returns to the host, and raised hands and write requests are cleared.
- Host keys are now stored only as a hash.
- Saved sessions are deleted when they expire.

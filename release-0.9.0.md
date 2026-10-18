# MD Reader 0.9.0

Home, the AI sidebar, reader controls and settings now share a ReUI-based design with light, sepia and dark themes. The home screen provides recent-document search; the AI composer groups attachments, thinking, search and send controls. Settings uses an accessible dialog with section navigation.

This release includes the existing commentary, image-chat and saved-layout implementation required by the current app, making those features part of the committed release. Home preserves the mounted reader, reading position and chat draft. Reader shortcuts are suppressed while home or a dialog is active. Existing subscription, model, session, export and memory settings remain connected to their existing services.

The UI uses free MIT ReUI Frame, Badge and AI composer example components with shadcn/Radix controls. The Pro AI Chat block is not included. License texts ship in the app.

## Validation

- Main and renderer TypeScript checks and production build.
- Electron smoke checks for design consistency, home/reader state, responsive layout, settings, image chat, streaming scroll, per-request controls, saved layout and commentary export/reopen.
- Packaged startup check exercises the actual application entrypoint, preload bridge, native commentary database, subscription choices and settings with an isolated profile.
- Tests use mocked or signed-out providers; they do not assert a new live AI or Hindsight response.

## Local distribution

- Output: `dist/release-0.9.0/`
- Installation target: `/Applications/MD Reader.app`; existing user data is preserved.
- Local distribution only; no Developer ID signing or notarization.

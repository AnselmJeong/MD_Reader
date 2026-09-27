# MD Reader 0.8.6

Remove text-to-speech throughout the app: selected-text and document playback controls, voice settings, playback state and highlighting, preload API and main-process IPC, Python sidecar, dependencies and bundled reference voices. Restrict packaging to the current main, preload and renderer output directories so stale TypeScript output cannot reintroduce retired code.

## Commit and artifact scope

The commit contains the TTS removal, its selection-menu regression check, documentation updates and the 0.8.6 version bump. Earlier uncommitted commentary, image-chat, layout and other changes remain outside this commit. The local installation and DMG are built from the full current working tree to preserve those existing features; they are not claimed to reproduce from this commit alone.

## Validation before commit

- Main and renderer TypeScript checks and production build passed in both the full working tree and an isolated snapshot of the staged index.
- The staged snapshot's Electron smoke passed: TTS API and controls are absent, while selection Copy, Ask AI, Highlight, document search and settings work. Clipboard writes are intercepted by the test.
- Earlier full-worktree packaged startup and archive inspection passed after TTS removal; release artifacts are revalidated separately after packaging.

## Local release output

- DMG: `dist/release-0.8.6/MD Reader-0.8.6-arm64.dmg`
- Installation target: `/Applications/MD Reader.app`
- Local ad-hoc signing only; no Developer ID signing or notarization.
- Installation preserves the existing user profile; it does not delete downloaded model caches.

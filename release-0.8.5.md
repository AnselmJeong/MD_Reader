# MD Reader 0.8.5 local release

## Change and commit scope

Add static QMD reading: YAML metadata and bibliography declarations, heading IDs and local section links, figures, pipe-table captions, fenced divs/callouts, relative images, and Quarto cross-references. Include the citation parser and hover support needed to keep bibliography citations distinct from Quarto references. Bump package and lockfile versions to 0.8.5.

The commit contains this feature and its dependencies. The local app/DMG was built from the full current worktree, preserving earlier uncommitted reader, commentary, image-chat, layout, and TinyFish changes already present before the QMD task. Those earlier changes remain outside this commit; this artifact is not claimed to reproduce from the feature commit alone.

## Verification

- Extracted the staged index into a separate directory. Both TypeScript checks, production build, 19 parser/citation/bibliography tests, and the QMD Electron smoke passed there.
- Both TypeScript checks and the production build passed for the full current worktree.
- Actual packaged entrypoint passed isolated-profile startup, renderer/preload IPC, native SQLite initialization, QMD metadata, image decoding, captions, local links, and source-preservation checks.
- Compared all 64 runtime output files against the packaged app.asar.
- DMG checksum verification passed. Mounted read-only; mounted app version and deep/strict signature passed. Mounted, staged, and installed app.asar hashes match.
- Installed `/Applications/MD Reader.app` reports 0.8.5 and passed the same packaged QMD/startup checks with an isolated profile.
- Launched normally with the existing user profile. Native UI inspection confirmed the renderer loaded from `/Applications/MD Reader.app/Contents/Resources/app.asar`, the QMD welcome text, recent files, and saved model.
- Existing broader commentary navigation/export tests were not rerun for this release; no claim is made that the prior full commentary smoke limitation is resolved.

## Artifacts and backup

- Installed app: `/Applications/MD Reader.app`
- DMG: `dist/release-0.8.5/MD Reader-0.8.5-arm64.dmg`
- DMG SHA-256: `46ff59813ea7b5ab68176f8b138010a74e108e2f572f1fec62f693f32f5f58de`
- app.asar SHA-256: `8e803bf626438411746f29659c8ac5c1102dc439db5e99451121551b19a928a8`
- Previous app and full user-profile clone: `/Users/anselm/Library/Application Support/MD Reader Backups/20260913-202140-before-0.8.5`
- Backup inventory and top-level JSON/SQLite/database contents verified before replacement. User data was not migrated or replaced.

Local ad-hoc signing only; no Developer ID signature, notarization, or publication.

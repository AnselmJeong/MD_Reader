# AI Sidebar request controls

- Make web research opt-in for each question, defaulting to Off even when TinyFish is configured. Keep the existing provider setting as a global availability switch.
- Add Thinking None / Low / Medium / High to the composer, defaulting to None. Capture both controls on send and reset them for the next question and on context/session changes. Quick actions use the same request options.
- Carry typed request options through the store, preload and main process. Send Ollama's `reasoning_effort` explicitly for sidebar answers and use None for search-query preparation. GPT-OSS requires at least Low; explain this exception in the composer.
- Preserve current image, search citation, streaming, settings and saved-session behavior. Do not modify unrelated work already in the working tree.
- Validate type checks, production build, and an isolated Electron smoke test covering default no-search behavior, opt-in search, thinking request payloads, reset behavior and rendering with mocked providers. Real provider response times are outside the mocked test.

## Validation

- Passed both TypeScript project checks and `npm run build`.
- Passed the Electron AI Sidebar smoke test: default Off/None despite search keywords and configured credentials; On/High search; next-question defaults; Low and Medium payloads; GPT-OSS None-to-Low mapping and visible notice; new-session reset; missing/disabled search configuration; existing key handling, snippet fallback, and KaTeX rendering.
- Passed all 12 focused prompt, web-research and TinyFish tests. Inspected the rendered composer screenshot.
- Provider calls were mocked; no live latency measurements were performed.

## Local installation (2026-09-16)

- Rebuilt the full current worktree and packaged arm64 MD Reader 0.8.5 at `dist/ai-sidebar-controls-20260916/mac-arm64/MD Reader.app`.
- Compared all 64 runtime files with the packaged archive. Ad-hoc deep/strict signature verification passed; no Developer ID signing or notarization.
- Packaged startup test passed for both the build artifact and `/Applications/MD Reader.app`, including Search Off, Thinking None, all four thinking choices, preload IPC, and native SQLite initialization in an isolated profile.
- Replaced `/Applications/MD Reader.app` and launched normally. Native UI inspection verified the installed app.asar renderer, saved model, recent files, Search Off and Thinking None.
- Existing app and full user profile backed up to `/Users/anselm/Library/Application Support/MD Reader Backups/20260916-121329-before-ai-sidebar-controls`; app archive and 18 top-level profile files matched their backups. Original installed bundle also retained there as `original-installed.app`.
- Installed app.asar SHA-256: `9862f493fec87e007af8b8040f2710f58ebe76c1bdcf7caf4fefaf0525064cc2`.

## Commit scope and independent validation

- Commit the per-question controls together with the TinyFish provider/settings/search dependencies that were already used by the local implementation. Preserve unrelated EPUB, commentary, image attachment, layout, and packaging work outside the commit.
- The installed app above was built from the full local worktree, including that pre-existing work; it is not claimed to reproduce from this scoped commit alone.
- Validated the exact selected source tree separately: both TypeScript checks, production build, 12 prompt/search tests, and `tests/ai-sidebar-controls.smoke.ts` passed. The smoke test covers the full request path, all thinking levels, opt-in search, default resets, missing search credentials and the GPT-OSS exception with mocked providers.

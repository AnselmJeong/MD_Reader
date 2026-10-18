# ReUI workspace redesign

Implemented 2026-10-18. Home, reader chrome, AI sidebar and settings share warm paper/olive tokens, including light, sepia and dark themes.

## Source components

Components were installed from the official registry using the shadcn CLI, style `radix-nova`:

- ReUI `@reui/frame` and `@reui/badge`: `src/renderer/src/components/reui/`.
- ReUI `@reui/c-input-group-18`: the free AI chat composer example. Original downloaded reference: `reui-input-group-18.reference.tsx`. Its InputGroup / textarea / bottom toolbar composition is adapted in `ChatPanel/ChatInput.tsx` and wired to existing document context, paste/drop attachments, thinking, search, send and stop handlers.
- shadcn/Radix Button, InputGroup, Empty, Dialog, Field, Input, Textarea, ToggleGroup, Alert and registry dependencies: `src/renderer/src/components/ui/`.
- Registry: https://reui.io/r/{style}/{name}.json
- Documentation: https://reui.io/docs/registry
- Design reference: https://reui.io/blocks/ai-agents/ai-chat

The Pro AI Chat block was not copied or installed. The implementation uses the free MIT components and example. No microphone, context quota or tool-count feature is implied by the UI. MIT license texts are in `licenses/`.

Local changes to registry sources: application import aliases, Radix data-state selectors for active/open/orientation. Theme tokens bridge the existing document palette. Tailwind 4 is required by current registry source, with the existing Tailwind config retained for reader/chat utilities. KaTeX CSS is imported from the renderer entry so Vite emits the font files correctly.

## Behavior preserved and checked

- Existing GPT/Claude subscription providers, model selection, sessions and export remain connected to the same stores and IPC.
- File dialog/drop, Markdown/Quarto/EPUB rendering, reader toolbar, TOC, focus, annotations and saved layout retain their existing handlers.
- Home and modal dialogs block reader keyboard shortcuts. Home keeps the mounted reader at its original dimensions while hidden and inert. Opening a recent file already in a tab selects it without replacing its in-memory contents. Recently opened documents refresh the home list.
- Search/thinking defaults and per-request reset, streaming scroll, image paste/preview, unsupported model guard, session image persistence/export are covered by existing smoke tests adapted to accessible selectors.
- Settings retains all subscription, TinyFish and Hindsight controls, adds shared sections and an accessible Radix dialog. Font/theme preferences still persist through the existing settings store.

## Validation

`npm run build`, `npx tsc --noEmit -p tsconfig.web.json`, `git diff --check`.

Electron integration tests (bundle each using esbuild with `--bundle --platform=node --packages=external`):

- `tests/ai-sidebar.smoke.ts`: mocked providers, search/thinking routing and resets, settings key handling and KaTeX.
- `tests/chat-scroll.smoke.ts`: deferred rendering, follow-latest, user scroll, resize, no outer-page movement.
- `tests/chat-images.smoke.ts`: clipboard, zoom, capability warning, draft retention, image request/history, database persistence and export.
- `tests/commentary.smoke.ts`: placement, edit/reply/delete/restore, table/image/math, export/reopen, original bytes unchanged. The first concurrent run timed out at the final cross-chapter navigation; a subsequent standalone full run passed.
- `tests/reader-layout.smoke.ts` write/read: real main entrypoint; window/pane/TOC/focus/EPUB settings restored in a new process.
- `tests/design-system.smoke.ts`: recent search/empty result, home/reader scroll and draft preservation, same-document reopen, theme persistence, settings reachability, focus return, 900–1440px layouts.

These tests do not claim a new live GPT, Claude, TinyFish or Hindsight service verification.

## Runnable preview

Packaged with `npx electron-builder --mac --dir --config.directories.output=dist/reui-preview`. Output: `dist/reui-preview/mac-arm64/MD Reader.app`. The installed `/Applications/MD Reader.app` is not replaced. `tests/packaged-startup.smoke.mjs` passed against this bundle (renderer, preload, native commentary database, subscription choices and settings). Third-party MIT license texts are included in the packaged app.

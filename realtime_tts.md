# Realtime TTS Plan

## Goal

Add local real-time text-to-speech to MD Reader using RealtimeTTS with NeuTTSEngine and the `neuphonic/neutts-air` model.

Primary user flows:

1. Click a headphone icon in the titlebar to read the currently open markdown file.
2. Select text in the rendered document, then click a headphone icon in the selection toolbar to read only that selected text.
3. During full-document reading, show playback controls for play/pause, stop, and jump to beginning.
4. When feasible, highlight the currently spoken text and keep it centered in the reader with automatic scrolling.

## Current App Shape

- App stack: Electron 34, electron-vite, React 19, Zustand.
- Main process IPC lives in `src/main/ipc-handlers.ts`.
- Preload API lives in `src/preload/index.ts` and `src/renderer/src/global.d.ts`.
- Titlebar controls live in `src/renderer/src/components/Toolbar.tsx`.
- Selection popup lives in `src/renderer/src/components/DocumentReader/TextSelectionMenu.tsx`.
- Document rendering and scroll ownership live in `src/renderer/src/components/DocumentReader/DocumentReader.tsx`.
- Markdown HTML is rendered via `src/renderer/src/components/DocumentReader/MarkdownRenderer.tsx`.
- Search already has DOM-marking and scroll patterns in `useDocumentSearch` and `utils/searchDom.ts`; the TTS highlight should reuse the same style of DOM-local marking instead of rewriting markdown content.

## Key Technical Decision

Use a Python sidecar process for TTS instead of trying to run NeuTTS in Electron/Node.

Rationale:

- RealtimeTTS and NeuTTS are Python libraries with native dependencies.
- NeuTTS-Air download and model initialization are heavyweight and should not block the renderer.
- Keeping the engine in a long-lived sidecar lets Electron issue simple IPC commands while Python owns audio playback and model lifecycle.
- The sidecar can stream structured JSON events back to Electron for UI state and highlighting.

## RealtimeTTS / NeuTTS Facts To Use

From the `realtimetts-neutts` skill and Context7 docs:

- Use `TextToAudioStream` plus `NeuTTSEngine`.
- Default model should be:
  - `model="neutts-air"`
  - `backbone_repo="neuphonic/neutts-air"`
  - `codec_repo="neuphonic/neucodec"`
  - `device="cpu"` on Apple Silicon unless testing proves otherwise.
- `TextToAudioStream` supports `play_async()`, `pause()`, `resume()`, `stop()`, and `is_playing()`.
- Useful callbacks include `on_text_stream_start`, `on_text_stream_stop`, `on_audio_stream_start`, `on_audio_stream_stop`, `on_character`, and `on_sentence_synthesized`.
- First run downloads the backbone and codec from Hugging Face. This must be surfaced in the UI as a setup/loading state.
- `voices_dir` should contain paired `{voice}.wav` and `{voice}.txt` files. If no voice is configured, the implementation needs a clear setup error rather than silent failure.

## Proposed Architecture

### 1. Python Runtime Layout

Add:

- `tts/reader_tts_server.py`
- `tts/requirements.txt`
- `tts/voices/.gitkeep`
- optional `tts/README.md` if install instructions need more detail after implementation.

The sidecar process should:

- Start once per app session on first TTS request.
- Lazily initialize `NeuTTSEngine` so the app can open quickly.
- Accept newline-delimited JSON commands on stdin.
- Emit newline-delimited JSON events on stdout.
- Emit diagnostics on stderr, forwarded to the renderer as TTS errors.

Initial command protocol:

```json
{ "type": "speak", "mode": "document", "utterances": [{ "id": "u1", "text": "..." }] }
{ "type": "speak", "mode": "selection", "utterances": [{ "id": "s1", "text": "..." }] }
{ "type": "pause" }
{ "type": "resume" }
{ "type": "stop" }
{ "type": "restart" }
{ "type": "status" }
{ "type": "shutdown" }
```

Initial event protocol:

```json
{ "type": "status", "state": "initializing" }
{ "type": "status", "state": "downloading-model" }
{ "type": "status", "state": "playing", "mode": "document" }
{ "type": "utterance-start", "id": "u1", "index": 0, "text": "..." }
{ "type": "utterance-end", "id": "u1", "index": 0 }
{ "type": "status", "state": "paused" }
{ "type": "status", "state": "stopped" }
{ "type": "status", "state": "ended" }
{ "type": "error", "message": "..." }
```

### 2. Text Segmentation

For full-document reading:

- Convert markdown to readable plain text before sending it to TTS.
- Strip YAML frontmatter, code fences, inline code noise where possible, markdown links/images syntax, HTML tags, table formatting, and citation markup.
- Segment into stable utterances, preferably paragraphs split into sentence-sized chunks.
- Assign stable IDs: `tts-0`, `tts-1`, etc.
- Keep a mapping from utterance ID to text for renderer-side highlighting.

For selected text:

- Use the selected text directly.
- Trim whitespace and cap obviously accidental huge selections only if needed.
- Selection reading should not create persistent document highlight state.

Implementation location:

- Shared renderer utility: `src/renderer/src/components/DocumentReader/utils/ttsText.ts`
- If main process also needs text cleanup later, move pure functions to `src/shared/`.

### 3. Electron Main Process

Add `src/main/tts-service.ts`:

- Manage the child process with `child_process.spawn`.
- Resolve Python executable:
  - prefer `MD_READER_TTS_PYTHON` env var,
  - then `tts/.venv/bin/python`,
  - then `python3`.
- Validate dependencies with a lightweight `--check` or `status` path.
- Restart sidecar if it exits unexpectedly.
- Keep one active playback session at a time.
- Forward sidecar events to the requesting `BrowserWindow`.
- Stop playback on app quit and sidecar shutdown.

Add IPC in `src/main/ipc-handlers.ts`:

- `tts:speak`
- `tts:pause`
- `tts:resume`
- `tts:stop`
- `tts:restart`
- `tts:status`

Add renderer event channels:

- `tts:status`
- `tts:utterance-start`
- `tts:utterance-end`
- `tts:error`

Security note:

- Do not expose arbitrary process spawning to the renderer.
- Renderer sends only text payloads and playback commands.
- Main process owns all executable paths and environment handling.

### 4. Preload API

Extend `ElectronAPI` in `src/preload/index.ts`:

```ts
tts: {
  speak: (params: TtsSpeakParams) => Promise<{ success: boolean; error?: string }>
  pause: () => Promise<{ success: boolean; error?: string }>
  resume: () => Promise<{ success: boolean; error?: string }>
  stop: () => Promise<{ success: boolean; error?: string }>
  restart: () => Promise<{ success: boolean; error?: string }>
  status: () => Promise<TtsStatus>
  onStatus: (callback: (status: TtsStatus) => void) => () => void
  onUtteranceStart: (callback: (event: TtsUtteranceEvent) => void) => () => void
  onUtteranceEnd: (callback: (event: TtsUtteranceEvent) => void) => () => void
  onError: (callback: (message: string) => void) => () => void
}
```

Mirror types in `src/renderer/src/global.d.ts`.

### 5. Renderer State

Add `src/renderer/src/store/useTtsStore.ts`.

State:

- `mode`: `document | selection | null`
- `state`: `idle | initializing | downloading-model | playing | paused | stopped | ended | error`
- `activeUtteranceId`
- `activeUtteranceIndex`
- `utterances`
- `error`
- `hasDocumentSession`

Actions:

- `speakDocument(content)`
- `speakSelection(text)`
- `pause()`
- `resume()`
- `stop()`
- `restart()`
- event reducers for sidecar events.

Full-document behavior:

- If idle/stopped/ended: build utterances from current document and call `tts:speak`.
- If playing: headphone button can act as pause, but explicit playback controls should still be visible.
- If paused: headphone button can resume.

Selection behavior:

- Clicking selection headphone starts selection-only playback immediately.
- It should stop any active document playback first, or replace it through `tts:speak` with `mode="selection"`.
- It should close the selection toolbar after command dispatch.

### 6. Titlebar UI

Update `src/renderer/src/components/Toolbar.tsx`:

- Add a headphone icon button near the reading/navigation controls.
- Disable it when no document is open.
- Use an inline SVG or add an icon package only if the project already adopts one. The current toolbar uses inline SVG, so match that style for now.
- Tooltip states:
  - idle: `Read document`
  - initializing/downloading: `Preparing TTS`
  - playing: `Pause reading`
  - paused: `Resume reading`

Add compact playback controls shown only when a document TTS session exists:

- play/resume
- pause
- stop
- to beginning

Keep controls in the titlebar because the user explicitly asked there, and because it avoids covering document text.

### 7. Selection Toolbar UI

Update `src/renderer/src/components/DocumentReader/TextSelectionMenu.tsx`:

- Add a headphone icon button.
- It should read only `selectedText`.
- Close the menu and clear native selection after dispatch, matching existing actions.
- If TTS is initializing or already playing, selection playback should replace the active session with clear UI feedback.

### 8. Current Text Highlight And Scroll

Preferred first implementation:

- Use utterance-level highlighting, not word-level highlighting.
- On `utterance-start`, locate the utterance text in the rendered `.document-body`.
- Wrap or mark the matching text range with a temporary `mark.md-tts-current`.
- Remove previous TTS marks before applying the next one.
- Scroll the mark into the center of the document scroll container.

Why utterance-level first:

- RealtimeTTS exposes sentence/chunk callbacks more reliably than exact word timings.
- Word-level synchronization would require audio alignment or lower-level callbacks that are likely brittle.
- Sentence/paragraph highlighting is enough to orient the reader and can be improved later.

Implementation candidates:

- Add `src/renderer/src/components/DocumentReader/utils/ttsDom.ts`.
- Reuse the search utilities' approach for DOM text traversal and scroll math.
- Add CSS in `src/renderer/src/styles/markdown.css`:

```css
.document-body mark.md-tts-current {
  background: color-mix(in srgb, var(--color-accent) 28%, transparent);
  outline: 1px solid color-mix(in srgb, var(--color-accent) 55%, transparent);
  border-radius: 3px;
}
```

Fallback:

- If exact rendered text matching fails, show active utterance text in a small titlebar/statusbar reading indicator instead of silently doing nothing.

### 9. Installation And Setup UX

Add setup docs and detection:

- `brew install espeak-ng portaudio ffmpeg`
- `python3 -m venv tts/.venv`
- `tts/.venv/bin/pip install -U "realtimetts[all]"`
- `tts/.venv/bin/pip install neutts`

Model:

- Default to `neuphonic/neutts-air`.
- First run downloads model and codec from Hugging Face.
- Cache is managed by Hugging Face/NeuTTS, not the app.

Voice:

- Add a visible requirement for `tts/voices/{name}.wav` and `tts/voices/{name}.txt`.
- The transcript must exactly match the voice sample.
- Use a setting later for voice selection; first implementation can use `default_voice` from config/env.

Potential setup check:

- `tts/reader_tts_server.py --check` reports:
  - Python version,
  - import availability for `RealtimeTTS` and `neutts`,
  - espeak-ng/phonemizer readiness if detectable,
  - available voices.

### 10. Error Handling

Renderer should show human-readable errors for:

- Python executable not found.
- Missing `RealtimeTTS` or `neutts`.
- Missing `espeak-ng` or PortAudio.
- No valid voice pair in `tts/voices`.
- Model download/auth/network failure.
- Audio device failure.
- Sidecar crash.

Do not bury these only in DevTools. Use the existing UI style, likely a compact titlebar/statusbar error surface or a dismissible reader overlay.

### 11. QA Plan

Manual validation:

1. Start the app with `npm run dev`.
2. Open a sample markdown file.
3. Click titlebar headphone and confirm TTS starts.
4. Confirm play/pause/resume/stop/restart behavior.
5. Confirm active utterance highlight appears and scrolls into view.
6. Select text and click selection headphone.
7. Confirm selection playback replaces or stops document playback predictably.
8. Confirm no TTS button is enabled when no document is open.
9. Kill the sidecar process and confirm the app reports a recoverable error.

Code validation:

- `npm run build`
- TypeScript compile through the build.
- Run `tts/reader_tts_server.py --check`.
- Run a short smoke synthesis with muted/file output if live audio is not available in CI-like environments.

### 12. Implementation Order

1. Add Python sidecar skeleton, requirements, and `--check`.
2. Add main-process `tts-service.ts` and IPC channels.
3. Extend preload/global types.
4. Add renderer TTS store and event subscriptions.
5. Add titlebar headphone and playback controls.
6. Add selection toolbar headphone action.
7. Add markdown-to-utterance segmentation.
8. Add utterance highlight and scroll.
9. Add setup/error UI.
10. Run build and manual smoke test.

## Open Risks

- NeuTTS-Air is English-focused. Korean markdown may synthesize poorly or fail depending on model/tokenization behavior.
- First-run model download can be slow and large; the UI must make this explicit.
- Exact text highlighting can fail after markdown rendering transforms text, citations, math, or tables. Start with best-effort utterance matching and add fallback UI.
- Packaging a Python virtualenv inside Electron distribution is a separate task. Initial implementation should target local developer use with `tts/.venv`.
- Voice setup is required for good NeuTTS output; without a valid reference WAV/transcript pair, playback should fail clearly.

## Product Notes

- Keep TTS controls compact and close to reading controls.
- Avoid modal setup flows during reading; surface missing dependency errors with actionable commands.
- Selection playback should feel immediate and disposable.
- Full-document playback should feel like a reading mode, with persistent controls and visible progress.

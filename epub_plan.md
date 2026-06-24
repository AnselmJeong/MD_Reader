# EPUB Support Implementation Plan

## Goal

Add EPUB reading support while preserving the current MD_Reader experience:

- Multiple open tabs
- Existing toolbar and popup selection menu
- Table of contents sidebar
- Resizable AI chat sidebar
- Search, TTS, theme/font controls where technically appropriate
- Existing Markdown behavior without regression

The safest direction is not to convert EPUB into Markdown and feed it through the existing Markdown renderer. EPUB should be introduced as a second document type that shares the current reader shell but uses an EPUB-specific rendering adapter.

## Current Architecture Facts

- File opening currently accepts only `.md`, `.markdown`, and `.txt` in `src/main/ipc-handlers.ts`.
- `useDocumentStore` currently stores each tab as a Markdown-like text document with `content: string`.
- `DocumentReader` assumes one Markdown string and renders it through `MarkdownRenderer`.
- `TableOfContents` extracts headings from Markdown text.
- Search, text selection menu, link tooltip, TTS marking, and highlighting are DOM-based and currently operate on rendered Markdown DOM.
- The right AI sidebar is layout-level UI and can remain in place if the active document still exposes document text or selected text.

## Recommended Library

Use `epub.js` for EPUB rendering.

Relevant capabilities:

- Load EPUB from URL or binary data.
- Render into a DOM container with scrolling or paginated flows.
- Access EPUB navigation/TOC via `book.loaded.navigation`.
- Navigate with `rendition.display(hrefOrCfi)`, `rendition.next()`, and `rendition.prev()`.
- Listen to location changes with `rendition.on("relocated")`.
- Listen to text selection with `rendition.on("selected")`.
- Apply highlights with `rendition.annotations.highlight(cfiRange, ...)`.

## Phase 1: Immediate MVP

This is the first implementation target. It should make EPUB files usable without trying to solve every advanced ebook-reader feature.

### 1. Add Document Type Support

Change the document model from a Markdown-only tab to a typed tab.

Proposed shape:

```ts
type DocumentKind = 'markdown' | 'epub'

interface BaseDocumentTab {
  id: string
  filePath: string
  fileName: string
  kind: DocumentKind
  wordCount: number
  readingTime: number
  isDirty: boolean
}

interface MarkdownDocumentTab extends BaseDocumentTab {
  kind: 'markdown'
  content: string
  bibContent: string | null
}

interface EpubDocumentTab extends BaseDocumentTab {
  kind: 'epub'
  content: string
  epubDataUrl: string
  plainText: string
  currentLocation?: string
}
```

Notes:

- Keep `content` as a compatibility field for AI/TTS/status surfaces, but for EPUB it should be extracted plain text, not rendered HTML.
- Use `plainText` for document-level AI context and basic word count.
- Preserve `id = filePath` so existing tab behavior remains stable.

### 2. Extend File Open and Drag-Drop

Update file support in main/preload/renderer:

- Open dialog filters should include `.epub`.
- Drag-drop should accept `.epub`.
- Recent files should include EPUB files.
- Main process should detect extension and return a typed result.

For Markdown:

- Keep the existing `readFileWithBib()` path.

For EPUB:

- Read the file as binary.
- Return a base64 data URL or ArrayBuffer-safe payload to the renderer.
- Do not try to read sibling `.bib` files for EPUB in the MVP.

### 3. Split Reader Rendering by Type

Keep `DocumentReader` as the shared reader shell and branch internally:

- `MarkdownDocumentView`
  - Owns current `MarkdownRenderer`, `MetadataCard`, Markdown TOC, Markdown search, Markdown highlight behavior.
- `EpubDocumentView`
  - Owns `epub.js` book/rendition lifecycle.
  - Renders into a dedicated viewer container.
  - Emits title, TOC, progress, current location, selected text.

This keeps the existing toolbar, tabs, status bar, and chat sidebar intact.

### 4. EPUB Rendering MVP

Implement `EpubDocumentView` with:

- `ePub(epubDataUrl)` or equivalent binary load.
- `book.renderTo(viewerRef.current, { width: '100%', height: '100%', flow: 'scrolled-doc' })`.
- `rendition.display(currentLocation || undefined)`.
- Cleanup on unmount with `book.destroy()`.
- Theme/font settings mapped into `rendition.themes.default()`.

Use scrolled document flow first. It is closer to the current Markdown reading model and preserves vertical scroll-oriented UI expectations.

### 5. EPUB TOC Sidebar

Add a typed TOC path:

- Markdown TOC continues to use `extractMarkdownHeadings()`.
- EPUB TOC uses `book.loaded.navigation`.
- Existing `showToC` UI state stays unchanged.
- Clicking an EPUB TOC item calls `rendition.display(item.href)`.

This preserves the sidebar behavior while changing only the source of TOC data.

### 6. EPUB Selection Popup Menu

Reuse the current `TextSelectionMenu` UI, but change the data source.

Markdown:

- Continue using the existing DOM selection hook.

EPUB:

- Listen to `rendition.on("selected", async (cfiRange, contents) => ...)`.
- Resolve selected text using `book.getRange(cfiRange)` or `contents.window.getSelection().toString()`.
- Compute the popup position from the selection range rect inside the EPUB iframe, adjusted into the parent window coordinate space.
- Use the same menu actions:
  - Ask AI
  - Summarize
  - Copy
  - Read selected text
  - Highlight

For the MVP, EPUB highlight can be visual-only during the session.

### 7. AI Sidebar Compatibility

Make `useDocumentStore().content` or a new `activeDocumentText` selector return usable plain text for both Markdown and EPUB.

MVP behavior:

- Selected EPUB passage can be sent to AI.
- Full-document context can use extracted plain text.
- If full EPUB extraction is slow or incomplete, use current chapter text first and mark full-book extraction as Phase 2.

### 8. EPUB Status and Progress

Status bar should remain unchanged visually, but data should adapt:

- Show EPUB file name.
- Show estimated words and reading time from extracted text.
- Show location/progress when available from `rendition.on("relocated")`.
- Do not show `Modified` for EPUB unless annotation persistence is added later.

## Phase 1 Validation

Run these checks before considering MVP complete:

- `npm run build`
- Open existing Markdown sample and verify:
  - Rendering
  - TOC click navigation
  - Search
  - Selection menu
  - Ask AI sidebar
  - TTS button
  - Multiple tabs
- Open an EPUB and verify:
  - File dialog accepts `.epub`
  - Drag-drop accepts `.epub`
  - EPUB opens in a tab
  - Markdown and EPUB tabs can coexist
  - TOC opens and navigates
  - Selection popup appears
  - Selected EPUB text can be copied and sent to AI
  - Right AI sidebar remains resizable and usable
  - Theme/font changes affect EPUB reading

## Phase 2: Near-Term Follow-Up

These features are valuable but should not block the first usable EPUB reader.

### 1. Full-Book Text Extraction Cache

Build a plain-text index from EPUB spine sections.

Uses:

- More useful AI full-document context
- Full-book search
- Better word count and reading time
- Full-document TTS

Implementation notes:

- Extract text section by section.
- Cache by file path plus file mtime/size.
- Keep extraction async and show status if it takes noticeable time.

### 2. Full-Book Search

Current Markdown search marks matches directly in the rendered DOM. EPUB full-book search should be separate.

Proposed behavior:

- Search current rendered section immediately.
- In parallel, search extracted full-book text.
- Results should list chapter/section labels.
- Selecting a result navigates to its EPUB CFI or nearest section href.

### 3. Persistent EPUB Reading Location

Store per-file EPUB position:

- Current CFI/location
- Last opened chapter
- Scroll/progress value

Persist this in app storage keyed by normalized file path.

### 4. Persistent Highlights and Notes

Do not modify the EPUB file directly.

Store annotations externally:

- file path
- file identity hash or mtime/size
- CFI range
- selected text snapshot
- note text
- created/updated timestamps

On reopen:

- Load annotations for the EPUB.
- Reapply with `rendition.annotations.highlight()`.

### 5. EPUB TTS

Add EPUB-aware TTS modes:

- Read selected text
- Read current chapter
- Read from current location
- Optional full-book queue

Avoid sending the whole book at once. Build utterances by section and chunk them like the existing Markdown TTS path.

### 6. EPUB Link Handling and Footnotes

Handle links inside EPUB content:

- Internal links should navigate inside the book.
- External `http/https` links should use `window.api.shell.openExternal`.
- Footnote/backlink behavior should be tested with real academic EPUBs.

### 7. Better EPUB Metadata

Display EPUB-specific metadata:

- Title
- Author
- Publisher
- Language
- Publication date
- Cover image if available

This should replace or complement `MetadataCard` for EPUB.

## Phase 3: Reader Quality Improvements

These are product polish items after the EPUB path is stable.

### 1. Reading Mode Options

Offer EPUB layout choices:

- Scrolled document
- Paginated single page
- Paginated spread when window is wide enough

Keep scrolled mode as default because it matches the current Markdown reader.

### 2. Per-Book Typography Settings

Allow EPUB-specific overrides:

- Font family
- Font size
- Line height
- Content width
- Paragraph spacing

Default to global reader settings.

### 3. Annotation Manager

Add a small sidebar or panel for:

- Highlights
- Notes
- Jump to highlight
- Delete highlight
- Export annotations

### 4. Export EPUB Notes

Support Markdown export:

- Book metadata
- Highlighted quote
- Note
- Chapter
- CFI/location

This fits the academic-reader use case better than modifying EPUB files.

## Risks and Design Constraints

### EPUB Iframe Boundary

`epub.js` renders book content inside managed document contexts. Existing DOM selection/search/highlight utilities will not automatically work across that boundary.

Mitigation:

- Keep current Markdown utilities unchanged.
- Build EPUB-specific adapters that expose the same high-level actions.

### Security

EPUB content is HTML packaged in a zip file. Treat it as untrusted content.

Mitigation:

- Do not execute EPUB scripts.
- Keep external link opening constrained to `http://` and `https://`.
- Avoid injecting app-level privileged APIs into EPUB content.

### Save Semantics

Markdown documents are editable through highlight syntax insertion. EPUB files should not be edited directly.

Mitigation:

- Disable normal Save for EPUB in the MVP.
- Persist EPUB annotations separately in a later phase.

### AI Context Size

Full EPUB text can be too large for a single AI request.

Mitigation:

- MVP: selected passage and current chapter first.
- Phase 2: section-aware extraction and context selection.

## Proposed Implementation Order

1. Install `epub.js`.
2. Add typed file result and document tab model.
3. Add `.epub` open-dialog and drag-drop support.
4. Split Markdown view out of `DocumentReader`.
5. Add `EpubDocumentView` with basic render and cleanup.
6. Add EPUB TOC data and navigation.
7. Wire EPUB selected text into existing popup menu.
8. Make AI sidebar consume typed active document text.
9. Add basic EPUB progress/status.
10. Validate Markdown regressions and EPUB MVP behavior.

## Definition of Done for First EPUB Release

- Markdown behavior remains unchanged.
- EPUB file opens from dialog, recent list, and drag-drop.
- Markdown and EPUB can be open in separate tabs at the same time.
- EPUB reader preserves the current app chrome: toolbar, tabs, TOC sidebar, AI sidebar, status bar.
- EPUB TOC navigates to chapters.
- EPUB text selection opens the existing popup menu.
- Selected EPUB text can be copied, read aloud, and sent to AI.
- Build passes.

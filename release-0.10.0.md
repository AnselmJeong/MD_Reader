# MD Reader 0.10.0

Adds a proactive reading coach for EPUB books.

Before reading, an optional intake asks for purpose, familiarity, how proactive the coach should be and any free request; it can be changed later from the "코치" button. For each chapter the coach prepares a deck in the background (cached, queued, daily-limited) and marks terms with dotted underlines. Hovering a mark opens a card with four actions; accept, known and not-interested choices refine later selections. Cards can show a Wikipedia picture and be inserted into the EPUB as commentary, one at a time or all cards of a chapter at once. The coach tab in the chat panel shows the briefing, section summaries and chapter recap.

Memory and connections: terms are tracked across books, earlier questions and commentary mentioning a card's term are shown, a coach profile summary is written to USER.md and Hindsight and included in chat memory, per-chapter connector items come from Hindsight recall, and chapter self-check questions return on an expanding review schedule.

## Validation

- `tests/coach.test.mjs` (10 tests) and TypeScript checks for main and renderer.
- Production build and packaged app.
- No live AI, TinyFish or Hindsight responses were exercised.

## Local distribution

- Output: `dist/`
- Installation target: `/Volumes/Aquatope/Applications/MD Reader.app`; existing user data is preserved.
- Local distribution only; no Developer ID signing or notarization.

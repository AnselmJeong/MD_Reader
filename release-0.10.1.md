# MD Reader 0.10.1

Reading coach refinements.

- Card glosses explain a term from general knowledge (definition, field background, wider significance) and relate it to the book in one short clause. Cached decks regenerate because the prompt version changed.
- Wikipedia pictures work again: thumbnails from thumb.wikimedia.org are accepted, the next matching article is tried after a miss, and misses are retried after a day.
- Automatic pictures come from Wikipedia first and fall back to Brave Image Search when a Brave Search API key is set (Settings > 웹 검색). Each card has a picker with a search phrase and three candidates.
- No placeholder box: a figure appears only once its picture is ready.
- Redesigned coach tab with panels, and a spinner while a chapter is being prepared.

## Validation

- `tests/coach.test.mjs` (12 tests) and TypeScript checks for main and renderer.
- Production build and packaged app.
- No live AI, TinyFish, Brave or Hindsight responses were exercised.

## Local distribution

- Installation target: `/Volumes/Aquatope/Applications/MD Reader.app`; existing user data is preserved.
- Local distribution only; no Developer ID signing or notarization.

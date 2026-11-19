# MD Reader 0.10.3

Reading coach picture fix.

- Card pictures that failed to decode now load: image requests ask for PNG, JPEG or GIF instead of WebP, GIF/WebP bytes are kept as-is when they cannot be decoded, and the cache key changed so earlier misses are retried.
- Coach marks are a coloured dotted underline only, without a background tint.

## Validation

- `tests/coach.test.mjs` and TypeScript checks for main and renderer.
- Production build and packaged app.
- No live AI, TinyFish, Brave or Hindsight responses were exercised.

## Local distribution

- Installation target: `/Volumes/Aquatope/Applications/MD Reader.app`; existing user data is preserved.
- Local distribution only; no Developer ID signing or notarization.

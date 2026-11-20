# MD Reader 0.10.4

Reading coach card density.

- Card count scales with chapter length: chapters split into 3,500-word parts with about one card per 90 words (15-40 per part). Text without spaces (Chinese, Japanese) is measured by characters.
- Cards are spread evenly through each part: text is sent in numbered ~600-word segments with a per-segment quota, so the end of a chapter gets as many cards as the start.
- The next part is prepared in the background once the current one is ready.
- The daily limit counts chapters started today, so later parts of the same chapter do not use it up.
- Prompt version v4; cached decks regenerate.

## Validation

- `tests/coach.test.mjs` and TypeScript checks for main and renderer.
- Production build and packaged app.
- No live AI, TinyFish, Brave or Hindsight responses were exercised.

## Local distribution

- Installation target: `/Volumes/Aquatope/Applications/MD Reader.app`; existing user data is preserved.
- Local distribution only; no Developer ID signing or notarization.

# MD Reader 0.10.2

Reading coach and Home fixes.

- Cards no longer show past chat questions; they show only the reader's own notes and other books where the term appeared.
- Hover cards show a "그림을 불러오는 중" placeholder while a picture loads.
- Coach marks use their own blue-teal dotted underline with a faint wash, per theme.
- New "코치 카드" button in the selection menu writes a card for the selected text and lists it in the coach tab under "내가 요청한 카드". These cards do not count against the daily limit.
- Fixed the EPUB page and reader cards showing through the Home screen.

## Validation

- `tests/coach.test.mjs` and TypeScript checks for main and renderer.
- Production build and packaged app.
- No live AI, TinyFish, Brave or Hindsight responses were exercised.

## Local distribution

- Installation target: `/Volumes/Aquatope/Applications/MD Reader.app`; existing user data is preserved.
- Local distribution only; no Developer ID signing or notarization.

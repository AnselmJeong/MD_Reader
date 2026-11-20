# MD Reader 0.10.5

EPUB 내보내기에 코치 카드 포함.

- "주석 포함 EPUB 저장"이 이제 코치 카드도 함께 담는다. 카드 데이터(`coach.json`)와 카드 그림이 EPUB 안에 들어간다.
- 다른 기기의 MD Reader에서 이 EPUB을 열면 코치 카드가 그대로 복원된다. 모델을 다시 호출하지 않으며, 같은 파일을 여러 번 열어도 한 번만 가져온다.
- 각 카드는 EPUB 3 팝업 각주로도 들어가므로 Apple Books 같은 다른 리더에서도 본문에서 바로 카드 내용을 볼 수 있다.
- 저장 완료 메시지에 포함된 코치 카드 수가 표시된다.

## 검증

- `tests/coach-archive.test.mjs`, `tests/coach.test.mjs` (19개 통과).
- Electron 스모크 테스트 `tests/commentary-archive.smoke.ts`: 코치 카드 각주·`coach.json` 내보내기와 다른 기기에서 1회 가져오기, 기존 주석 EPUB 저장 시나리오 모두 통과.
- 프로덕션 빌드와 패키징된 앱.
- 실제 AI, TinyFish, Brave, Hindsight 응답은 실행하지 않았다.

## 로컬 배포

- 설치 위치: `/Volumes/Aquatope/Applications/MD Reader.app`. 기존 사용자 데이터는 유지된다.
- 로컬 배포 전용이며 Developer ID 서명이나 공증은 하지 않았다.

# LLM Conversation Session Storage 기술 검토 및 구현 계획

## 목표

현재 AI sidebar의 conversation은 `useChatStore`의 in-memory `messages` 배열에만 존재한다. 앱을 종료하거나, 문서가 바뀌거나, EPUB chapter가 바뀌면 대화 상태가 사라진다. 이 변경의 목표는 Markdown 문서 또는 EPUB chapter 단위로 여러 chat session을 영구 저장하고, 사용자가 이전 session을 다시 열 수 있게 만드는 것이다.

핵심 요구사항은 다음과 같다.

- Markdown 문서 또는 EPUB chapter를 conversation context key로 사용한다.
- 같은 context 안에서도 여러 session을 만들 수 있다.
- context가 바뀌거나 앱이 종료될 때 현재 session을 자동 저장한다.
- 이전에 읽은 context를 열면 관련 session 목록을 불러오고 dropdown에서 선택할 수 있다.
- 이전 session을 불러올 때는 user question을 기본 목록으로 보여주고 assistant answer는 접힌 상태로 둔다.
- 새 session을 시작하거나 context 전환으로 session을 마감할 때는 LLM이 제목을 생성해 저장한다.

## 현재 구조 요약

### Chat 상태

- `src/renderer/src/store/useChatStore.ts`
  - `messages`, `isStreaming`, `streamingContent`, `inputDraft`, `selectedModel`, `systemPrompt`를 zustand store에 보관한다.
  - `sendMessage()`는 user message를 즉시 `messages`에 추가한 뒤 `window.api.ollama.chat()`을 호출한다.
  - assistant 응답은 IPC token stream을 받은 뒤 `finalizeStreaming()`에서 하나의 assistant message로 추가된다.
  - 현재 `clearMessages()`는 단순히 메모리 배열을 비운다.

### 문서 상태

- `src/renderer/src/store/useDocumentStore.ts`
  - Markdown tab은 `filePath`를 id로 사용한다.
  - EPUB tab도 현재는 `filePath`를 id로 사용하고, 현재 위치만 `currentLocation` CFI string으로 보관한다.
  - `setDocument()`, `selectTab()`, `closeTab()`, `updateEpubLocation()`이 session context 전환 감지 포인트가 된다.

### EPUB chapter 상태

- `src/renderer/src/components/DocumentReader/EpubDocumentView.tsx`
  - epub.js `relocated` 이벤트에서 `location.start.cfi`, `location.start.href`를 받을 수 있다.
  - 현재 store에는 CFI만 저장되고, href/label은 component local state인 `sectionLabel`에만 남는다.
  - 따라서 EPUB chapter를 안정적인 session context key로 쓰려면 `currentChapterHref`, `currentChapterLabel` 같은 필드를 `EpubDocumentTab`에 추가해야 한다.

### Main process 저장소

- `src/main/simple-store.ts`
  - 설정과 최근 파일은 Electron `app.getPath('userData')` 아래 JSON 파일로 저장한다.
  - 단순 key-value 설정에는 충분하지만, session 목록, message 목록, 정렬, context별 조회에는 구조가 약하다.
- `src/main/ipc-handlers.ts`
  - 현재 chat 관련 IPC는 export만 있다.
  - session persistence용 IPC를 새로 추가해야 한다.

## 저장소 선택 검토

### 권장안: SQLite 파일 DB

이 요구사항은 key-value 설정이 아니라 관계형 데이터에 가깝다. context 하나에 여러 session이 있고, session 하나에 여러 message가 있으며, context별 session 목록을 최신순으로 조회해야 한다. 따라서 `SimpleStore` JSON을 확장하기보다 SQLite 파일을 main process에서 관리하는 편이 맞다.

권장 라이브러리 후보는 `better-sqlite3`이다.

- Electron main process에서 동기 prepared statement와 transaction을 단순하게 사용할 수 있다.
- session 저장은 작은 로컬 쓰기 작업이라 sync API의 단순성이 장점이다.
- Context7 문서 확인 기준으로 DB open, prepared statement, transaction API가 이 사용처에 충분하다.

DB 파일 위치:

- `${app.getPath('userData')}/chat-sessions.sqlite`

대안:

- JSON `SimpleStore`: 구현은 빠르지만 session/message가 많아지면 전체 파일 rewrite, corruption recovery, query 성능, migration 관리가 약하다.
- IndexedDB: renderer에 저장할 수 있지만 Electron app에서 파일 접근과 백업 위치가 불명확하고, main/preload 경계의 책임이 흐려진다.

## Context Key 설계

`contextKey`는 "현재 대화가 어떤 읽기 context에 속하는가"를 표현하는 안정적인 문자열이다. 최초 계획처럼 absolute path를 primary key로 쓰면 문서를 다른 폴더로 옮겼을 때 기존 session을 찾지 못한다. 따라서 경로는 key가 아니라 "마지막으로 열었던 위치" metadata로만 저장한다.

다만 filename만 primary key로 쓰는 것도 위험하다. `notes.md`, `chapter1.md`, `paper.md` 같은 파일명은 쉽게 중복되고, 서로 다른 EPUB 안에 같은 `chapter.xhtml`이 반복될 수 있다. 따라서 권장 구조는 다음과 같다.

- primary identity: 문서 fingerprint 또는 EPUB 고유 identifier
- lookup alias: filename
- debug/reopen metadata: last file path

열기 시 매칭 순서:

1. fingerprint/EPUB identifier가 일치하면 같은 문서로 본다.
2. fingerprint를 만들 수 없거나 기존 기록이 없으면 filename으로 후보를 찾는다.
3. filename 후보가 정확히 1개면 같은 문서로 자동 연결한다.
4. filename 후보가 여러 개면 session dropdown에 후보를 표시하거나 새 session으로 시작한다. 이 경우 filename-only 자동 연결은 잘못된 대화를 붙일 위험이 있다.

### Markdown

Markdown은 문서 전체가 하나의 context다.

```text
md:<document-fingerprint-or-filename-alias>
```

예:

```text
md:sha256:9f1a...
md:name:DPRH.md
```

metadata:

- `documentKind`: `markdown`
- `documentId`: content fingerprint 우선, fallback은 filename alias
- `lastFilePath`: 마지막으로 열었던 실제 경로
- `fileName`
- `contextTitle`: 문서의 첫 H1 또는 파일명
- `contentHash`: 문서 fingerprint와 동일하거나 최신 내용 hash

Markdown fingerprint 정책:

- 기본은 normalized file content의 SHA-256이다.
- 문서가 자주 편집되어 hash가 바뀌는 문제를 줄이기 위해 `filename` alias lookup을 병행한다.
- 동일 filename의 기존 문서가 하나뿐이면 hash가 달라도 기존 document record에 연결하고, `contentHash`와 `lastFilePath`를 업데이트한다.
- 동일 filename 후보가 여러 개면 자동 연결하지 않는다.

### EPUB

EPUB은 파일 전체가 아니라 chapter 단위가 context다.

```text
epub:<book-id-or-filename-alias>#<chapter-href-or-spine-index>
```

Book identity 우선순위:

1. EPUB package metadata의 unique identifier
2. EPUB file bytes hash
3. filename alias

Chapter identity 우선순위:

1. `location.start.href`에서 fragment를 제거한 href
2. href가 없으면 epub spine item id/index
3. 둘 다 없으면 CFI prefix를 제한적으로 사용

metadata:

- `documentKind`: `epub`
- `documentId`: EPUB unique identifier, file hash, 또는 filename alias
- `lastFilePath`: 마지막으로 열었던 실제 경로
- `fileName`
- `chapterHref`
- `chapterLabel`
- `lastCfi`
- `contextTitle`: `chapterLabel` 또는 EPUB title

중요한 선행 변경:

- `EpubDocumentTab`에 `currentChapterHref`, `currentChapterLabel`을 추가한다.
- `updateEpubLocation()` signature를 CFI뿐 아니라 href/label도 받도록 확장한다.
- `relocated` 이벤트에서 `location.start.href`와 TOC label을 store에 저장한다.

## DB Schema 초안

```sql
CREATE TABLE chat_contexts (
  context_key TEXT PRIMARY KEY,
  document_kind TEXT NOT NULL CHECK (document_kind IN ('markdown', 'epub')),
  document_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  last_file_path TEXT,
  context_title TEXT NOT NULL,
  chapter_href TEXT,
  chapter_label TEXT,
  last_cfi TEXT,
  content_hash TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_opened_at INTEGER NOT NULL
);

CREATE TABLE chat_document_aliases (
  id TEXT PRIMARY KEY,
  context_key TEXT NOT NULL REFERENCES chat_contexts(context_key) ON DELETE CASCADE,
  document_kind TEXT NOT NULL CHECK (document_kind IN ('markdown', 'epub')),
  document_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT,
  confidence TEXT NOT NULL CHECK (confidence IN ('fingerprint', 'filename')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE chat_sessions (
  id TEXT PRIMARY KEY,
  context_key TEXT NOT NULL REFERENCES chat_contexts(context_key) ON DELETE CASCADE,
  title TEXT NOT NULL,
  title_status TEXT NOT NULL CHECK (title_status IN ('pending', 'generated', 'fallback')),
  model TEXT,
  system_prompt TEXT,
  message_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER
);

CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  quoted_text TEXT,
  created_at INTEGER NOT NULL,
  ordinal INTEGER NOT NULL
);

CREATE INDEX idx_chat_sessions_context_updated
  ON chat_sessions(context_key, updated_at DESC);

CREATE INDEX idx_chat_contexts_document
  ON chat_contexts(document_kind, document_id);

CREATE INDEX idx_chat_document_aliases_name
  ON chat_document_aliases(document_kind, file_name);

CREATE INDEX idx_chat_messages_session_ordinal
  ON chat_messages(session_id, ordinal ASC);
```

## Main Process API 설계

새 파일:

- `src/main/chat-session-service.ts`

책임:

- DB open 및 migration
- context upsert
- session list 조회
- session create/update/finalize
- messages bulk replace 또는 append
- title 저장

IPC:

```ts
chat:sessions:list(contextKey) -> ChatSessionSummary[]
chat:sessions:create(contextMeta) -> ChatSession
chat:sessions:load(sessionId) -> { session, messages }
chat:sessions:saveDraft({ session, contextMeta, messages }) -> { sessionId }
chat:sessions:finalize({ sessionId, title?, messages }) -> { success }
chat:sessions:rename({ sessionId, title }) -> { success }
chat:sessions:archive(sessionId) -> { success }
```

`saveDraft`는 자동 저장용이다. 같은 session id에 대해 transaction으로 session row와 messages row를 함께 저장한다. 구현 단순성을 위해 초기 버전은 message append보다 "session messages 전체 replace"가 안전하다. message 수가 매우 커지면 append 방식으로 최적화한다.

## Renderer 상태 설계

`useChatStore`를 session-aware store로 확장한다.

추가 state:

```ts
currentContextKey: string | null
currentSessionId: string | null
availableSessions: ChatSessionSummary[]
sessionTitle: string | null
sessionDirty: boolean
isLoadingSession: boolean
collapsedAssistantMessageIds: Set<string>
```

추가 actions:

```ts
setContext(contextMeta)
loadSessionsForContext(contextMeta)
startNewSession(contextMeta)
loadSession(sessionId)
saveCurrentSession(reason)
finalizeCurrentSession(reason)
setMessages(messages)
toggleAssistantCollapsed(messageId)
```

중요한 규칙:

- `messages.length === 0`인 session은 DB에 저장하지 않는다.
- user가 한 번이라도 질문하면 session을 생성하거나 draft 저장 대상으로 만든다.
- streaming 중 context가 바뀌면 우선 전환을 지연하거나, 최소한 `isStreaming`일 때 새 문서/챕터 전환 시 save를 실행하지 않고 경고 상태를 둔다. 첫 구현에서는 "streaming 중 전환 시 현재 응답 완료 후 저장"이 안전하다.
- `clearMessages()`는 기존 session 삭제가 아니라 "새 session 시작"으로 의미를 바꾼다. 삭제는 별도 archive/delete 액션으로 분리한다.

## Lifecycle 상세

### 1. 새로운 Markdown 또는 EPUB chapter를 열 때

1. 문서 store가 active context meta를 계산한다.
2. chat store가 기존 current session에 message가 있으면 `saveCurrentSession('context-change')`를 호출한다.
3. 새 context의 session list를 `chat:sessions:list`로 불러온다.
4. dropdown은 session 목록을 보여주되, 아무 것도 선택하지 않은 상태를 유지한다.
5. message pane은 empty new session 상태로 둔다.

### 2. 같은 context에서 New Session 버튼을 누를 때

1. 현재 session에 message가 있으면 제목을 생성한다.
2. `finalizeCurrentSession('new-session')`으로 저장한다.
3. `messages`를 비우고 `currentSessionId`를 null로 둔다.
4. session list를 refresh한다.

### 3. 이전 session을 선택할 때

1. 현재 session에 message가 있으면 먼저 저장한다.
2. 선택한 session의 messages를 `chat:sessions:load`로 불러온다.
3. user message는 일반 카드로 표시한다.
4. assistant message는 기본 collapsed 상태로 표시하고, question 아래에서 펼칠 수 있게 한다.

표시 구조 권장:

- session replay 모드에서는 message pair UI를 만든다.
- user question card 아래에 "Show answer" toggle을 두고 assistant answer를 접는다.
- 현재 진행 중인 live session은 기존처럼 최신 대화를 펼쳐 보여준다. 단, loaded historical session은 기본 collapsed로 시작한다.

### 4. 문서 close, tab switch, app quit

감지 포인트:

- `DocumentTabs`의 `selectTab()`, `closeTab()`
- `App.handleOpenFile()`
- drag/drop open
- EPUB `relocated`로 chapter href가 바뀌는 시점
- window `beforeunload`
- main process `before-quit`는 renderer 상태를 직접 알기 어려우므로, renderer의 `beforeunload` autosave를 1차로 둔다.

처리:

- message가 있으면 autosave한다.
- session title이 `pending`이면 title generation을 시도하되, 종료 직전이면 fallback title을 즉시 저장한다.

## Session Title 생성 전략

제목은 LLM으로 생성하되 저장 안정성을 위해 fallback을 반드시 둔다.

### 제목 생성 prompt

입력:

- 첫 1-3개 user question
- 필요하면 assistant answer의 짧은 excerpt
- 문서/chapter title

출력:

- 4-8 words 또는 한국어 10-20자 정도의 짧은 제목
- 따옴표 없이 plain text

### 구현 방식

1. `finalizeCurrentSession()`에서 title이 pending이면 `generateSessionTitle(messages, contextTitle)` 호출
2. title 생성 성공 시 `title_status = 'generated'`
3. 실패/timeout/앱 종료 직전이면 fallback:
   - 첫 user question의 앞 40자
   - 없으면 `${contextTitle} session`

주의:

- 제목 생성을 위해 기존 conversation에 영향을 주면 안 된다.
- 가능하면 별도 `ollama:generate-title` IPC를 두거나, 기존 `ollama-service`에 non-streaming helper를 추가한다.
- title generation 실패가 session 저장 실패로 이어지면 안 된다.

## UI 변경 계획

### ChatPanel header

현재 header에는 model select, Export, Clear만 있다. 다음 컨트롤을 추가한다.

- session dropdown
  - placeholder: `New session`
  - options: saved session title + updated date + message count
- New Session button
- Rename 또는 Archive는 첫 구현에서는 optional menu로 둔다.

공간이 좁으므로 header를 2-row로 나누는 것이 낫다.

1. row: Conversation title/icon + model select
2. row: session dropdown + New Session + Export

### Message rendering

- `ChatMessage`는 현재 단일 message rendering에 최적화되어 있다.
- 이전 session 표시를 위해 `ChatTranscript` 또는 `SessionReplay` 컴포넌트를 새로 만든다.
- pair 구성:
  - user message
  - 바로 뒤 assistant message가 있으면 같은 question group에 묶기
  - assistant가 여러 개거나 error message가 있으면 순서 보존

초기 collapsed 규칙:

- loaded historical session: assistant answer collapsed by default
- live current session: assistant answer expanded by default
- user가 펼친 상태는 session load 중 local state로만 유지해도 충분하다.

## 보안 및 안정성

- renderer는 DB 파일에 직접 접근하지 않는다. 모든 DB 접근은 main IPC를 통한다.
- IPC payload는 최소한의 schema validation을 한다.
- message content는 Markdown/HTML 렌더링 전에 기존 `ChatMessage`의 escape/fallback 흐름을 유지한다.
- DB write는 transaction으로 session metadata와 messages를 같이 저장한다.
- 앱 종료/전환 시 title generation이 느리면 fallback title로 저장한다.
- 추후 민감 데이터 우려가 있으면 "clear all chat history"와 per-session delete를 제공한다.

## Migration 및 호환성

- 새 DB는 기존 사용자에게 빈 상태로 시작한다.
- 기존 conversation은 메모리에만 있었으므로 migration 대상이 없다.
- `better-sqlite3`를 추가하면 native dependency가 생긴다. `electron-builder install-app-deps`와 packaging 검증이 필요하다.
- native dependency packaging 문제가 생기면 fallback으로 `sqlite` WASM/JS 계열 또는 JSON store v1을 고려할 수 있다. 그래도 기본 계획은 SQLite다.

## 구현 단계

### Phase 1: Context identity 정리

- `DocumentTab` 타입에 session context metadata를 추가한다.
- Markdown은 content fingerprint와 filename alias를 함께 계산하는 helper를 만든다.
- EPUB은 package unique identifier, file hash, filename alias를 순서대로 계산하는 helper를 만든다.
- EPUB `relocated` 이벤트에서 `href`, `label`, `cfi`를 store에 저장한다.
- active tab에서 `ChatContextMeta`를 계산하는 selector/helper를 만든다.

완료 기준:

- Markdown 문서는 폴더 이동 후에도 기존 session 후보를 찾을 수 있다.
- EPUB은 chapter 이동 시 context key가 chapter href 기준으로 바뀐다.
- 동일 filename 후보가 여러 개면 자동으로 잘못된 session에 붙지 않는다.

### Phase 2: DB service와 IPC 추가

- `better-sqlite3` dependency를 추가한다.
- `src/main/chat-session-service.ts`를 만든다.
- schema migration을 앱 시작 시 실행한다.
- `ipc-handlers.ts`에 session IPC를 등록한다.
- `preload/index.ts`, `global.d.ts`에 타입을 노출한다.

완료 기준:

- main process에서 context별 session list/create/load/save가 가능하다.
- transaction 저장 테스트가 가능하다.

### Phase 3: Chat store session-aware 전환

- `useChatStore`에 session/context state와 actions를 추가한다.
- active context 변경을 감지하는 hook을 `App` 또는 `ChatPanel`에 둔다.
- context 변경 전 현재 session을 autosave한다.
- context 변경 후 session list를 load하고 empty new session 상태를 보여준다.

완료 기준:

- 문서 전환 후 이전 대화가 새 문서에 섞이지 않는다.
- 기존 context로 돌아가면 session dropdown 목록이 나온다.

### Phase 4: New Session 및 title generation

- New Session button을 추가한다.
- 현재 session finalize 시 title generation을 붙인다.
- 실패 시 fallback title을 저장한다.
- dropdown 목록을 refresh한다.

완료 기준:

- 같은 문서/chapter에 여러 session을 만들 수 있다.
- 각 session은 구분 가능한 제목을 가진다.

### Phase 5: Historical session UI

- session dropdown에서 session load를 구현한다.
- loaded session에서는 question-first UI를 적용한다.
- assistant answer는 기본 collapsed, click/toggle로 expand한다.
- live session과 loaded session의 UX 차이를 명확히 한다.

완료 기준:

- 이전 session을 열면 화면이 answer 전체로 즉시 복잡해지지 않는다.
- question을 기준으로 빠르게 훑고 필요한 answer만 펼칠 수 있다.

### Phase 6: Autosave hardening

- tab switch, tab close, file open, drag/drop open, EPUB chapter change, window unload에서 저장을 검증한다.
- streaming 중 전환 정책을 구현한다.
- title generation timeout과 fallback을 검증한다.
- DB write failure 시 user-facing error 또는 console error를 남긴다.

완료 기준:

- 앱 종료 후 재실행해도 session 목록과 messages가 남아 있다.
- context 전환 경계에서 대화가 유실되거나 잘못된 context에 붙지 않는다.

## 테스트 계획

### 수동 QA

1. 새 Markdown 문서를 열고 질문 2개를 한다.
2. 앱을 종료했다가 다시 열고 같은 문서에서 session 목록이 나오는지 확인한다.
3. 같은 문서에서 New Session을 만들고 별도 질문을 한다.
4. dropdown에서 이전 session과 새 session을 번갈아 열어 messages가 섞이지 않는지 확인한다.
5. EPUB을 열고 chapter A에서 질문한 뒤 chapter B로 이동한다.
6. chapter A와 B의 session 목록이 분리되는지 확인한다.
7. 이전 session을 열었을 때 user question만 먼저 보이고 answer가 접혀 있는지 확인한다.
8. streaming 중 문서 전환 또는 chapter 전환을 시도해 저장 정책이 깨지지 않는지 확인한다.

### 자동/명령 검증

- `npm run build`
- `git diff --check`
- 가능하면 chat-session-service 단위 테스트를 추가한다.
  - schema migration
  - context upsert
  - session save/load
  - multiple sessions under same context
  - EPUB chapter key 분리

## 주요 리스크와 대응

### EPUB chapter key drift

EPUB CFI는 레이아웃/폰트/뷰 변화에 민감할 수 있다. chapter 식별은 CFI가 아니라 `href`를 우선해야 한다. CFI는 마지막 위치 복원용 metadata로만 쓴다.

### Filename-only collision

폴더 이동을 고려하면 absolute path는 primary key로 부적절하다. 그러나 filename만 primary key로 쓰면 서로 다른 `notes.md`나 `chapter.xhtml`이 같은 session 목록을 공유하는 심각한 오연결이 생길 수 있다. filename은 lookup alias로 쓰고, fingerprint 또는 EPUB identifier를 primary identity로 둔다.

### Autosave race

streaming 완료와 context 전환 저장이 동시에 일어나면 assistant answer가 누락될 수 있다. `isStreaming`일 때는 context 전환 저장을 지연하거나, 전환 요청을 queue 처리해야 한다.

### Session title generation latency

앱 종료나 빠른 전환 중 title generation을 기다리면 저장이 불안정해진다. title은 실패 가능 작업으로 보고, fallback title 저장을 항상 보장한다.

### UI 혼잡

ChatPanel header는 이미 좁다. session dropdown을 무리하게 한 줄에 넣으면 모델 선택과 충돌한다. 2-row header 또는 compact menu가 필요하다.

### Native dependency packaging

`better-sqlite3`는 native dependency이므로 Electron packaging에서 검증이 필요하다. build 실패 시 즉시 대체안을 검토하되, 데이터 모델 자체는 SQLite에 맞춰 유지하는 것이 좋다.

## 결론

이 변경은 단순 "대화 배열 저장"이 아니라, 읽기 context identity와 chat session lifecycle을 앱 상태 모델에 추가하는 작업이다. 먼저 Markdown/EPUB context key를 안정화하고, main process SQLite service를 만든 뒤, renderer chat store를 session-aware하게 바꾸는 순서가 안전하다. 특히 EPUB은 현재 chapter href/label이 store에 보존되지 않으므로, DB 저장 작업보다 EPUB context metadata 승격이 선행되어야 한다.

# Ollama Cloud + Web Search Restructuring Plan

## Goal

MD_Reader의 AI sidebar를 local Ollama 전용 구조에서 Ollama Cloud/OpenAI-compatible API 기반 구조로 바꾸고, Ollama Web Search/Web Fetch를 이용해 답변에 근거와 출처를 붙인다.

최종 사용자 경험은 다음을 목표로 한다.

- 사용자는 Settings에서 Ollama API key를 저장한다.
- AI sidebar는 `https://ollama.com/v1`의 OpenAI-compatible chat API를 기본 모델 호출 경로로 사용한다.
- 필요할 때 web search가 실행되고, 답변에는 사용한 출처가 별도로 표시된다.
- 기존 chat streaming, stop, session save/load, title generation, agent memory injection은 깨지지 않는다.
- API key는 renderer에 평문으로 오래 머물지 않고 main process/service 경계에서만 사용한다.

## Source Notes

공식 문서 기준 확인 사항:

- Ollama Cloud direct API access는 API key 기반 `Authorization: Bearer $OLLAMA_API_KEY` 인증을 요구한다.
- Ollama Cloud JavaScript 예제는 `host: "https://ollama.com"`와 Bearer header를 사용한다.
- Ollama OpenAI compatibility는 `/v1/chat/completions`, `/v1/responses`, `/v1/models`를 제공하며 streaming, JSON mode, tools를 지원한다.
- Ollama Web Search는 `POST https://ollama.com/api/web_search`이고 결과는 `{ results: [{ title, url, content }] }` 형태다.
- Ollama Web Fetch는 `POST https://ollama.com/api/web_fetch`이고 결과는 `{ title, content, links }` 형태다.
- Web search/fetch 결과는 길어질 수 있으므로 검색 agent에는 큰 context window가 권장된다.

References:

- https://docs.ollama.com/cloud#javascript-2
- https://docs.ollama.com/api/openai-compatibility
- https://docs.ollama.com/capabilities/web-search
- Context7 lookup: `/llmstxt/ollama_llms-full_txt`

## Current Architecture Diagnosis

Current local-Ollama path:

- `src/main/ollama-service.ts`
  - Owns `OLLAMA_BASE`, `listModels`, `chatStream`, `generateChatTitle`, `generateJsonResponse`.
  - Calls local endpoints directly: `/api/tags` and `/api/chat`.
  - Streams NDJSON from local `/api/chat`.
- `src/main/ipc-handlers.ts`
  - Owns `ollama:list-models`, `ollama:chat`, `ollama:stop`, `ollama:generate-title`.
  - Injects agent memory into `systemPrompt`.
  - Sends only token strings and terminal events to renderer: `ollama:token`, `ollama:done`, `ollama:error`, `ollama:stopped`.
- `src/preload/index.ts`
  - Exposes the Ollama IPC surface to renderer.
- `src/renderer/src/store/useChatStore.ts`
  - Owns selected model, available models, system prompt, streaming text, saved messages, and session calls.
  - Persists `ollamaModel` via `window.api.settings.set`.
- `src/main/settings-service.ts`
  - Owns persisted app settings: theme, reader font, AI sidebar font, `ollamaModel`, `systemPrompt`, TTS voice.
- `src/renderer/src/components/SettingsModal.tsx`
  - Refreshes model list.
  - Allows model and system prompt edits.
  - Already has a password input/save pattern for mem0 API key in the Agent Memory section.
- `src/main/chat-session-service.ts`
  - SQLite schema stores chat messages as `content` plus `quoted_text`.
  - No citation/source metadata exists yet.

Main structural problems:

1. `ollama-service.ts` is both provider client and app-level AI service.
2. The IPC contract streams text only, so it cannot carry search status, tool events, citations, or answer metadata.
3. Chat messages and persisted sessions cannot store structured sources.
4. Settings currently expose raw settings generically; adding API keys through generic `settings:get` would risk leaking secrets to renderer.
5. Model listing and model selection assume a local model catalog and silent fallback to the first discovered model.
6. The current default system prompt explicitly encourages broad external knowledge, which increases hallucination risk when no live search is attached.

## Target Architecture

Use a narrow service split rather than a rewrite.

### Main Process Services

`src/main/ai-provider-settings.ts`

- Owns provider configuration and secrets.
- Stores:
  - `ollamaApiKey`
  - `ollamaBaseUrl`, default `https://ollama.com/v1`
  - `ollamaSearchBaseUrl`, default `https://ollama.com/api`
  - `webSearchEnabled`, default `true`
  - `webSearchMaxResults`, default `5`
  - optional `chatModel`
- Reads `process.env.OLLAMA_API_KEY` as an override.
- Exposes sanitized status:
  - `hasOllamaApiKey`
  - `ollamaBaseUrl`
  - `webSearchEnabled`
  - `webSearchMaxResults`
  - never returns the saved API key.

`src/main/ollama-openai-client.ts`

- Low-level OpenAI-compatible HTTP client using native `fetch`.
- Methods:
  - `listModels()`
  - `chatCompletionsStream(params, callbacks, signal)`
  - `chatCompletionsJson(params, signal)` for title generation or JSON tasks if needed.
- Talks to:
  - `GET https://ollama.com/v1/models`
  - `POST https://ollama.com/v1/chat/completions`
- Parses SSE-style OpenAI-compatible streams.
- Normalizes errors, including 401/403 auth, 429 rate limit, 5xx provider errors.

`src/main/ollama-web-search-service.ts`

- Low-level search/fetch client.
- Methods:
  - `webSearch(query, { maxResults })`
  - `webFetch(url)`
- Talks to:
  - `POST https://ollama.com/api/web_search`
  - `POST https://ollama.com/api/web_fetch`
- Returns normalized `CitationSource[]`.

`src/main/ai-chat-service.ts`

- App-level orchestration layer.
- Replaces direct `chatStream` ownership in IPC handlers.
- Responsibilities:
  - merge user messages, document context, and agent memory context
  - decide whether to search
  - run search/fetch before final answer, or run a small tool loop later if needed
  - build a grounded prompt containing source snippets
  - stream answer tokens
  - emit source/search metadata events
  - return final `ChatCompletionMetadata`

### Renderer Data Model

Extend chat messages with source metadata.

```ts
export interface ChatSource {
  id: string
  title: string
  url: string
  snippet?: string
  fetchedTitle?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  quotedText?: string
  sources?: ChatSource[]
}
```

Persistence:

- Add `sources_json TEXT` to `chat_messages`.
- Save/load `sources` through `StoredChatMessage`.
- Existing rows get `sources: []`.

### IPC Contract

Keep existing IPC names initially to reduce UI churn, but expand events.

Existing events stay:

- `ollama:token`
- `ollama:done`
- `ollama:error`
- `ollama:stopped`

New events:

- `ollama:search-start`
  - payload: `{ query: string }`
- `ollama:search-results`
  - payload: `{ sources: ChatSource[] }`
- `ollama:metadata`
  - payload: `{ sources: ChatSource[] }`

`ollama:done` should eventually accept metadata too:

```ts
{ sources?: ChatSource[] }
```

But for compatibility, renderer should tolerate both old empty done events and new payloads.

## Web Search Strategy

Recommended v1 implementation: deterministic pre-search, not autonomous tool loop.

Reasoning:

- Current app has a simple single-stream answer lifecycle.
- Ollama's web search API is already a REST API, so we can fetch sources before generation.
- A model-driven tool loop would require larger IPC changes, more state transitions, and more failure handling.
- Pre-search gives immediate hallucination reduction with less regression risk.

Flow:

1. User sends a message.
2. Main process receives `ollama:chat`.
3. `ai-chat-service` builds a search query from:
   - user question
   - selected passage if present
   - current document/chapter title
4. If web search is enabled and API key exists:
   - call `web_search` with `max_results`.
   - normalize top results into `ChatSource[]`.
   - optionally call `web_fetch` for the top 1-2 results only when snippets are too thin or the question clearly needs fresh detail.
5. Send `ollama:search-results` to renderer.
6. Add a "Sources" block into the system/developer prompt:
   - numbered sources
   - title, URL, snippet/content excerpt
   - instruction: cite claims using `[S1]`, `[S2]` style markers
   - instruction: say when sources do not support the answer
7. Stream the final answer through `chat.completions`.
8. Save final assistant message with `sources`.

Search gating:

- Default: enabled when API key exists.
- Skip search for purely document-local operations:
  - summarize selected passage
  - translate selected passage
  - explain a paragraph from the current document
  - rewrite/edit text
- Force search for questions with temporal or external factual signals:
  - "latest", "recent", "today", dates, named current entities, product/version/API questions
  - explicit "search", "web", "source", "citation", "출처", "검색"
- Conservative fallback: if unsure, search.

Important product decision:

- Do not expose many knobs at first.
- Settings should have:
  - Ollama API Key
  - Enable Web Search checkbox
  - Model selector
- Keep `max_results` internal default `5` unless testing shows cost/latency problems.

## Citation UX

Render citations in two layers.

1. Inline answer markers:
   - Model is instructed to write `[S1]`, `[S2]` markers.
   - The markdown renderer leaves them as text initially.
   - Later enhancement can link markers to source rows.

2. Source panel under assistant answers:
   - `ChatMessage` renders a compact `Sources` section for assistant messages with `sources.length > 0`.
   - Each source row shows:
     - `[S1]`
     - title
     - hostname
     - short snippet
   - Clicking opens external URL through existing `shell.openExternal`.

Export:

- `handleExport` should include sources below each assistant message.

Historical sessions:

- Loaded sessions should render saved sources the same way as live sessions.

## Settings UX and Secret Handling

Add an `Ollama Cloud` subsection under AI Settings.

Fields:

- API Key password input
  - placeholder: `Leave blank to keep existing key` when saved
  - save behavior mirrors mem0 key handling
- Web Search checkbox
- Optional non-secret Base URL display/input only if we decide debugging needs it.

Main-process APIs:

- `ai-provider:status`
  - returns sanitized provider status.
- `ai-provider:update-settings`
  - accepts partial settings including `ollamaApiKey`.
  - blank API key means "keep existing key".
  - explicit future "clear key" action can be added separately.

Avoid:

- Do not include `ollamaApiKey` in `settings:get`.
- Do not add the key to Zustand state.
- Do not log request headers or settings objects containing the key.

Storage caveat:

- Current `SimpleStore` is a plain JSON file under Electron `userData`.
- For this implementation, match the existing mem0 key pattern unless we choose to harden secrets now.
- Security improvement option: introduce OS keychain storage later via a small secret-store service. That is more secure, but it is a separate dependency/packaging decision.

## Prompting Changes

Current prompt encourages external knowledge without grounding. Replace it with a grounded default.

Proposed default system prompt:

```text
You are a careful academic reading assistant. Answer in Korean.

Use the provided document context first. When web sources are provided, use them to verify current or external factual claims and cite them with [S1], [S2] markers. If the provided document or sources do not support a claim, say so clearly instead of guessing.

Keep answers precise, distinguish document evidence from web evidence, and avoid inventing citations.
```

Generation prompt should include:

- document context
- selected quote if present
- memory context if enabled
- web source block if search ran
- explicit citation instructions

## Implementation Plan

### Step 1. Safety Baseline

Goal:

- Confirm current behavior and validation commands before changing structure.

Target files:

- `package.json`
- `src/main/ollama-service.ts`
- `src/main/ipc-handlers.ts`
- `src/preload/index.ts`
- `src/renderer/src/App.tsx`
- `src/renderer/src/store/useChatStore.ts`
- `src/renderer/src/components/SettingsModal.tsx`
- `src/main/chat-session-service.ts`

Actions:

- Run `npm run build`.
- Capture current model-loading behavior.
- Confirm existing dirty worktree and avoid unrelated files.

Expected unchanged behavior:

- App builds.
- Existing local-flow concepts are understood before replacement.

Risk:

- Low.

Validation:

- `npm run build`
- `git status --short`

Rollback:

- No code changes in this step.

### Step 2. Add Provider Settings Service

Goal:

- Add Ollama Cloud settings without leaking API key through generic settings.

Target files:

- `src/main/ai-provider-settings.ts` new
- `src/main/ipc-handlers.ts`
- `src/preload/index.ts`
- `src/renderer/src/global.d.ts` if needed
- `src/renderer/src/components/SettingsModal.tsx`

Actions:

- Create `AiProviderSettings`.
- Store API key and web search toggle in a dedicated `SimpleStore`.
- Add sanitized status/update IPC.
- Add Settings UI for API key and web search.

Expected unchanged behavior:

- Existing appearance/TTS/model settings still load.
- Existing mem0 settings unchanged.

Risk:

- Medium, because settings initialization and modal rendering are shared UI paths.

Validation:

- `npm run build`
- Manual settings smoke test:
  - enter key
  - close/open settings
  - verify only saved status is shown
  - verify no API key appears in renderer state or console logs

Rollback:

- Remove new service, IPC entries, and SettingsModal section.

### Step 3. Replace Low-Level Local Chat Client with OpenAI-Compatible Client

Goal:

- Make chat/model/title generation use `https://ollama.com/v1` instead of local `/api/chat`.

Target files:

- `src/main/ollama-openai-client.ts` new
- `src/main/ollama-service.ts` either replaced or converted to compatibility facade
- `src/main/ipc-handlers.ts`
- `src/main/memory-extractor.ts`
- `src/renderer/src/utils/ollama-model-filter.ts`

Actions:

- Implement `listModels` via `/v1/models`.
- Implement streaming parser for OpenAI-compatible chat completion stream.
- Implement non-streaming title generation.
- Implement JSON generation support for memory extraction, either:
  - `response_format: { type: "json_object" }`, or
  - a strict JSON prompt fallback if the endpoint rejects JSON mode for a model.
- Keep exported function names temporarily so callers change minimally.

Expected unchanged behavior:

- Sidebar still streams tokens.
- Stop still aborts active request.
- Title generation still returns a short string.
- Memory extraction still receives a raw JSON string.

Risk:

- High, because stream framing changes from local Ollama NDJSON to OpenAI-compatible SSE.

Validation:

- `npm run build`
- Unit-like parser test if practical:
  - feed mock `data: {...}\n\n`
  - feed `[DONE]`
  - assert extracted deltas.
- Manual smoke:
  - list models with saved API key
  - send one chat
  - stop mid-stream
  - generate session title

Rollback:

- Keep old local client in git history or behind a temporary provider switch until cloud path is verified.

### Step 4. Add Web Search Client

Goal:

- Provide normalized search/fetch results for grounding.

Target files:

- `src/main/ollama-web-search-service.ts` new
- `src/main/ai-chat-types.ts` new

Actions:

- Implement `webSearch(query, maxResults)`.
- Implement `webFetch(url)`.
- Normalize sources:
  - stable `id` like `S1`
  - title
  - url
  - hostname
  - snippet/content excerpt
- Add error classes for:
  - missing API key
  - auth failure
  - rate limit
  - network/provider failure

Expected unchanged behavior:

- No chat behavior changes until orchestration uses the service.

Risk:

- Medium, because external network behavior can fail.

Validation:

- `npm run build`
- Manual call through a temporary dev-only script or IPC smoke handler, then remove script/handler before final implementation if not needed.

Rollback:

- Remove search service and types.

### Step 5. Introduce AI Chat Orchestrator

Goal:

- Move answer-generation orchestration out of IPC and add optional grounding.

Target files:

- `src/main/ai-chat-service.ts` new
- `src/main/ipc-handlers.ts`
- `src/main/agent-memory-service.ts` interaction only
- `src/main/ollama-openai-client.ts`
- `src/main/ollama-web-search-service.ts`

Actions:

- Add `streamGroundedChat(params, callbacks, signal)`.
- Preserve current agent-memory injection behavior.
- Add search query builder.
- Add search gating rules.
- Send callbacks:
  - `onSearchStart`
  - `onSources`
  - `onToken`
  - `onDone`
- Build prompt with numbered source block.

Expected unchanged behavior:

- Chat still works when web search is disabled.
- Chat still works when no API key exists only if model call itself is allowed by configured environment; otherwise a clear setup error is shown.
- Agent memory context remains included.

Risk:

- High, because this is the new behavioral core.

Validation:

- `npm run build`
- Manual smoke:
  - simple document-local question should not search
  - latest/current factual question should search
  - search failure should produce clear non-destructive error or continue without sources depending on error type
  - answer has `[S#]` markers when sources exist

Rollback:

- Repoint IPC handler to old direct `chatStream` facade.

### Step 6. Extend IPC and Renderer Store for Sources

Goal:

- Carry citation metadata from main process to renderer and final assistant messages.

Target files:

- `src/preload/index.ts`
- `src/renderer/src/store/useChatStore.ts`
- `src/renderer/src/components/ChatPanel/ChatPanel.tsx`
- `src/renderer/src/components/ChatPanel/ChatMessage.tsx`

Actions:

- Add source types to preload/global definitions.
- Add `pendingSources` or `streamingSources` to chat store.
- Handle `ollama:search-results` and `ollama:metadata`.
- On `finalizeStreaming`, attach sources to the assistant message.
- Render source list under assistant message.
- Include source metadata in export markdown.

Expected unchanged behavior:

- Chats without sources render as before.
- Historical transcript behavior remains unchanged except source display is available.

Risk:

- Medium.

Validation:

- `npm run build`
- Manual UI smoke:
  - streaming answer without sources
  - streaming answer with sources
  - copy button copies answer content only
  - external source links open via `shell.openExternal`

Rollback:

- Remove new source state/listeners and source rendering.

### Step 7. Persist Sources in Chat Sessions

Goal:

- Preserve citations after app restart/session reload.

Target files:

- `src/main/chat-session-service.ts`
- `src/preload/index.ts`
- `src/renderer/src/store/useChatStore.ts`

Actions:

- Add `sources_json TEXT` migration to `chat_messages`.
- Extend `StoredChatMessage` with `sources?: ChatSource[]`.
- Save sources as compact JSON.
- Load sources defensively:
  - invalid JSON becomes `[]`
  - missing column becomes `[]`

Expected unchanged behavior:

- Existing sessions load.
- Existing messages without source metadata remain valid.

Risk:

- Medium, because SQLite schema migration touches persisted user data.

Validation:

- `npm run build`
- Open existing session.
- Save a new sourced answer.
- Restart app.
- Reload session and verify sources render.

Rollback:

- Leave additive column in place; stop reading/writing it if necessary.

### Step 8. Tighten Model Selection and Startup Restore

Goal:

- Avoid confusing fallback behavior when cloud model listing differs from local model listing.

Target files:

- `src/renderer/src/App.tsx`
- `src/renderer/src/components/SettingsModal.tsx`
- `src/renderer/src/store/useChatStore.ts`
- `src/renderer/src/utils/ollama-model-filter.ts`

Actions:

- Model list comes from new cloud provider.
- Preserve previous selected model only if it exists.
- If saved model is unavailable:
  - do not silently select an unrelated model if API key/model list is missing.
  - show "No cloud models found" or "API key required" state.
- Revisit `filterOllamaModels`; cloud model names should not be filtered by assumptions made for local OCR/helper models unless still valid.

Expected unchanged behavior:

- Saved valid model persists across restart.
- Invalid saved model is handled clearly.

Risk:

- Medium.

Validation:

- `npm run build`
- Restart app with:
  - valid key and valid saved model
  - valid key and missing saved model
  - no key

Rollback:

- Restore previous model selection logic.

### Step 9. Prompt and Hallucination QA

Goal:

- Make grounded behavior observable and regressions catchable.

Target files:

- `src/main/settings-service.ts`
- `src/renderer/src/store/useChatStore.ts`
- `src/main/ai-chat-service.ts`

Actions:

- Update default system prompt to grounded Korean assistant prompt.
- Ensure saved user-custom prompt is not overwritten.
- Add source prompt instruction only when sources exist.
- Ensure document-local answers distinguish "document says" from "web says".

Expected unchanged behavior:

- Existing saved custom prompts remain.
- New installs get safer default prompt.

Risk:

- Low to medium.

Validation:

- Manual prompt tests:
  - asks about current event
  - asks about a selected paragraph
  - asks unsupported claim
  - asks for citation/source

Rollback:

- Restore prior default prompt.

### Step 10. Final Verification

Goal:

- Confirm the feature works end-to-end.

Validation checklist:

- `npm run build`
- `git diff --check`
- Manual:
  - Settings saves API key without echoing it.
  - Model list loads from Ollama Cloud.
  - AI sidebar sends a normal message and streams an answer.
  - Stop button/Escape cancels stream.
  - Web-search-triggering prompt emits sources.
  - Sources render and links open externally.
  - Chat export includes sources.
  - Session save/load preserves sources.
  - App restart preserves selected model and settings.
  - Agent memory still injects when enabled.

## Testing Additions

The repo currently appears to rely mainly on `npm run build` and manual Electron smoke testing. Because this change touches parsing and persistence, add focused tests if the project has or accepts a lightweight test runner. If not, create pure helper functions that are easy to manually exercise.

High-value tests:

- SSE parser for OpenAI-compatible streaming chunks.
- Search result normalization.
- Source JSON parse fallback.
- Search gating function.
- Prompt source-block builder.

If no test framework is added:

- Keep helper functions pure.
- Add small dev-only scripts under a clearly temporary path during implementation, then remove or convert them to real tests before final.

## Risks and Mitigations

### API shape mismatch

Risk:

- Ollama Cloud may support `https://ollama.com/api` and local OpenAI-compatible `/v1` differently than expected.

Mitigation:

- First implementation step for the client should verify:
  - `GET https://ollama.com/v1/models`
  - `POST https://ollama.com/v1/chat/completions`
  - streaming format
- If `/v1/models` is not supported on cloud, use `https://ollama.com/api/tags` for model listing while keeping chat on `/v1/chat/completions`.

### Source hallucination

Risk:

- Model may cite `[S1]` even when source does not support the claim.

Mitigation:

- Keep snippets concise and source-numbered.
- Prompt explicitly to say when sources do not support the answer.
- Render source list separately from inline markers so users can inspect provenance.
- Later enhancement: post-process inline markers and warn if marker id is unknown.

### Latency

Risk:

- Search + fetch before generation slows every question.

Mitigation:

- Gate search.
- Use snippets only for first version.
- Fetch full pages only for top results when needed.
- Show search status in sidebar while waiting.

### Secret leakage

Risk:

- API key leaks through `settings:get`, logs, or renderer state.

Mitigation:

- Separate provider settings IPC.
- Return only `hasOllamaApiKey`.
- Never log headers/settings objects.
- Prefer environment variable override in development.

### Persisted session migration

Risk:

- Existing chat DB migration fails or source JSON corrupts load.

Mitigation:

- Additive nullable column.
- Defensive parse.
- Build and manually open existing sessions before shipping.

## Recommended Implementation Order

1. Provider settings service and UI.
2. OpenAI-compatible client with streaming parser.
3. Web search/fetch client.
4. AI chat orchestrator with pre-search grounding.
5. Renderer source metadata and citation UI.
6. Session persistence migration.
7. Prompt cleanup and QA.

This order keeps secrets/configuration first, then provider transport, then grounding behavior, then UI/persistence.

## Open Questions to Resolve During Implementation

- Does `https://ollama.com/v1/models` work for the user's Cloud account, or should model listing use `https://ollama.com/api/tags`?
- Should local Ollama remain as an optional fallback provider, or should this migration make Cloud the only path?
- Should source-bearing answers be mandatory for all web-search-triggered questions, or should search failures fall back to an uncited answer with a warning?
- Should API key storage stay consistent with the existing mem0 JSON-store pattern, or should we introduce OS keychain storage now?

My recommendation:

- Make Cloud the primary path now.
- Keep a temporary local fallback only if implementation verification shows Cloud `/v1` gaps.
- Use pre-search grounding first; defer autonomous model tool loops.
- Keep API key storage consistent with existing mem0 for the first pass, then harden with keychain in a separate security task.

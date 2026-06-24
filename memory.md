# MD_Reader Agent Memory Plan

## 1. Goal

MD_Reader already persists chat sessions in SQLite. The next layer should turn those saved sessions into long-term conversational memory so the assistant can become a deeper discussion partner over repeated use.

The system should learn three different kinds of durable knowledge:

- `USER.md`: relatively stable facts about the user as a thinker, reader, scholar, builder, and collaborator.
- `SOUL.md`: durable instructions about how the assistant should relate to this user. This is behavioral memory, so it must be updated more conservatively than `USER.md`.
- `mem0`: searchable, source-linked intellectual insights that emerge from conversations and may help future discussions.

The most important design rule is negative: do not turn mem0 into a worse document index. MD_Reader already has the source document and chat transcript. Do not store every fact from the read text. Store only signals that are about the user, or cross-document/cross-session insights that were created by the discussion.

## 2. Current App Context

Relevant current files:

- `src/main/chat-session-service.ts`
  - Opens `${app.getPath('userData')}/chat-sessions.sqlite`.
  - Defines `chat_contexts`, `chat_sessions`, and `chat_messages`.
  - Saves session messages by replacing all messages for a session inside a transaction.
- `src/renderer/src/store/useChatStore.ts`
  - Owns `messages`, `currentContextMeta`, `currentSessionId`, `sessionDirty`, `sessionView`.
  - Calls `saveCurrentSession()` on context switches, app close paths, and session changes.
  - Generates session titles through `window.api.ollama.generateTitle()`.
- `src/main/ollama-service.ts`
  - Talks to local Ollama through `OLLAMA_BASE_URL || http://127.0.0.1:11434`.
  - Already has a non-streaming title-generation call that can be mirrored for extraction.
- `src/main/ipc-handlers.ts` and `src/preload/index.ts`
  - Expose chat session persistence APIs.

This means the first implementation should be main-process-first. The renderer should not directly call mem0 or hold memory service secrets.

## 3. mem0 Self-Host Findings

Sources checked:

- Context7 docs for `/mem0ai/mem0`.
- `mem0ai/mem0` GitHub repository.
- Official Mem0 documentation.
- Mem0 self-host Docker guide.

Current mem0 options:

1. Library mode
   - Python: `pip install mem0ai`, use `Memory.from_config(...)`.
   - Node/TypeScript: `npm install mem0ai`, use `Memory` from the OSS SDK.
   - Good for simple local prototypes, but it couples MD_Reader directly to mem0 internals and provider configs.

2. Self-hosted server mode
   - Recommended for MD_Reader.
   - The repo includes `server/`, a FastAPI REST server, and a dashboard stack.
   - Official setup path:
     - clone `https://github.com/mem0ai/mem0`
     - copy `server/.env.example` to `server/.env`
     - set `OPENAI_API_KEY` or another supported provider key
     - set `JWT_SECRET`
     - run `cd server && make up` for browser setup, or `cd server && make bootstrap` for agent/CLI setup
   - API defaults to `http://localhost:8888`.
   - Dashboard defaults to `http://localhost:3000`.
   - Auth is now on by default. For local development only, `AUTH_DISABLED=true` is possible. For real use, create an API key and keep it in main-process configuration only.

3. Backing stores
   - Server stack uses Postgres + pgvector for vectors.
   - It can also include Neo4j/entity graph support depending on server configuration.
   - The official OSS overview says library mode defaults differ from server mode: library can default to local Qdrant/history SQLite, while server mode is pgvector-backed.

4. Provider strategy for this app
   - Phase 1: self-hosted server with OpenAI-compatible defaults if the user accepts external LLM/embedding calls.
   - Phase 2: local-first configuration with Ollama for extraction and local embeddings, but this may require extending the server image because the default server container only bundles selected providers.
   - Because MD_Reader already uses Ollama, local extraction can happen in MD_Reader itself even if mem0 stores final, already-curated insight text with `infer: false`.

Recommendation: use mem0 server as the durable vector memory store, but keep the domain-specific extraction and classification in MD_Reader. That gives us better control over what becomes memory and avoids letting mem0's generic extractor ingest raw document-heavy transcripts.

## 4. Memory Architecture

Pipeline:

```text
chat_messages in SQLite
  -> session finalization trigger
  -> MD_Reader extraction LLM pass
  -> validated JSON result
  -> USER.md patch proposal / write
  -> SOUL.md patch proposal / conservative write
  -> mem0 add/search for insight memories
  -> extraction audit rows in SQLite
```

Runtime retrieval:

```text
new user message + reading context
  -> load SOUL.md
  -> load compact USER.md
  -> mem0 search with current question + context title + selected passage summary
  -> inject bounded memory block into system prompt
  -> send chat to selected Ollama model
```

Memory storage locations:

- Production runtime files should live under app user data, not the repo:
  - `${app.getPath('userData')}/agent-memory/USER.md`
  - `${app.getPath('userData')}/agent-memory/SOUL.md`
  - `${app.getPath('userData')}/agent-memory/review-queue.jsonl`
- The checked-in `memory.md` is only the implementation plan.
- Optional debug export can copy USER/SOUL snapshots into a user-chosen folder.

## 5. SQLite Schema Additions

Do not overload `chat_sessions`. Add explicit processing and audit tables.

```sql
ALTER TABLE chat_sessions ADD COLUMN memory_processed_at INTEGER;
ALTER TABLE chat_sessions ADD COLUMN memory_status TEXT
  CHECK (memory_status IN ('pending', 'processing', 'completed', 'skipped', 'failed'));
ALTER TABLE chat_sessions ADD COLUMN memory_error TEXT;

CREATE TABLE IF NOT EXISTS agent_memory_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  context_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing', 'completed', 'skipped', 'failed')),
  extractor_model TEXT,
  transcript_hash TEXT NOT NULL,
  input_message_count INTEGER NOT NULL,
  user_patch_count INTEGER NOT NULL DEFAULT 0,
  soul_patch_count INTEGER NOT NULL DEFAULT 0,
  insight_count INTEGER NOT NULL DEFAULT 0,
  mem0_event_ids TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS agent_memory_items (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_memory_runs(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('user_profile', 'soul_directive', 'insight', 'rejected')),
  content TEXT NOT NULL,
  confidence REAL NOT NULL,
  evidence_message_ids TEXT NOT NULL,
  target TEXT,
  status TEXT NOT NULL CHECK (status IN ('applied', 'queued', 'sent_to_mem0', 'rejected', 'failed')),
  mem0_id TEXT,
  metadata_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
```

Also add a basic migration/version table before extending this further:

```sql
CREATE TABLE IF NOT EXISTS app_schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
```

## 6. Session Finalization Triggers

Run extraction only when all of these are true:

- Session has at least one user message and one assistant message.
- Session is not streaming.
- `memory_status IS NULL OR memory_status = 'pending' OR memory_status = 'failed'`.
- `memory_processed_at IS NULL`.
- Transcript hash has not already been processed.

Trigger points:

- After `saveCurrentSession({ finalizeTitle: true })`.
- When `startNewSession()` saves the previous session.
- When `switchContext()` saves the previous context.
- On app quit, queue the session rather than blocking shutdown.
- Add a manual "Process memory now" command later for debugging.

Implementation detail:

- `saveChatSession()` should only persist the session.
- A new main-process service should process memory asynchronously after save, with a small debounce.
- Never run extraction in the renderer.

## 7. New Main-Process Modules

Add:

- `src/main/agent-memory-service.ts`
  - Public API: `queueMemoryExtraction(sessionId)`, `processPendingMemoryJobs()`, `buildMemoryContextForPrompt(params)`.
  - Owns extraction orchestration, idempotency, and run audit.
- `src/main/agent-memory-files.ts`
  - Reads/writes `USER.md`, `SOUL.md`, and `review-queue.jsonl`.
  - Applies bounded section patches, not free-form whole-file rewrites.
- `src/main/mem0-client.ts`
  - Thin REST client for self-hosted mem0.
  - Main-only. Handles base URL, API key, timeout, retries, and response normalization.
- `src/main/memory-extractor.ts`
  - Calls local Ollama or configured extraction provider.
  - Validates JSON against a local TypeScript schema before anything is stored.
- `src/shared/agent-memory-types.ts`
  - Shared types for settings, extracted items, and runtime memory context.

Settings to add:

```ts
interface AgentMemorySettings {
  enabled: boolean
  extractionEnabled: boolean
  runtimeInjectionEnabled: boolean
  mem0BaseUrl: string
  mem0ApiKey?: string
  mem0AuthMode: 'bearer' | 'x-api-key' | 'none'
  userId: string
  extractorModel: string
  extractionProvider: 'ollama'
  soulAutoApply: false
  minConfidenceToApplyUser: number
  minConfidenceToStoreInsight: number
}
```

Default:

- `enabled: false` until the user configures mem0.
- `mem0BaseUrl: http://127.0.0.1:8888`.
- `soulAutoApply: false`.
- `minConfidenceToApplyUser: 0.72`.
- `minConfidenceToStoreInsight: 0.68`.

## 8. USER.md Design

Purpose: help the assistant understand the user's stable intellectual profile.

Suggested structure:

```md
# USER

## Intellectual Profile
- ...

## Academic Orientation
- ...

## Current Research Interests
- ...

## Preferred Discussion Style
- ...

## Known Strengths
- ...

## Productive Frictions
- ...

## Avoid
- ...

## Open Questions About The User
- ...

## Evidence Log
- 2026-06-10 session:<id> ...
```

Extraction targets:

- Intellectual level:
  - What the user already treats as obvious.
  - What level of abstraction they prefer.
  - Whether they want definitions, critique, synthesis, counterarguments, historical framing, implementation details, or all of these.
- Academic temperament:
  - Fields, traditions, theorists, methods, and cross-disciplinary patterns that recur.
  - Preferred mode of reading: philological, philosophical, historical, technical, product-oriented, design-oriented, etc.
- Curiosity pattern:
  - Questions that repeatedly pull the user forward.
  - Concepts they use as bridge concepts across texts.
- Preferences:
  - Desired language, tone, density, skepticism, citation habit, implementation autonomy.
- Avoidances:
  - Explanations that are too shallow.
  - Over-deference to the user's premise.
  - Generic summaries when the user wants thesis-level insight.
  - Repeating document facts instead of building new interpretation.

Update policy:

- Apply only stable or repeated observations, or single observations that are explicit user instructions.
- Preserve uncertainty. Use "appears to" or "often" only when appropriate.
- Do not infer sensitive identity attributes.
- Do not psychologize.
- Include evidence pointers by session ID, not large transcript copies.

## 9. SOUL.md Design

Purpose: tell the assistant how to behave with this user.

Suggested structure:

```md
# SOUL

## Core Stance
- Be a rigorous discussion partner, not a passive answer engine.

## Conversational Defaults
- ...

## When Discussing Texts
- ...

## When Building Software
- ...

## Challenge Policy
- ...

## Things To Avoid
- ...

## Pending Review
- ...
```

SOUL should be treated as higher-risk memory because it changes assistant behavior globally. Recommended policy:

- Explicit user preference: queue or apply with high confidence.
- Inferred preference: queue for review, do not auto-apply.
- One-off frustration: queue, do not auto-apply.
- Durable behavior rule seen across sessions: apply only after repeated evidence.

The current user instruction says the assistant should be an autonomous, critical, multi-role partner. That belongs in SOUL as a manually approved baseline. But future inferred SOUL changes should go through review unless the user explicitly says something like "앞으로 항상 이렇게 해".

## 10. mem0 Insight Memory Design

Use mem0 for insights, not profile directives.

Store only items that meet at least one criterion:

- Cross-document bridge:
  - A connection across texts, authors, fields, or sessions.
- User-generated interpretive hypothesis:
  - A thesis that emerged in conversation, not a plain source-text fact.
- Reusable conceptual tool:
  - A distinction, analogy, framework, or reading strategy likely to help later.
- Research lead:
  - A question, unresolved tension, or promising direction worth revisiting.

Do not store:

- Basic summaries of the current document.
- Long quotes.
- Raw selected passages.
- Facts already recoverable from the source text.
- Assistant speculation with weak user uptake.
- Duplicate insight phrased slightly differently.

mem0 metadata:

```json
{
  "app": "MD_Reader",
  "type": "insight",
  "subtype": "cross_document_bridge | interpretive_hypothesis | research_lead | conceptual_tool",
  "session_id": "...",
  "context_key": "...",
  "document_kind": "markdown | epub",
  "document_title": "...",
  "chapter_label": "...",
  "source": "session_finalization",
  "confidence": 0.0,
  "created_at": 0
}
```

For mem0 add, prefer `infer: false` after MD_Reader extracts curated insight text. Letting mem0 infer again from the full transcript risks storing document facts and noisy preferences.

## 11. Extraction Prompt Design

The extractor should output strict JSON only. It should receive:

- Session metadata.
- Bounded transcript with message IDs.
- Current `USER.md`.
- Current `SOUL.md`.
- A short reminder that document facts are not memory.

System prompt draft:

```text
You are the memory curator for MD_Reader, an academic reading and discussion app.

Your job is not to summarize the document. The source document and transcript are already stored elsewhere.
Extract only durable signals that will improve future conversations with this user.

Separate four categories:
1. user_profile: stable traits, preferences, academic orientation, curiosity patterns, strengths, productive frictions, avoidances.
2. soul_directive: durable instructions about how the assistant should behave with this user.
3. insight: reusable intellectual insight created by the conversation, especially cross-document or cross-field connections.
4. reject: tempting but invalid memories, with short reasons.

Rules:
- Do not store ordinary facts from the document.
- Do not store raw quotations or long paraphrases.
- Do not infer sensitive identity attributes.
- Do not overstate. Mark uncertainty.
- Prefer fewer, higher-value memories.
- Every item must cite evidence_message_ids from the transcript.
- If evidence is weak, lower confidence or reject.
- Output valid JSON only.
```

User prompt draft:

```text
Session metadata:
{session_metadata_json}

Current USER.md:
{bounded_user_md}

Current SOUL.md:
{bounded_soul_md}

Transcript:
{message_id role content}

Return JSON matching this schema:
{
  "user_profile": [
    {
      "operation": "add | update | no_op",
      "section": "Intellectual Profile | Academic Orientation | Current Research Interests | Preferred Discussion Style | Known Strengths | Productive Frictions | Avoid",
      "content": "one concise durable bullet",
      "confidence": 0.0,
      "stability": "explicit | repeated | inferred | tentative",
      "evidence_message_ids": ["msg-..."],
      "rationale": "short"
    }
  ],
  "soul_directives": [
    {
      "operation": "add | update | queue_review | no_op",
      "section": "Core Stance | Conversational Defaults | When Discussing Texts | When Building Software | Challenge Policy | Things To Avoid",
      "content": "one concise behavioral instruction",
      "confidence": 0.0,
      "stability": "explicit | repeated | inferred | tentative",
      "evidence_message_ids": ["msg-..."],
      "rationale": "short"
    }
  ],
  "insights": [
    {
      "subtype": "cross_document_bridge | interpretive_hypothesis | research_lead | conceptual_tool",
      "content": "standalone, future-usable insight",
      "confidence": 0.0,
      "novelty": "high | medium | low",
      "reuse_scenario": "when this should be retrieved later",
      "evidence_message_ids": ["msg-..."],
      "tags": ["..."]
    }
  ],
  "rejects": [
    {
      "content": "what was rejected",
      "reason": "document_fact | too_local | low_confidence | duplicate | sensitive | raw_quote"
    }
  ]
}
```

Few-shot examples should be added before implementation. They should include:

- Rejecting a simple fact from a source text.
- Keeping a user preference explicitly stated by the user.
- Queuing a SOUL directive inferred from frustration.
- Saving a cross-text interpretive hypothesis.

## 12. USER/SOUL Patch Application

Do not ask the LLM to rewrite the whole files.

Safer algorithm:

1. Parse markdown by headings.
2. For each extracted item, map to a known heading.
3. Normalize bullet text.
4. Check near-duplicates with simple string similarity plus optional embedding later.
5. Append or update one bullet.
6. Add a compact evidence entry.

USER auto-apply:

- `confidence >= minConfidenceToApplyUser`.
- `stability` is `explicit` or `repeated`.
- Not a sensitive inference.
- Not already present.

SOUL auto-apply:

- Default: never auto-apply inferred directives.
- Auto-apply only explicit user instruction with very high confidence, or leave this disabled in phase 1.
- Otherwise append to `review-queue.jsonl` and to `SOUL.md > Pending Review`.

## 13. Runtime Prompt Injection

Modify `sendMessage()` flow so main process can build memory context before calling Ollama.

Better architecture:

- Move final prompt assembly to main process, or add a main-process IPC:
  - `agent-memory:context({ userText, contextMeta, quotedText, sessionId })`
- Renderer passes question and context metadata.
- Main reads USER/SOUL and searches mem0.
- Renderer receives a compact memory block and appends it to `fullSystemPrompt`.

Memory block format:

```text
---
Long-term memory for this user:

Behavioral instructions from SOUL.md:
- ...

User profile from USER.md:
- ...

Relevant prior insights:
- [insight:...] ...

Use these as background. Do not mention them unless they are directly relevant.
If memory conflicts with the current conversation, trust the current conversation.
---
```

Budget rules:

- SOUL: max 1,200 tokens, always included when enabled.
- USER: max 1,500 tokens, compacted to relevant sections if the file grows.
- mem0 insights: top 3 to 7, max 1,200 tokens total.
- Never inject full transcripts.
- Never inject raw source-document quotes from mem0.

mem0 search query:

```text
{current user question}

Reading context: {contextTitle}
Selected passage gist: {short quotedText summary if available}
Need: reusable prior insights, research leads, and conceptual bridges relevant to this discussion.
```

## 14. Privacy And Security

- Keep mem0 API key in main process only.
- Do not expose API key through preload.
- Bind local mem0 to `127.0.0.1`, not `0.0.0.0`, unless behind a reverse proxy.
- Prefer per-user mem0 API key over auth-disabled mode.
- Do not store raw transcripts in mem0.
- Keep provenance in metadata, but only session IDs and document labels, not full document contents.
- Add a UI toggle:
  - memory extraction enabled
  - runtime memory injection enabled
  - process current session
  - open memory folder
  - clear/rebuild memory index later

## 15. Implementation Phases

### Phase 0: Self-host mem0 locally

1. Clone `mem0ai/mem0` outside MD_Reader or add documented setup instructions.
2. Configure `server/.env`.
3. Run `cd server && make up` or `make bootstrap`.
4. Create an API key through dashboard/CLI.
5. Verify:
   - `GET http://localhost:8888/docs`
   - add one test memory
   - search it back

### Phase 1: MD_Reader memory settings and mem0 client

1. Add `AgentMemorySettings`.
2. Add main-only `mem0-client.ts`.
3. Add health check IPC that returns safe status only.
4. Add Settings UI fields for base URL, enabled toggles, and extractor model.

### Phase 2: Extraction audit schema

1. Add migration support.
2. Add `memory_status`, `memory_processed_at`, `memory_error`.
3. Add `agent_memory_runs` and `agent_memory_items`.
4. Add transcript hash idempotency.

### Phase 3: LLM extraction

1. Add `memory-extractor.ts`.
2. Use Ollama non-streaming `/api/chat`.
3. Require strict JSON.
4. Validate schema and reject malformed output.
5. Start with logging-only dry run.

### Phase 4: USER.md and SOUL.md

1. Create initial files if missing.
2. Implement heading-aware patch application.
3. Auto-apply safe USER items.
4. Queue SOUL items by default.
5. Add review queue file.

### Phase 5: mem0 insight write

1. Send curated insights to mem0 with metadata.
2. Prefer `infer: false` if self-host API supports it in the chosen endpoint.
3. Store returned memory/event IDs in `agent_memory_items`.
4. Handle mem0 outage by leaving items queued.

### Phase 6: Runtime retrieval

1. Build `buildMemoryContextForPrompt()`.
2. Include SOUL and USER summaries.
3. Search mem0 for relevant insights.
4. Inject bounded block into chat system prompt.
5. Add debug logging to show which memories were used.

### Phase 7: UX and QA

1. Settings screen for memory status and toggles.
2. Manual reprocess command for current session.
3. Open memory folder button.
4. Tests for:
   - schema migrations
   - idempotent extraction
   - USER/SOUL patching
   - mem0 client timeout/retry
   - prompt injection budget

## 16. QA Scenarios

- A session about only document content should produce zero mem0 insights.
- A session where the user explicitly says "앞으로 답할 때 내 전제를 의심해줘" should queue/apply a SOUL directive depending on policy.
- A session where the user repeatedly asks for philological comparison should add a USER academic-orientation bullet.
- A session with a new cross-text interpretation should store one mem0 insight with session provenance.
- Reprocessing the same session should not duplicate USER bullets or mem0 insights.
- mem0 server down should not break chat; it should skip retrieval and keep extraction jobs queued/failed with a visible status.
- Runtime memory should influence answers without the assistant announcing hidden memory unless relevant.

## 17. Recommended First Code Change

Start by implementing the audit schema and dry-run extraction only. Do not write USER.md, SOUL.md, or mem0 on the first pass.

Reason:

- The hardest part is extraction quality, not transport.
- Dry-run rows let us inspect what the LLM would have remembered.
- Once the extraction prompt is good, writing USER/SOUL and mem0 is straightforward.

First milestone acceptance criteria:

- Closing or switching a session creates one `agent_memory_runs` row.
- The row contains validated extracted JSON.
- Re-running the app does not reprocess the same transcript hash.
- No runtime prompt behavior changes yet.


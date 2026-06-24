import crypto from 'crypto'
import { shell } from 'electron'
import {
  getChatDb,
  loadChatSessionWithContext,
  StoredChatMessage
} from './chat-session-service'
import { getAgentMemorySettings } from './agent-memory-settings'
import { applyUserProfileItems, getAgentMemoryPaths, queueSoulDirectives, readAgentMemoryFiles } from './agent-memory-files'
import { addMem0Memory, checkMem0Health, searchMem0 } from './mem0-client'
import { extractSessionMemory, ExtractedInsight, MemoryExtractionResult } from './memory-extractor'

type MemoryRunStatus = 'processing' | 'completed' | 'skipped' | 'failed'
type MemoryItemKind = 'user_profile' | 'soul_directive' | 'insight' | 'rejected'
type MemoryItemStatus = 'applied' | 'queued' | 'sent_to_mem0' | 'rejected' | 'failed'

export interface RuntimeMemoryContextParams {
  userText: string
  contextTitle?: string | null
  quotedText?: string | null
}

export interface RuntimeMemoryContext {
  enabled: boolean
  block: string
  insightCount: number
  error?: string
}

interface FailedInsightRow {
  id: string
  session_id: string
  content: string
  metadata_json: string
}

interface PendingSessionRow {
  id: string
}

const processingSessions = new Set<string>()
let startupRoutineStarted = false

function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

function transcriptHash(messages: StoredChatMessage[]): string {
  const normalized = messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    quotedText: message.quotedText ?? null
  }))
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
}

function hasConversation(messages: StoredChatMessage[]): boolean {
  return messages.some((message) => message.role === 'user') && messages.some((message) => message.role === 'assistant')
}

function recordItem(params: {
  runId: string
  sessionId: string
  kind: MemoryItemKind
  content: string
  confidence: number
  evidenceIds: string[]
  target?: string | null
  status: MemoryItemStatus
  mem0Id?: string | null
  metadata: Record<string, unknown>
}): void {
  getChatDb().prepare(`
    INSERT INTO agent_memory_items (
      id, run_id, session_id, kind, content, confidence, evidence_message_ids,
      target, status, mem0_id, metadata_json, created_at
    )
    VALUES (
      @id, @runId, @sessionId, @kind, @content, @confidence, @evidenceIds,
      @target, @status, @mem0Id, @metadataJson, @now
    )
  `).run({
    id: createId('memitem'),
    runId: params.runId,
    sessionId: params.sessionId,
    kind: params.kind,
    content: params.content,
    confidence: params.confidence,
    evidenceIds: JSON.stringify(params.evidenceIds),
    target: params.target ?? null,
    status: params.status,
    mem0Id: params.mem0Id ?? null,
    metadataJson: JSON.stringify(params.metadata),
    now: Date.now()
  })
}

function startRun(params: {
  sessionId: string
  contextKey: string
  transcriptHash: string
  extractorModel: string | null
  messageCount: number
}): string | null {
  const database = getChatDb()
  const existing = database.prepare(`
    SELECT id, status
    FROM agent_memory_runs
    WHERE session_id = ?
      AND transcript_hash = ?
    LIMIT 1
  `).get(params.sessionId, params.transcriptHash) as { id: string; status: string } | undefined

  if (existing && existing.status === 'completed') return null

  const runId = existing?.id ?? createId('memrun')
  database.prepare(`
    INSERT INTO agent_memory_runs (
      id, session_id, context_key, status, extractor_model, transcript_hash,
      input_message_count, created_at
    )
    VALUES (
      @runId, @sessionId, @contextKey, 'processing', @extractorModel, @transcriptHash,
      @messageCount, @now
    )
    ON CONFLICT(session_id, transcript_hash) DO UPDATE SET
      status = 'processing',
      extractor_model = excluded.extractor_model,
      input_message_count = excluded.input_message_count,
      error = NULL,
      completed_at = NULL
  `).run({
    runId,
    sessionId: params.sessionId,
    contextKey: params.contextKey,
    extractorModel: params.extractorModel,
    transcriptHash: params.transcriptHash,
    messageCount: params.messageCount,
    now: Date.now()
  })
  database.prepare(`
    UPDATE chat_sessions
    SET memory_status = 'processing',
      memory_error = NULL
    WHERE id = ?
  `).run(params.sessionId)
  return runId
}

function finishRun(params: {
  runId: string
  sessionId: string
  status: MemoryRunStatus
  userPatchCount?: number
  soulPatchCount?: number
  insightCount?: number
  mem0EventIds?: string[]
  error?: string | null
}): void {
  const now = Date.now()
  getChatDb().prepare(`
    UPDATE agent_memory_runs
    SET status = @status,
      user_patch_count = @userPatchCount,
      soul_patch_count = @soulPatchCount,
      insight_count = @insightCount,
      mem0_event_ids = @mem0EventIds,
      error = @error,
      completed_at = @now
    WHERE id = @runId
  `).run({
    runId: params.runId,
    status: params.status,
    userPatchCount: params.userPatchCount ?? 0,
    soulPatchCount: params.soulPatchCount ?? 0,
    insightCount: params.insightCount ?? 0,
    mem0EventIds: params.mem0EventIds ? JSON.stringify(params.mem0EventIds) : null,
    error: params.error ?? null,
    now
  })
  getChatDb().prepare(`
    UPDATE chat_sessions
    SET memory_status = @status,
      memory_processed_at = CASE WHEN @status IN ('completed', 'skipped') THEN @now ELSE memory_processed_at END,
      memory_error = @error
    WHERE id = @sessionId
  `).run({
    sessionId: params.sessionId,
    status: params.status,
    error: params.error ?? null,
    now
  })
}

async function storeInsight(runId: string, sessionId: string, insight: ExtractedInsight, extraction: {
  contextKey: string
  documentKind: string
  contextTitle: string
  chapterLabel: string | null
}): Promise<{ status: MemoryItemStatus; mem0Id?: string; eventId?: string }> {
  const settings = getAgentMemorySettings()
  const metadata = {
    app: 'MD_Reader',
    type: 'insight',
    subtype: insight.subtype,
    session_id: sessionId,
    context_key: extraction.contextKey,
    document_kind: extraction.documentKind,
    document_title: extraction.contextTitle,
    chapter_label: extraction.chapterLabel,
    source: 'session_finalization',
    confidence: insight.confidence,
    novelty: insight.novelty,
    reuse_scenario: insight.reuse_scenario,
    tags: insight.tags,
    created_at: Date.now()
  }

  try {
    const result = await addMem0Memory(settings, { content: insight.content, metadata })
    recordItem({
      runId,
      sessionId,
      kind: 'insight',
      content: insight.content,
      confidence: insight.confidence,
      evidenceIds: insight.evidence_message_ids,
      target: insight.subtype,
      status: 'sent_to_mem0',
      mem0Id: result.memoryId,
      metadata
    })
    return { status: 'sent_to_mem0', mem0Id: result.memoryId, eventId: result.eventId }
  } catch (error) {
    recordItem({
      runId,
      sessionId,
      kind: 'insight',
      content: insight.content,
      confidence: insight.confidence,
      evidenceIds: insight.evidence_message_ids,
      target: insight.subtype,
      status: 'failed',
      metadata: {
        ...metadata,
        error: error instanceof Error ? error.message : 'Unknown mem0 error'
      }
    })
    return { status: 'failed' }
  }
}

function recordExtractionItems(runId: string, sessionId: string, extraction: MemoryExtractionResult): void {
  for (const item of extraction.user_profile) {
    recordItem({
      runId,
      sessionId,
      kind: 'user_profile',
      content: item.content,
      confidence: item.confidence,
      evidenceIds: item.evidence_message_ids,
      target: item.section,
      status: item.operation === 'no_op' ? 'rejected' : 'applied',
      metadata: { stability: item.stability, rationale: item.rationale, operation: item.operation }
    })
  }

  for (const item of extraction.soul_directives) {
    recordItem({
      runId,
      sessionId,
      kind: 'soul_directive',
      content: item.content,
      confidence: item.confidence,
      evidenceIds: item.evidence_message_ids,
      target: item.section,
      status: 'queued',
      metadata: { stability: item.stability, rationale: item.rationale, operation: item.operation }
    })
  }

  for (const item of extraction.rejects) {
    recordItem({
      runId,
      sessionId,
      kind: 'rejected',
      content: item.content,
      confidence: 0,
      evidenceIds: [],
      target: item.reason,
      status: 'rejected',
      metadata: { reason: item.reason }
    })
  }
}

function parseMetadataJson(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

async function retryFailedMem0Insights(limit = 100): Promise<{ attempted: number; succeeded: number; failed: number }> {
  const settings = getAgentMemorySettings()
  const rows = getChatDb().prepare(`
    SELECT id, session_id, content, metadata_json
    FROM agent_memory_items
    WHERE kind = 'insight'
      AND status = 'failed'
    ORDER BY created_at ASC
    LIMIT ?
  `).all(limit) as FailedInsightRow[]

  let succeeded = 0
  let failed = 0

  for (const row of rows) {
    const metadata = parseMetadataJson(row.metadata_json)
    delete metadata.error

    try {
      const result = await addMem0Memory(settings, { content: row.content, metadata })
      getChatDb().prepare(`
        UPDATE agent_memory_items
        SET status = 'sent_to_mem0',
          mem0_id = @mem0Id,
          metadata_json = @metadataJson
        WHERE id = @id
      `).run({
        id: row.id,
        mem0Id: result.memoryId ?? null,
        metadataJson: JSON.stringify(metadata)
      })
      succeeded += 1
    } catch (error) {
      failed += 1
      getChatDb().prepare(`
        UPDATE agent_memory_items
        SET metadata_json = @metadataJson
        WHERE id = @id
      `).run({
        id: row.id,
        metadataJson: JSON.stringify({
          ...metadata,
          error: error instanceof Error ? error.message : 'Unknown mem0 error'
        })
      })
    }
  }

  return { attempted: rows.length, succeeded, failed }
}

export async function processPendingMemoryJobs(limit = 20): Promise<{ attempted: number }> {
  const settings = getAgentMemorySettings()
  if (!settings.enabled || !settings.extractionEnabled) return { attempted: 0 }

  const rows = getChatDb().prepare(`
    SELECT id
    FROM chat_sessions
    WHERE archived_at IS NULL
      AND message_count > 0
      AND (
        memory_status IS NULL
        OR memory_status = 'pending'
        OR memory_status = 'failed'
      )
    ORDER BY updated_at ASC
    LIMIT ?
  `).all(limit) as PendingSessionRow[]

  let attempted = 0
  for (const row of rows) {
    if (processingSessions.has(row.id)) continue
    attempted += 1
    await processSessionMemory(row.id)
  }

  return { attempted }
}

export async function initializeAgentMemoryStartupRoutine(): Promise<void> {
  if (startupRoutineStarted) return
  startupRoutineStarted = true

  const settings = getAgentMemorySettings()
  if (!settings.enabled) {
    console.info('[AgentMemory] Startup routine skipped: memory is disabled.')
    return
  }

  try {
    await readAgentMemoryFiles()
  } catch (error) {
    console.warn('[AgentMemory] Failed to initialize memory files:', error)
  }

  const health = await checkMem0Health(settings)
  if (!health.ok) {
    console.warn(`[AgentMemory] mem0 startup check failed: ${health.error || 'mem0 is not reachable'}`)
    return
  }

  console.info('[AgentMemory] mem0 startup check succeeded.')

  try {
    const pending = await processPendingMemoryJobs()
    const retried = await retryFailedMem0Insights()
    console.info(
      `[AgentMemory] Startup routine complete: processed ${pending.attempted} pending session(s), ` +
      `retried ${retried.attempted} failed mem0 insight(s), ` +
      `${retried.succeeded} succeeded, ${retried.failed} failed.`
    )
  } catch (error) {
    console.error('[AgentMemory] Startup routine failed:', error)
  }
}

export function queueMemoryExtraction(sessionId: string | null | undefined): void {
  if (!sessionId || processingSessions.has(sessionId)) return
  const settings = getAgentMemorySettings()
  if (!settings.enabled || !settings.extractionEnabled) return

  processingSessions.add(sessionId)
  setTimeout(() => {
    processSessionMemory(sessionId).catch((error) => {
      console.error('[AgentMemory] Extraction failed:', error)
    }).finally(() => {
      processingSessions.delete(sessionId)
    })
  }, 150)
}

export async function processSessionMemory(sessionId: string): Promise<void> {
  const settings = getAgentMemorySettings()
  if (!settings.enabled || !settings.extractionEnabled) return

  const data = loadChatSessionWithContext(sessionId)
  if (!data) return

  const hash = transcriptHash(data.messages)
  const model = settings.extractorModel || data.session.model || ''
  const runId = startRun({
    sessionId,
    contextKey: data.session.contextKey,
    transcriptHash: hash,
    extractorModel: model || null,
    messageCount: data.messages.length
  })

  if (!runId) return

  if (!hasConversation(data.messages)) {
    finishRun({ runId, sessionId, status: 'skipped' })
    return
  }

  if (!model) {
    finishRun({ runId, sessionId, status: 'failed', error: 'No extractor model configured or saved on session.' })
    return
  }

  try {
    const files = await readAgentMemoryFiles()
    const extraction = await extractSessionMemory({
      model,
      context: data.context,
      messages: data.messages,
      userMarkdown: files.user,
      soulMarkdown: files.soul
    })

    const eligibleUserItems = extraction.user_profile.filter((item) =>
      item.operation !== 'no_op'
      && item.confidence >= settings.minConfidenceToApplyUser
      && (item.stability === 'explicit' || item.stability === 'repeated')
    )
    const soulItems = extraction.soul_directives.filter((item) => item.operation !== 'no_op')
    const eligibleInsights = extraction.insights.filter((item) =>
      item.confidence >= settings.minConfidenceToStoreInsight && item.novelty !== 'low'
    )

    const [userPatchCount, soulPatchCount] = await Promise.all([
      applyUserProfileItems(eligibleUserItems),
      queueSoulDirectives(soulItems)
    ])
    recordExtractionItems(runId, sessionId, {
      ...extraction,
      user_profile: eligibleUserItems,
      soul_directives: soulItems,
      insights: []
    })

    const mem0EventIds: string[] = []
    for (const insight of eligibleInsights) {
      const stored = await storeInsight(runId, sessionId, insight, {
        contextKey: data.session.contextKey,
        documentKind: data.context.document_kind,
        contextTitle: data.context.context_title,
        chapterLabel: data.context.chapter_label
      })
      if (stored.eventId) mem0EventIds.push(stored.eventId)
    }

    finishRun({
      runId,
      sessionId,
      status: 'completed',
      userPatchCount,
      soulPatchCount,
      insightCount: eligibleInsights.length,
      mem0EventIds
    })
  } catch (error) {
    finishRun({
      runId,
      sessionId,
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown memory extraction error'
    })
  }
}

function compactLines(markdown: string, maxLines: number): string[] {
  return markdown
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .slice(0, maxLines)
}

export async function buildMemoryContextForPrompt(params: RuntimeMemoryContextParams): Promise<RuntimeMemoryContext> {
  const settings = getAgentMemorySettings()
  if (!settings.enabled || !settings.runtimeInjectionEnabled) {
    return { enabled: false, block: '', insightCount: 0 }
  }

  try {
    const [files, health] = await Promise.all([
      readAgentMemoryFiles(),
      checkMem0Health(settings)
    ])
    const userLines = compactLines(files.user, 18)
    const soulLines = compactLines(files.soul, 14)
    const query = [
      params.userText,
      params.contextTitle ? `Reading context: ${params.contextTitle}` : '',
      params.quotedText ? `Selected passage gist: ${params.quotedText.slice(0, 700)}` : '',
      'Need: reusable prior insights, research leads, and conceptual bridges relevant to this discussion.'
    ].filter(Boolean).join('\n\n')

    let insights: string[] = []
    let error: string | undefined
    if (health.ok) {
      try {
        const results = await searchMem0(settings, query, 5)
        insights = results.map((item) => `- ${item.memory}`).slice(0, 5)
      } catch (searchError) {
        error = searchError instanceof Error ? searchError.message : 'Unknown mem0 search error'
      }
    } else {
      error = health.error || 'mem0 is not reachable'
    }

    const sections = [
      soulLines.length ? `Behavioral instructions from SOUL.md:\n${soulLines.join('\n')}` : '',
      userLines.length ? `User profile from USER.md:\n${userLines.join('\n')}` : '',
      insights.length ? `Relevant prior insights:\n${insights.join('\n')}` : ''
    ].filter(Boolean)

    if (sections.length === 0) return { enabled: true, block: '', insightCount: 0, error }

    return {
      enabled: true,
      insightCount: insights.length,
      error,
      block: `---\nLong-term memory for this user:\n\n${sections.join('\n\n')}\n\nUse these as background. Do not mention them unless directly relevant. If memory conflicts with the current conversation, trust the current conversation.\n---`
    }
  } catch (error) {
    return {
      enabled: true,
      block: '',
      insightCount: 0,
      error: error instanceof Error ? error.message : 'Unknown memory context error'
    }
  }
}

export async function getAgentMemoryStatus(): Promise<{
  settings: {
    enabled: boolean
    extractionEnabled: boolean
    runtimeInjectionEnabled: boolean
    mem0BaseUrl: string
    mem0AuthMode: string
    userId: string
    extractorModel: string
    soulAutoApply: boolean
    minConfidenceToApplyUser: number
    minConfidenceToStoreInsight: number
    hasMem0ApiKey: boolean
  }
  paths: ReturnType<typeof getAgentMemoryPaths>
  mem0: { ok: boolean; error?: string }
}> {
  const settings = getAgentMemorySettings()
  return {
    settings: {
      enabled: settings.enabled,
      extractionEnabled: settings.extractionEnabled,
      runtimeInjectionEnabled: settings.runtimeInjectionEnabled,
      mem0BaseUrl: settings.mem0BaseUrl,
      mem0AuthMode: settings.mem0AuthMode,
      userId: settings.userId,
      extractorModel: settings.extractorModel,
      soulAutoApply: settings.soulAutoApply,
      minConfidenceToApplyUser: settings.minConfidenceToApplyUser,
      minConfidenceToStoreInsight: settings.minConfidenceToStoreInsight,
      hasMem0ApiKey: Boolean(settings.mem0ApiKey)
    },
    paths: getAgentMemoryPaths(),
    mem0: await checkMem0Health(settings)
  }
}

export async function openAgentMemoryFolder(): Promise<{ success: boolean; error?: string }> {
  await readAgentMemoryFiles()
  const paths = getAgentMemoryPaths()
  const result = await shell.openPath(paths.dir)
  return result ? { success: false, error: result } : { success: true }
}

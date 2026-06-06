import { app } from 'electron'
import path from 'path'
import crypto from 'crypto'
import Database from 'better-sqlite3'

export type ChatDocumentKind = 'markdown' | 'epub'
export type ChatMessageRole = 'user' | 'assistant'
export type SessionTitleStatus = 'pending' | 'generated' | 'fallback'

export interface ChatContextMeta {
  documentKind: ChatDocumentKind
  documentId: string
  fileName: string
  lastFilePath?: string | null
  contextTitle: string
  chapterHref?: string | null
  chapterLabel?: string | null
  lastCfi?: string | null
  contentHash?: string | null
}

export interface StoredChatMessage {
  id: string
  role: ChatMessageRole
  content: string
  timestamp: number
  quotedText?: string | null
}

export interface ChatSessionSummary {
  id: string
  contextKey: string
  title: string
  titleStatus: SessionTitleStatus
  messageCount: number
  createdAt: number
  updatedAt: number
  model?: string | null
}

export interface ChatSessionRecord extends ChatSessionSummary {
  systemPrompt?: string | null
}

export interface SaveChatSessionParams {
  sessionId?: string | null
  contextMeta: ChatContextMeta
  title?: string | null
  titleStatus?: SessionTitleStatus
  model?: string | null
  systemPrompt?: string | null
  messages: StoredChatMessage[]
}

interface ContextRow {
  context_key: string
  document_kind: ChatDocumentKind
  document_id: string
  file_name: string
  last_file_path: string | null
  context_title: string
  chapter_href: string | null
  chapter_label: string | null
  last_cfi: string | null
  content_hash: string | null
  created_at: number
  updated_at: number
  last_opened_at: number
}

interface SessionRow {
  id: string
  context_key: string
  title: string
  title_status: SessionTitleStatus
  model: string | null
  system_prompt: string | null
  message_count: number
  created_at: number
  updated_at: number
}

interface MessageRow {
  id: string
  role: ChatMessageRole
  content: string
  quoted_text: string | null
  created_at: number
  ordinal: number
}

let db: Database.Database | null = null

function getDb(): Database.Database {
  if (db) return db

  const dbPath = path.join(app.getPath('userData'), 'chat-sessions.sqlite')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_contexts (
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

    CREATE TABLE IF NOT EXISTS chat_document_aliases (
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

    CREATE TABLE IF NOT EXISTS chat_sessions (
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

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      quoted_text TEXT,
      created_at INTEGER NOT NULL,
      ordinal INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_chat_sessions_context_updated
      ON chat_sessions(context_key, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_chat_contexts_document
      ON chat_contexts(document_kind, document_id);
    CREATE INDEX IF NOT EXISTS idx_chat_contexts_name
      ON chat_contexts(document_kind, file_name);
    CREATE INDEX IF NOT EXISTS idx_chat_document_aliases_doc
      ON chat_document_aliases(document_kind, document_id, file_name);
    CREATE INDEX IF NOT EXISTS idx_chat_document_aliases_name
      ON chat_document_aliases(document_kind, file_name);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session_ordinal
      ON chat_messages(session_id, ordinal ASC);
  `)
  return db
}

function normalizeChapterHref(href?: string | null): string | null {
  const value = href?.trim()
  if (!value) return null
  return value.split('#')[0] || value
}

function stableId(prefix: string, input: string): string {
  return `${prefix}-${crypto.createHash('sha1').update(input).digest('hex')}`
}

function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

function buildContextKey(meta: ChatContextMeta): string {
  const documentId = encodeURIComponent(meta.documentId || `name:${meta.fileName}`)
  if (meta.documentKind === 'markdown') return `md:${documentId}`
  const chapter = encodeURIComponent(normalizeChapterHref(meta.chapterHref) || meta.chapterLabel || 'unknown')
  return `epub:${documentId}#${chapter}`
}

function fallbackTitle(messages: StoredChatMessage[], contextTitle: string): string {
  const firstQuestion = messages.find((message) => message.role === 'user')?.content.trim()
  if (firstQuestion) {
    return firstQuestion.length > 48 ? `${firstQuestion.slice(0, 48)}...` : firstQuestion
  }
  return `${contextTitle || 'Reading'} session`
}

function mapSession(row: SessionRow): ChatSessionSummary {
  return {
    id: row.id,
    contextKey: row.context_key,
    title: row.title,
    titleStatus: row.title_status,
    messageCount: row.message_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    model: row.model
  }
}

function findAliasContext(database: Database.Database, meta: ChatContextMeta): string | null {
  const alias = database.prepare(`
    SELECT context_key
    FROM chat_document_aliases
    WHERE document_kind = @documentKind
      AND document_id = @documentId
      AND file_name = @fileName
    ORDER BY updated_at DESC
    LIMIT 1
  `).get({
    documentKind: meta.documentKind,
    documentId: meta.documentId,
    fileName: meta.fileName
  }) as { context_key: string } | undefined

  if (alias?.context_key) return alias.context_key

  const chapterHref = normalizeChapterHref(meta.chapterHref)
  const rows = database.prepare(`
    SELECT context_key
    FROM chat_contexts
    WHERE document_kind = @documentKind
      AND file_name = @fileName
      AND (
        (@documentKind = 'markdown')
        OR (
          @documentKind = 'epub'
          AND COALESCE(chapter_href, '') = COALESCE(@chapterHref, '')
        )
      )
    ORDER BY updated_at DESC
    LIMIT 2
  `).all({
    documentKind: meta.documentKind,
    fileName: meta.fileName,
    chapterHref
  }) as Array<{ context_key: string }>

  return rows.length === 1 ? rows[0].context_key : null
}

function upsertAlias(database: Database.Database, contextKey: string, meta: ChatContextMeta, confidence: 'fingerprint' | 'filename'): void {
  const now = Date.now()
  const id = stableId(
    'alias',
    `${meta.documentKind}:${meta.documentId}:${meta.fileName}:${contextKey}`
  )
  database.prepare(`
    INSERT INTO chat_document_aliases (
      id, context_key, document_kind, document_id, file_name, file_path,
      confidence, created_at, updated_at
    )
    VALUES (
      @id, @contextKey, @documentKind, @documentId, @fileName, @filePath,
      @confidence, @now, @now
    )
    ON CONFLICT(id) DO UPDATE SET
      file_path = excluded.file_path,
      confidence = excluded.confidence,
      updated_at = excluded.updated_at
  `).run({
    id,
    contextKey,
    documentKind: meta.documentKind,
    documentId: meta.documentId,
    fileName: meta.fileName,
    filePath: meta.lastFilePath ?? null,
    confidence,
    now
  })
}

export function resolveChatContext(meta: ChatContextMeta): ContextRow {
  const database = getDb()
  const now = Date.now()
  const chapterHref = normalizeChapterHref(meta.chapterHref)
  const proposedKey = buildContextKey({ ...meta, chapterHref })
  const exact = database.prepare('SELECT * FROM chat_contexts WHERE context_key = ?').get(proposedKey) as ContextRow | undefined
  const contextKey = exact?.context_key ?? findAliasContext(database, { ...meta, chapterHref }) ?? proposedKey
  const existing = exact ?? database.prepare('SELECT * FROM chat_contexts WHERE context_key = ?').get(contextKey) as ContextRow | undefined
  const createdAt = existing?.created_at ?? now

  database.prepare(`
    INSERT INTO chat_contexts (
      context_key, document_kind, document_id, file_name, last_file_path,
      context_title, chapter_href, chapter_label, last_cfi, content_hash,
      created_at, updated_at, last_opened_at
    )
    VALUES (
      @contextKey, @documentKind, @documentId, @fileName, @lastFilePath,
      @contextTitle, @chapterHref, @chapterLabel, @lastCfi, @contentHash,
      @createdAt, @now, @now
    )
    ON CONFLICT(context_key) DO UPDATE SET
      document_id = excluded.document_id,
      file_name = excluded.file_name,
      last_file_path = excluded.last_file_path,
      context_title = excluded.context_title,
      chapter_href = excluded.chapter_href,
      chapter_label = excluded.chapter_label,
      last_cfi = excluded.last_cfi,
      content_hash = excluded.content_hash,
      updated_at = excluded.updated_at,
      last_opened_at = excluded.last_opened_at
  `).run({
    contextKey,
    documentKind: meta.documentKind,
    documentId: meta.documentId,
    fileName: meta.fileName,
    lastFilePath: meta.lastFilePath ?? null,
    contextTitle: meta.contextTitle || meta.fileName,
    chapterHref,
    chapterLabel: meta.chapterLabel ?? null,
    lastCfi: meta.lastCfi ?? null,
    contentHash: meta.contentHash ?? null,
    createdAt,
    now
  })

  upsertAlias(database, contextKey, meta, existing ? 'filename' : 'fingerprint')

  return database.prepare('SELECT * FROM chat_contexts WHERE context_key = ?').get(contextKey) as ContextRow
}

export function listChatSessions(meta: ChatContextMeta): { contextKey: string; sessions: ChatSessionSummary[] } {
  const context = resolveChatContext(meta)
  const rows = getDb().prepare(`
    SELECT id, context_key, title, title_status, model, system_prompt, message_count, created_at, updated_at
    FROM chat_sessions
    WHERE context_key = ?
      AND archived_at IS NULL
    ORDER BY updated_at DESC
  `).all(context.context_key) as SessionRow[]

  return {
    contextKey: context.context_key,
    sessions: rows.map(mapSession)
  }
}

export function saveChatSession(params: SaveChatSessionParams): { sessionId: string; contextKey: string; title: string } {
  const database = getDb()
  const save = database.transaction(() => {
    const context = resolveChatContext(params.contextMeta)
    const now = Date.now()
    const sessionId = params.sessionId || createId('session')
    const existing = database.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(sessionId) as SessionRow | undefined
    const title = params.title?.trim() || existing?.title || fallbackTitle(params.messages, params.contextMeta.contextTitle)
    const titleStatus = params.titleStatus ?? existing?.title_status ?? 'fallback'
    const createdAt = existing?.created_at ?? now

    database.prepare(`
      INSERT INTO chat_sessions (
        id, context_key, title, title_status, model, system_prompt,
        message_count, created_at, updated_at, archived_at
      )
      VALUES (
        @sessionId, @contextKey, @title, @titleStatus, @model, @systemPrompt,
        @messageCount, @createdAt, @now, NULL
      )
      ON CONFLICT(id) DO UPDATE SET
        context_key = excluded.context_key,
        title = excluded.title,
        title_status = excluded.title_status,
        model = excluded.model,
        system_prompt = excluded.system_prompt,
        message_count = excluded.message_count,
        updated_at = excluded.updated_at,
        archived_at = NULL
    `).run({
      sessionId,
      contextKey: context.context_key,
      title,
      titleStatus,
      model: params.model ?? null,
      systemPrompt: params.systemPrompt ?? null,
      messageCount: params.messages.length,
      createdAt,
      now
    })

    database.prepare('DELETE FROM chat_messages WHERE session_id = ?').run(sessionId)
    const insertMessage = database.prepare(`
      INSERT INTO chat_messages (
        id, session_id, role, content, quoted_text, created_at, ordinal
      )
      VALUES (
        @id, @sessionId, @role, @content, @quotedText, @createdAt, @ordinal
      )
    `)

    params.messages.forEach((message, index) => {
      insertMessage.run({
        id: message.id || createId('msg'),
        sessionId,
        role: message.role,
        content: message.content,
        quotedText: message.quotedText ?? null,
        createdAt: message.timestamp || now,
        ordinal: index
      })
    })

    return { sessionId, contextKey: context.context_key, title }
  })

  return save()
}

export function loadChatSession(sessionId: string): { session: ChatSessionRecord; messages: StoredChatMessage[] } | null {
  const database = getDb()
  const sessionRow = database.prepare(`
    SELECT id, context_key, title, title_status, model, system_prompt, message_count, created_at, updated_at
    FROM chat_sessions
    WHERE id = ?
      AND archived_at IS NULL
  `).get(sessionId) as SessionRow | undefined

  if (!sessionRow) return null

  const messageRows = database.prepare(`
    SELECT id, role, content, quoted_text, created_at, ordinal
    FROM chat_messages
    WHERE session_id = ?
    ORDER BY ordinal ASC
  `).all(sessionId) as MessageRow[]

  return {
    session: {
      ...mapSession(sessionRow),
      systemPrompt: sessionRow.system_prompt
    },
    messages: messageRows.map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      timestamp: row.created_at,
      quotedText: row.quoted_text
    }))
  }
}

export function archiveChatSession(sessionId: string): { success: boolean } {
  getDb().prepare('UPDATE chat_sessions SET archived_at = ?, updated_at = ? WHERE id = ?').run(Date.now(), Date.now(), sessionId)
  return { success: true }
}

export function closeChatSessionDb(): void {
  if (!db) return
  db.close()
  db = null
}

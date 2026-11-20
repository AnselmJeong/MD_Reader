import { app } from 'electron'
import path from 'node:path'
import Database from 'better-sqlite3'
import {
  coachTermKey, DEFAULT_COACH_SETTINGS, EMPTY_COACH_PROFILE, sanitizePreferences,
  type CoachDeck, type CoachEncounter, type CoachReviewItem, type CoachEvent, type CoachPreferences, type CoachProfile, type CoachSettings, type CoachUsage
} from '../shared/coach'

// Everything the coach learns stays in this file on the device.
let db: Database.Database | null = null
function database() {
  if (db) return db
  db = new Database(path.join(app.getPath('userData'), 'coach.sqlite'))
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS coach_decks (key TEXT PRIMARY KEY, document_id TEXT NOT NULL, chapter_href TEXT NOT NULL, part INTEGER NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_coach_decks_document ON coach_decks(document_id, chapter_href);
    CREATE TABLE IF NOT EXISTS coach_preferences (document_id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS coach_events (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id TEXT NOT NULL, chapter_href TEXT NOT NULL, type TEXT NOT NULL, card_id TEXT, payload TEXT NOT NULL, at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS coach_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS coach_images (query_key TEXT PRIMARY KEY, status TEXT NOT NULL, png BLOB, page_title TEXT, page_url TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS coach_usage (date TEXT PRIMARY KEY, calls INTEGER NOT NULL DEFAULT 0, cache_hits INTEGER NOT NULL DEFAULT 0, failures INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS coach_terms (term_key TEXT NOT NULL, document_id TEXT NOT NULL, card_id TEXT NOT NULL, book_title TEXT NOT NULL, chapter_label TEXT NOT NULL, title TEXT NOT NULL, gloss TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (term_key, document_id));
    CREATE INDEX IF NOT EXISTS idx_coach_events_card ON coach_events(card_id, type);
    CREATE TABLE IF NOT EXISTS coach_reviews (id TEXT PRIMARY KEY, document_id TEXT NOT NULL, book_title TEXT NOT NULL, chapter_href TEXT NOT NULL, chapter_label TEXT NOT NULL, question TEXT NOT NULL, recap TEXT NOT NULL, due_at INTEGER NOT NULL, interval_days INTEGER NOT NULL, reps INTEGER NOT NULL, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_coach_reviews_due ON coach_reviews(due_at);
  `)
  // v0.10.1: caption source for pictures (Wikipedia or a Brave result's site).
  const imageColumns = db.prepare('PRAGMA table_info(coach_images)').all() as Array<{ name: string }>
  if (!imageColumns.some(column => column.name === 'source')) db.exec('ALTER TABLE coach_images ADD COLUMN source TEXT')
  // v0.10.5: decks that came inside an EPUB from another MD Reader.
  const deckColumns = db.prepare('PRAGMA table_info(coach_decks)').all() as Array<{ name: string }>
  if (!deckColumns.some(column => column.name === 'imported')) db.exec('ALTER TABLE coach_decks ADD COLUMN imported INTEGER NOT NULL DEFAULT 0')
  return db
}

function getKv<T>(key: string, fallback: T): T {
  const row = database().prepare('SELECT value FROM coach_kv WHERE key = ?').get(key) as { value: string } | undefined
  if (!row) return fallback
  try { return JSON.parse(row.value) as T } catch { return fallback }
}
function setKv(key: string, value: unknown) {
  database().prepare('INSERT INTO coach_kv VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value))
}

export function readDeck(key: string): CoachDeck | null {
  const row = database().prepare('SELECT payload FROM coach_decks WHERE key = ?').get(key) as { payload: string } | undefined
  return row ? JSON.parse(row.payload) as CoachDeck : null
}
export function writeDeck(deck: CoachDeck) {
  database().prepare(`INSERT INTO coach_decks (key, document_id, chapter_href, part, payload, created_at, imported) VALUES (@key, @documentId, @chapterHref, @part, @payload, @createdAt, 0)
    ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, created_at = excluded.created_at, imported = 0`)
    .run({ key: deck.key, documentId: deck.documentId, chapterHref: deck.chapterHref, part: deck.part, payload: JSON.stringify(deck), createdAt: deck.createdAt })
}

/** Every deck of one book, for export. */
export function readDocumentDecks(documentId: string): CoachDeck[] {
  return (database().prepare('SELECT payload FROM coach_decks WHERE document_id = ? ORDER BY created_at').all(documentId) as Array<{ payload: string }>)
    .map(row => JSON.parse(row.payload) as CoachDeck)
}

/** A deck from a file never replaces one made on this device. Returns true when it was added. */
export function insertImportedDeck(deck: CoachDeck): boolean {
  return database().prepare(`INSERT INTO coach_decks (key, document_id, chapter_href, part, payload, created_at, imported) VALUES (@key, @documentId, @chapterHref, @part, @payload, @createdAt, 1)
    ON CONFLICT(key) DO NOTHING`)
    .run({ key: deck.key, documentId: deck.documentId, chapterHref: deck.chapterHref, part: deck.part, payload: JSON.stringify(deck), createdAt: deck.createdAt }).changes > 0
}

/** The imported deck for a chapter part, used when this reader's own cache key differs (another request text). */
export function readImportedDeck(documentId: string, chapterHref: string, part: number): CoachDeck | null {
  const row = database().prepare('SELECT payload FROM coach_decks WHERE document_id = ? AND chapter_href = ? AND part = ? AND imported = 1 ORDER BY created_at DESC LIMIT 1')
    .get(documentId, chapterHref.split('#')[0], part) as { payload: string } | undefined
  return row ? JSON.parse(row.payload) as CoachDeck : null
}

export function readPreferences(documentId: string): CoachPreferences | null {
  const row = database().prepare('SELECT payload FROM coach_preferences WHERE document_id = ?').get(documentId) as { payload: string } | undefined
  return row ? sanitizePreferences(JSON.parse(row.payload)) : null
}
export function writePreferences(documentId: string, preferences: CoachPreferences): CoachPreferences {
  const clean = sanitizePreferences({ ...preferences, updatedAt: Date.now() })
  database().prepare('INSERT INTO coach_preferences VALUES (?, ?, ?) ON CONFLICT(document_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at')
    .run(documentId, JSON.stringify(clean), clean.updatedAt)
  // A skipped book should not become the template for the next one.
  if (clean.enabled) setKv('lastPreferences', clean)
  return clean
}
export function readLastPreferences(): CoachPreferences | null {
  const value = getKv<CoachPreferences | null>('lastPreferences', null)
  return value ? sanitizePreferences(value) : null
}

export function readSettings(): CoachSettings {
  return { ...DEFAULT_COACH_SETTINGS, ...getKv<Partial<CoachSettings>>('settings', {}) }
}
export function writeSettings(partial: Partial<CoachSettings>): CoachSettings {
  const current = readSettings()
  const next: CoachSettings = {
    askOnOpen: typeof partial.askOnOpen === 'boolean' ? partial.askOnOpen : current.askOnOpen,
    dailyLimit: Number.isFinite(partial.dailyLimit) ? Math.min(200, Math.max(0, Math.round(partial.dailyLimit!))) : current.dailyLimit,
    quotaPausePercent: Number.isFinite(partial.quotaPausePercent) ? Math.min(100, Math.max(10, Math.round(partial.quotaPausePercent!))) : current.quotaPausePercent,
    coachModel: typeof partial.coachModel === 'string' && (partial.coachModel === 'auto' || /^(codex|claude):.+$/.test(partial.coachModel)) ? partial.coachModel : current.coachModel
  }
  setKv('settings', next)
  return next
}

export function readProfile(): CoachProfile {
  return getKv<CoachProfile>('profile', EMPTY_COACH_PROFILE)
}
export function writeProfile(profile: CoachProfile) { setKv('profile', profile) }

export function appendEvent(event: CoachEvent) {
  database().prepare('INSERT INTO coach_events (document_id, chapter_href, type, card_id, payload, at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(event.documentId, event.chapterHref, event.type, event.cardId ?? null, JSON.stringify(event), event.at)
}

export const today = () => new Date().toLocaleDateString('sv-SE')
export function readUsage(): CoachUsage {
  const date = today()
  const row = database().prepare('SELECT calls, cache_hits, failures FROM coach_usage WHERE date = ?').get(date) as { calls: number; cache_hits: number; failures: number } | undefined
  return { date, calls: row?.calls ?? 0, cacheHits: row?.cache_hits ?? 0, failures: row?.failures ?? 0 }
}
export function countUsage(field: 'calls' | 'cache_hits' | 'failures') {
  database().prepare(`INSERT INTO coach_usage (date, ${field}) VALUES (?, 1) ON CONFLICT(date) DO UPDATE SET ${field} = ${field} + 1`).run(today())
}

/** Chapters that started a deck today: the daily limit counts chapters, not the calls for their parts. */
export function readPreparedChapters(): string[] {
  const stored = getKv<{ date?: string; chapters?: string[] }>('coach-prepared-chapters', {})
  return stored.date === today() && Array.isArray(stored.chapters) ? stored.chapters : []
}
export function markChapterPrepared(chapter: string) {
  const chapters = readPreparedChapters()
  if (!chapters.includes(chapter)) setKv('coach-prepared-chapters', { date: today(), chapters: [...chapters, chapter] })
}

export interface StoredImage { status: 'ready' | 'none'; png: Buffer | null; pageTitle: string | null; pageUrl: string | null; source: string | null; createdAt: number }
export function readImage(queryKey: string): StoredImage | null {
  const row = database().prepare('SELECT status, png, page_title, page_url, source, created_at FROM coach_images WHERE query_key = ?').get(queryKey) as
    { status: 'ready' | 'none'; png: Buffer | null; page_title: string | null; page_url: string | null; source: string | null; created_at: number } | undefined
  return row ? { status: row.status, png: row.png, pageTitle: row.page_title, pageUrl: row.page_url, source: row.source, createdAt: row.created_at } : null
}
export function readReadyImages(queryKeys: string[]): Map<string, StoredImage> {
  const query = database().prepare("SELECT status, png, page_title, page_url, source, created_at FROM coach_images WHERE query_key = ? AND status = 'ready' AND png IS NOT NULL")
  const result = new Map<string, StoredImage>()
  for (const key of new Set(queryKeys)) {
    const row = query.get(key) as { status: 'ready'; png: Buffer; page_title: string | null; page_url: string | null; source: string | null; created_at: number } | undefined
    if (row) result.set(key, { status: row.status, png: row.png, pageTitle: row.page_title, pageUrl: row.page_url, source: row.source, createdAt: row.created_at })
  }
  return result
}

export function writeImage(queryKey: string, image: StoredImage) {
  database().prepare(`INSERT INTO coach_images (query_key, status, png, page_title, page_url, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(query_key) DO UPDATE SET
    status = excluded.status, png = excluded.png, page_title = excluded.page_title, page_url = excluded.page_url, source = excluded.source, created_at = excluded.created_at`)
    .run(queryKey, image.status, image.png, image.pageTitle, image.pageUrl, image.source, image.createdAt)
}

// ─── Phase 5: terms across books, review questions, small key-value cache ───

export function readKv<T>(key: string, fallback: T): T { return getKv(key, fallback) }
export function writeKv(key: string, value: unknown) { setKv(key, value) }

export function writeTerms(deck: CoachDeck, bookTitle: string, chapterLabel: string) {
  const insert = database().prepare(`INSERT INTO coach_terms VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(term_key, document_id) DO UPDATE SET
    card_id = excluded.card_id, book_title = excluded.book_title, chapter_label = excluded.chapter_label, title = excluded.title, gloss = excluded.gloss`)
  database().transaction(() => {
    for (const card of deck.cards) {
      const key = coachTermKey(card)
      if (key.length >= 3) insert.run(key, deck.documentId, card.id, bookTitle.slice(0, 300), chapterLabel.slice(0, 300), card.title, card.gloss, deck.createdAt)
    }
  })()
}

/** Earlier encounters of these terms in other books, newest first. */
export function readEncounters(termKeys: string[], excludeDocumentId: string, perTerm = 3): Map<string, CoachEncounter[]> {
  const result = new Map<string, CoachEncounter[]>()
  const query = database().prepare(`SELECT t.document_id, t.book_title, t.chapter_label, t.title, t.gloss, t.created_at,
      EXISTS (SELECT 1 FROM coach_events e WHERE e.card_id = t.card_id AND e.document_id = t.document_id AND e.type = 'known') AS known
    FROM coach_terms t WHERE t.term_key = ? AND t.document_id != ? ORDER BY t.created_at DESC LIMIT ?`)
  for (const key of new Set(termKeys)) {
    const rows = query.all(key, excludeDocumentId, perTerm) as Array<{ document_id: string; book_title: string; chapter_label: string; title: string; gloss: string; created_at: number; known: number }>
    if (rows.length) result.set(key, rows.map(row => ({ documentId: row.document_id, bookTitle: row.book_title, chapterLabel: row.chapter_label, title: row.title, gloss: row.gloss, known: row.known === 1, at: row.created_at })))
  }
  return result
}

export function readOpenedCardIds(documentId: string, chapterHref: string): string[] {
  return (database().prepare(`SELECT DISTINCT card_id FROM coach_events WHERE document_id = ? AND chapter_href = ? AND card_id IS NOT NULL AND type IN ('open', 'more') ORDER BY id`)
    .all(documentId, chapterHref) as Array<{ card_id: string }>).map(row => row.card_id)
}

type ReviewRow = { id: string; document_id: string; book_title: string; chapter_href: string; chapter_label: string; question: string; recap: string; due_at: number; interval_days: number; reps: number; created_at: number }
const reviewFromRow = (row: ReviewRow): CoachReviewItem => ({ id: row.id, documentId: row.document_id, bookTitle: row.book_title, chapterHref: row.chapter_href, chapterLabel: row.chapter_label,
  question: row.question, recap: JSON.parse(row.recap), dueAt: row.due_at, intervalDays: row.interval_days, reps: row.reps, createdAt: row.created_at })

/** Returns how many new questions were scheduled (existing ones keep their schedule). */
export function insertReviews(items: CoachReviewItem[]): number {
  const insert = database().prepare('INSERT OR IGNORE INTO coach_reviews VALUES (@id, @documentId, @bookTitle, @chapterHref, @chapterLabel, @question, @recap, @dueAt, @intervalDays, @reps, @createdAt)')
  let added = 0
  database().transaction(() => { for (const item of items) added += insert.run({ ...item, recap: JSON.stringify(item.recap) }).changes })()
  return added
}
export function readDueReviews(now: number, limit = 20): CoachReviewItem[] {
  return (database().prepare('SELECT * FROM coach_reviews WHERE due_at <= ? ORDER BY due_at LIMIT ?').all(now, limit) as ReviewRow[]).map(reviewFromRow)
}
export function readReview(id: string): CoachReviewItem | null {
  const row = database().prepare('SELECT * FROM coach_reviews WHERE id = ?').get(id) as ReviewRow | undefined
  return row ? reviewFromRow(row) : null
}
export function updateReview(item: CoachReviewItem) {
  database().prepare('UPDATE coach_reviews SET due_at = ?, interval_days = ?, reps = ? WHERE id = ?').run(item.dueAt, item.intervalDays, item.reps, item.id)
}

export function closeCoachDb() { db?.close(); db = null }

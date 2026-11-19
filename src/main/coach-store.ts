import { app } from 'electron'
import path from 'node:path'
import Database from 'better-sqlite3'
import {
  DEFAULT_COACH_SETTINGS, EMPTY_COACH_PROFILE, sanitizePreferences,
  type CoachDeck, type CoachEvent, type CoachPreferences, type CoachProfile, type CoachSettings, type CoachUsage
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
  `)
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
  database().prepare(`INSERT INTO coach_decks VALUES (@key, @documentId, @chapterHref, @part, @payload, @createdAt)
    ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, created_at = excluded.created_at`)
    .run({ key: deck.key, documentId: deck.documentId, chapterHref: deck.chapterHref, part: deck.part, payload: JSON.stringify(deck), createdAt: deck.createdAt })
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

export interface StoredImage { status: 'ready' | 'none'; png: Buffer | null; pageTitle: string | null; pageUrl: string | null; createdAt: number }
export function readImage(queryKey: string): StoredImage | null {
  const row = database().prepare('SELECT status, png, page_title, page_url, created_at FROM coach_images WHERE query_key = ?').get(queryKey) as
    { status: 'ready' | 'none'; png: Buffer | null; page_title: string | null; page_url: string | null; created_at: number } | undefined
  return row ? { status: row.status, png: row.png, pageTitle: row.page_title, pageUrl: row.page_url, createdAt: row.created_at } : null
}
export function writeImage(queryKey: string, image: StoredImage) {
  database().prepare(`INSERT INTO coach_images VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(query_key) DO UPDATE SET
    status = excluded.status, png = excluded.png, page_title = excluded.page_title, page_url = excluded.page_url, created_at = excluded.created_at`)
    .run(queryKey, image.status, image.png, image.pageTitle, image.pageUrl, image.createdAt)
}

export function closeCoachDb() { db?.close(); db = null }

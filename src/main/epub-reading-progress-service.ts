import { app } from 'electron'
import path from 'path'
import Database from 'better-sqlite3'

export interface EpubReadingProgressRecord {
  documentId: string
  fileName: string
  filePath?: string | null
  cfi: string
  chapterHref?: string | null
  chapterLabel?: string | null
  progress?: number | null
  updatedAt: number
}

export interface GetEpubReadingProgressParams {
  documentId: string
  filePath?: string | null
}

export interface SaveEpubReadingProgressParams {
  documentId: string
  fileName: string
  filePath?: string | null
  cfi: string
  chapterHref?: string | null
  chapterLabel?: string | null
  progress?: number | null
}

interface EpubReadingProgressRow {
  document_id: string
  file_name: string
  file_path: string | null
  cfi: string
  chapter_href: string | null
  chapter_label: string | null
  progress: number | null
  updated_at: number
}

let db: Database.Database | null = null

function getDb(): Database.Database {
  if (db) return db

  const dbPath = path.join(app.getPath('userData'), 'epub-reading-progress.sqlite')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS epub_reading_progress (
      document_id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      file_path TEXT,
      cfi TEXT NOT NULL,
      chapter_href TEXT,
      chapter_label TEXT,
      progress REAL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_epub_reading_progress_file_path
      ON epub_reading_progress(file_path);
    CREATE INDEX IF NOT EXISTS idx_epub_reading_progress_updated
      ON epub_reading_progress(updated_at DESC);
  `)
  return db
}

function mapRow(row: EpubReadingProgressRow): EpubReadingProgressRecord {
  const progress = typeof row.progress === 'number' && Number.isFinite(row.progress)
    ? Math.max(0, Math.min(1, row.progress > 1 ? row.progress / 100 : row.progress))
    : null

  return {
    documentId: row.document_id,
    fileName: row.file_name,
    filePath: row.file_path,
    cfi: row.cfi,
    chapterHref: row.chapter_href,
    chapterLabel: row.chapter_label,
    progress,
    updatedAt: row.updated_at
  }
}

export function getEpubReadingProgress(
  params: GetEpubReadingProgressParams
): EpubReadingProgressRecord | null {
  const database = getDb()
  const byDocument = database.prepare(`
    SELECT *
    FROM epub_reading_progress
    WHERE document_id = @documentId
  `).get({
    documentId: params.documentId
  }) as EpubReadingProgressRow | undefined

  if (byDocument) return mapRow(byDocument)
  if (!params.filePath) return null

  const byPath = database.prepare(`
    SELECT *
    FROM epub_reading_progress
    WHERE file_path = @filePath
    ORDER BY updated_at DESC
    LIMIT 1
  `).get({
    filePath: params.filePath
  }) as EpubReadingProgressRow | undefined

  return byPath ? mapRow(byPath) : null
}

export function saveEpubReadingProgress(
  params: SaveEpubReadingProgressParams
): EpubReadingProgressRecord {
  const database = getDb()
  const now = Date.now()
  const progress = typeof params.progress === 'number' && Number.isFinite(params.progress)
    ? Math.max(0, Math.min(1, params.progress))
    : null

  database.prepare(`
    INSERT INTO epub_reading_progress (
      document_id, file_name, file_path, cfi, chapter_href, chapter_label, progress, updated_at
    )
    VALUES (
      @documentId, @fileName, @filePath, @cfi, @chapterHref, @chapterLabel, @progress, @now
    )
    ON CONFLICT(document_id) DO UPDATE SET
      file_name = excluded.file_name,
      file_path = excluded.file_path,
      cfi = excluded.cfi,
      chapter_href = excluded.chapter_href,
      chapter_label = excluded.chapter_label,
      -- A location can arrive before EPUB.js has finished building its
      -- whole-book location index. Keep the last known percentage until the
      -- subsequent indexed update supplies one.
      progress = COALESCE(excluded.progress, epub_reading_progress.progress),
      updated_at = excluded.updated_at
  `).run({
    documentId: params.documentId,
    fileName: params.fileName,
    filePath: params.filePath ?? null,
    cfi: params.cfi,
    chapterHref: params.chapterHref ?? null,
    chapterLabel: params.chapterLabel ?? null,
    progress,
    now
  })

  const row = database.prepare(`
    SELECT *
    FROM epub_reading_progress
    WHERE document_id = ?
  `).get(params.documentId) as EpubReadingProgressRow

  return mapRow(row)
}

export function closeEpubReadingProgressDb(): void {
  db?.close()
  db = null
}

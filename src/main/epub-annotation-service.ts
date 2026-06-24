import { app } from 'electron'
import path from 'path'
import crypto from 'crypto'
import Database from 'better-sqlite3'

export type EpubAnnotationStyle = 'yellow' | 'green' | 'blue' | 'pink' | 'red-underline'
export type EpubAnnotationKind = 'highlight' | 'underline'

export interface EpubAnnotationRecord {
  id: string
  documentId: string
  fileName: string
  filePath?: string | null
  cfiRange: string
  text: string
  style: EpubAnnotationStyle
  kind: EpubAnnotationKind
  chapterHref?: string | null
  chapterLabel?: string | null
  note?: string | null
  createdAt: number
  updatedAt: number
}

export interface SaveEpubAnnotationParams {
  documentId: string
  fileName: string
  filePath?: string | null
  cfiRange: string
  text: string
  style: EpubAnnotationStyle
  kind: EpubAnnotationKind
  chapterHref?: string | null
  chapterLabel?: string | null
  note?: string | null
}

export interface ListEpubAnnotationsParams {
  documentId: string
  fileName: string
}

export interface DeleteEpubAnnotationParams {
  documentId: string
  cfiRange: string
}

interface EpubAnnotationRow {
  id: string
  document_id: string
  file_name: string
  file_path: string | null
  cfi_range: string
  text: string
  style: EpubAnnotationStyle
  kind: EpubAnnotationKind
  chapter_href: string | null
  chapter_label: string | null
  note: string | null
  created_at: number
  updated_at: number
}

let db: Database.Database | null = null

function getDb(): Database.Database {
  if (db) return db

  const dbPath = path.join(app.getPath('userData'), 'epub-annotations.sqlite')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS epub_annotations (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT,
      cfi_range TEXT NOT NULL,
      text TEXT NOT NULL,
      style TEXT NOT NULL CHECK (style IN ('yellow', 'green', 'blue', 'pink', 'red-underline')),
      kind TEXT NOT NULL CHECK (kind IN ('highlight', 'underline')),
      chapter_href TEXT,
      chapter_label TEXT,
      note TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_epub_annotations_document_cfi
      ON epub_annotations(document_id, cfi_range);
    CREATE INDEX IF NOT EXISTS idx_epub_annotations_document_updated
      ON epub_annotations(document_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_epub_annotations_name_updated
      ON epub_annotations(file_name, updated_at DESC);
  `)
  return db
}

function stableId(documentId: string, cfiRange: string): string {
  return `epub-annotation-${crypto.createHash('sha1').update(`${documentId}:${cfiRange}`).digest('hex')}`
}

function mapRow(row: EpubAnnotationRow): EpubAnnotationRecord {
  return {
    id: row.id,
    documentId: row.document_id,
    fileName: row.file_name,
    filePath: row.file_path,
    cfiRange: row.cfi_range,
    text: row.text,
    style: row.style,
    kind: row.kind,
    chapterHref: row.chapter_href,
    chapterLabel: row.chapter_label,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function listEpubAnnotations(params: ListEpubAnnotationsParams): EpubAnnotationRecord[] {
  const rows = getDb().prepare(`
    SELECT *
    FROM epub_annotations
    WHERE document_id = @documentId
    ORDER BY created_at ASC
  `).all({
    documentId: params.documentId
  }) as EpubAnnotationRow[]

  return rows.map(mapRow)
}

export function saveEpubAnnotation(params: SaveEpubAnnotationParams): EpubAnnotationRecord {
  const database = getDb()
  const now = Date.now()
  const existing = database.prepare(`
    SELECT *
    FROM epub_annotations
    WHERE document_id = @documentId
      AND cfi_range = @cfiRange
  `).get({
    documentId: params.documentId,
    cfiRange: params.cfiRange
  }) as EpubAnnotationRow | undefined

  const id = existing?.id ?? stableId(params.documentId, params.cfiRange)
  const createdAt = existing?.created_at ?? now

  database.prepare(`
    INSERT INTO epub_annotations (
      id, document_id, file_name, file_path, cfi_range, text, style, kind,
      chapter_href, chapter_label, note, created_at, updated_at
    )
    VALUES (
      @id, @documentId, @fileName, @filePath, @cfiRange, @text, @style, @kind,
      @chapterHref, @chapterLabel, @note, @createdAt, @now
    )
    ON CONFLICT(document_id, cfi_range) DO UPDATE SET
      file_name = excluded.file_name,
      file_path = excluded.file_path,
      text = excluded.text,
      style = excluded.style,
      kind = excluded.kind,
      chapter_href = excluded.chapter_href,
      chapter_label = excluded.chapter_label,
      note = excluded.note,
      updated_at = excluded.updated_at
  `).run({
    id,
    documentId: params.documentId,
    fileName: params.fileName,
    filePath: params.filePath ?? null,
    cfiRange: params.cfiRange,
    text: params.text,
    style: params.style,
    kind: params.kind,
    chapterHref: params.chapterHref ?? null,
    chapterLabel: params.chapterLabel ?? null,
    note: params.note ?? null,
    createdAt,
    now
  })

  const row = database.prepare('SELECT * FROM epub_annotations WHERE id = ?').get(id) as EpubAnnotationRow
  return mapRow(row)
}

export function deleteEpubAnnotation(params: DeleteEpubAnnotationParams): { success: boolean } {
  getDb().prepare(`
    DELETE FROM epub_annotations
    WHERE document_id = @documentId
      AND cfi_range = @cfiRange
  `).run({
    documentId: params.documentId,
    cfiRange: params.cfiRange
  })

  return { success: true }
}

export function closeEpubAnnotationDb(): void {
  db?.close()
  db = null
}

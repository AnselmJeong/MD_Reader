import { app, nativeImage, BrowserWindow } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import type { CommentaryNote, CommentarySnapshot, SaveCommentary, CommentaryAsset, CommentaryAnchor, CommentaryHtml } from '../shared/commentary'
import { MAX_COMMENTARY_HTML_BYTES, validateCommentaryHtml, resolveCommentaryContent } from '../shared/commentary-html'

let db: Database.Database | null = null
function changed(documentId: string) {
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('commentary:changed', documentId)
}
function database() {
  if (db) return db
  db = new Database(path.join(app.getPath('userData'), 'commentary.sqlite'))
  db.pragma('journal_mode = WAL')
  db.exec(`CREATE TABLE IF NOT EXISTS commentary_notes (
    document_id TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL,
    PRIMARY KEY(document_id, id));
    CREATE TABLE IF NOT EXISTS commentary_assets (
    document_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, data BLOB NOT NULL,
    PRIMARY KEY(document_id, id));`)
  return db
}

export function validateDocumentId(id: string) {
  if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw new Error('문서 식별자가 올바르지 않습니다.')
}

function validateAnchor(anchor: CommentaryAnchor) {
  if (!anchor || typeof anchor.chapterHref !== 'string' || anchor.chapterHref.length > 4096
    || !Array.isArray(anchor.path) || anchor.path.length > 100
    || anchor.path.some(n => !Number.isSafeInteger(n) || n < 0 || n > 100000)
    || typeof anchor.quote !== 'string' || anchor.quote.length > 10000
    || (anchor.elementId !== undefined && (typeof anchor.elementId !== 'string' || anchor.elementId.length > 4096))
    || (anchor.tagName !== undefined && !/^[a-z][a-z0-9-]{0,30}$/.test(anchor.tagName))) throw new Error('주석 위치가 올바르지 않습니다.')
}

function validateNote(note: CommentaryNote) {
  validateDocumentId(note.documentId)
  if (typeof note.id !== 'string' || !/^[a-f0-9-]{36}$/.test(note.id)
    || (note.parentId !== null && (typeof note.parentId !== 'string' || !/^[a-f0-9-]{36}$/.test(note.parentId)))
    || typeof note.markdown !== 'string' || note.markdown.length > 200000
    || !Number.isSafeInteger(note.createdAt) || !Number.isSafeInteger(note.updatedAt)
    || note.createdAt < 0 || note.updatedAt < note.createdAt
    || (note.deletedAt !== null && !Number.isSafeInteger(note.deletedAt))) throw new Error('주석 데이터가 올바르지 않습니다.')
  validateAnchor(note.anchor)
  if (note.html != null) validateCommentaryHtml(note.html)
  if (note.origin && (typeof note.origin.messageId !== 'string' || typeof note.origin.model !== 'string'
    || typeof note.origin.content !== 'string' || note.origin.content.length > 200000
    || (note.origin.sessionId !== null && typeof note.origin.sessionId !== 'string'))) throw new Error('AI 출처 데이터가 올바르지 않습니다.')
}

function readNote(documentId: string, id: string): CommentaryNote | null {
  const row = database().prepare('SELECT payload FROM commentary_notes WHERE document_id = ? AND id = ?').get(documentId, id) as { payload: string } | undefined
  return row ? JSON.parse(row.payload) : null
}

function putNote(note: CommentaryNote) {
  database().prepare('INSERT INTO commentary_notes VALUES (?, ?, ?) ON CONFLICT(document_id, id) DO UPDATE SET payload=excluded.payload')
    .run(note.documentId, note.id, JSON.stringify(note))
}

export function listCommentary(documentId: string): CommentarySnapshot {
  validateDocumentId(documentId)
  const notes = (database().prepare('SELECT payload FROM commentary_notes WHERE document_id = ?').all(documentId) as { payload: string }[])
    .map(row => JSON.parse(row.payload) as CommentaryNote).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  const assets = (database().prepare('SELECT id, name, data FROM commentary_assets WHERE document_id = ?').all(documentId) as { id: string; name: string; data: Buffer }[])
    .map(row => ({ id: row.id, name: row.name, dataUrl: `data:image/png;base64,${row.data.toString('base64')}` }))
  return { notes, assets }
}

export function saveCommentary(params: SaveCommentary): CommentaryNote {
  validateDocumentId(params.documentId)
  const existing = params.id ? readNote(params.documentId, params.id) : null
  if (params.id && !existing) throw new Error('주석을 찾을 수 없습니다.')
  if (existing && params.expectedUpdatedAt !== existing.updatedAt) throw new Error('다른 창에서 수정된 주석입니다. 다시 열어 확인해 주세요.')
  const parent = params.parentId ? readNote(params.documentId, params.parentId) : null
  if (params.parentId && !parent) throw new Error('답글을 붙일 주석을 찾을 수 없습니다.')
  let ancestor = parent
  let depth = 0
  while (ancestor) {
    if (++depth >= 128) throw new Error('답글이 너무 깊습니다. 이 위치에 새 주석을 추가해 주세요.')
    ancestor = ancestor.parentId ? readNote(params.documentId, ancestor.parentId) : null
  }
  if (existing && existing.parentId !== params.parentId) throw new Error('주석의 부모는 변경할 수 없습니다.')
  const now = Math.max(Date.now(), (existing?.updatedAt ?? 0) + 1)
  const note: CommentaryNote = {
    id: existing?.id ?? randomUUID(), documentId: params.documentId,
    parentId: params.parentId, anchor: parent?.anchor ?? params.anchor,
    markdown: params.markdown.trim(), html: params.html === undefined ? existing?.html ?? null : params.html,
    origin: existing?.origin ?? params.origin ?? null,
    createdAt: existing?.createdAt ?? now, updatedAt: now, deletedAt: existing?.deletedAt ?? null
  }
  Object.assign(note, resolveCommentaryContent(note))
  validateNote(note)
  if (!note.markdown && !note.html) throw new Error('주석 내용을 입력하거나 HTML 파일을 추가해 주세요.')
  database().transaction(() => {
    putNote(note)
    if (existing && !note.parentId && JSON.stringify(existing.anchor) !== JSON.stringify(note.anchor)) {
      const all = listCommentary(params.documentId).notes
      const descendants = new Set([note.id])
      for (let changed = true; changed;) {
        changed = false
        for (const child of all) if (child.parentId && descendants.has(child.parentId) && !descendants.has(child.id)) {
          descendants.add(child.id); changed = true
          putNote({ ...child, anchor: note.anchor, updatedAt: Math.max(now, child.updatedAt + 1) })
        }
      }
    }
  })()
  changed(note.documentId)
  return note
}

export function setCommentaryDeleted(documentId: string, id: string, deleted: boolean) {
  validateDocumentId(documentId)
  const note = readNote(documentId, id)
  if (!note) throw new Error('주석을 찾을 수 없습니다.')
  note.updatedAt = Math.max(Date.now(), note.updatedAt + 1)
  note.deletedAt = deleted ? note.updatedAt : null
  putNote(note)
  changed(documentId)
  return note
}

export function commentaryDeletionPlan(documentId: string, id: string, expectedUpdatedAt: number) {
  validateDocumentId(documentId)
  const notes = (database().prepare('SELECT payload FROM commentary_notes WHERE document_id = ?').all(documentId) as { payload: string }[])
    .map(row => JSON.parse(row.payload) as CommentaryNote)
  const root = notes.find(note => note.id === id)
  if (!root || !root.deletedAt) throw new Error('삭제된 주석만 완전히 삭제할 수 있습니다.')
  if (root.updatedAt !== expectedUpdatedAt) throw new Error('다른 창에서 수정된 주석입니다. 다시 확인해 주세요.')
  const ids = new Set([id])
  for (let changed = true; changed;) {
    changed = false
    for (const note of notes) if (note.parentId && ids.has(note.parentId) && !ids.has(note.id)) { ids.add(note.id); changed = true }
  }
  const removed = notes.filter(note => ids.has(note.id))
  return { removed, revision: removed.map(note => `${note.id}:${note.updatedAt}`).sort().join('|') }
}

export function permanentlyDeleteCommentary(documentId: string, id: string, expectedUpdatedAt: number, expectedRevision: string) {
  database().transaction(() => {
    const plan = commentaryDeletionPlan(documentId, id, expectedUpdatedAt)
    if (plan.revision !== expectedRevision) throw new Error('확인하는 동안 답글이 변경되었습니다. 다시 확인해 주세요.')
    const remove = database().prepare('DELETE FROM commentary_notes WHERE document_id = ? AND id = ?')
    for (const note of plan.removed) remove.run(documentId, note.id)
    // Delete only assets owned by the removed thread and no longer referenced
    // elsewhere; leave unrelated assets (including unfinished drafts) intact.
    const candidateIds = new Set(plan.removed.flatMap(note => [...note.markdown.matchAll(/mdr-asset:([a-f0-9]{64})/g)].map(match => match[1])))
    const remaining = (database().prepare('SELECT payload FROM commentary_notes WHERE document_id = ?').all(documentId) as { payload: string }[])
      .map(row => (JSON.parse(row.payload) as CommentaryNote).markdown).join('\n')
    for (const assetId of candidateIds) if (!remaining.includes(`mdr-asset:${assetId}`)) {
      database().prepare('DELETE FROM commentary_assets WHERE document_id = ? AND id = ?').run(documentId, assetId)
    }
  })()
  changed(documentId)
}

export async function importCommentaryHtml(filePath: string): Promise<CommentaryHtml> {
  if (!/\.html?$/i.test(filePath)) throw new Error('HTML 또는 HTM 파일을 선택해 주세요.')
  if ((await fs.stat(filePath)).size > MAX_COMMENTARY_HTML_BYTES) throw new Error('HTML 파일은 8 MB 이하로 추가해 주세요.')
  const bytes = await fs.readFile(filePath)
  if (bytes.length > MAX_COMMENTARY_HTML_BYTES) throw new Error('HTML 파일은 8 MB 이하로 추가해 주세요.')
  let content: string
  try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { throw new Error('HTML 파일을 UTF-8로 저장한 뒤 다시 추가해 주세요.') }
  const html = { name: path.basename(filePath), content }
  validateCommentaryHtml(html)
  return html
}

export async function importCommentaryImage(documentId: string, filePath: string): Promise<CommentaryAsset> {
  validateDocumentId(documentId)
  if ((await fs.stat(filePath)).size > 8 * 1024 * 1024) throw new Error('그림은 8 MB 이하로 추가해 주세요.')
  if (!/\.(png|jpe?g|webp|gif)$/i.test(filePath)) throw new Error('PNG, JPEG, WebP, GIF 그림을 선택해 주세요.')
  const image = nativeImage.createFromBuffer(await fs.readFile(filePath))
  if (image.isEmpty()) throw new Error('그림 파일을 읽을 수 없습니다.')
  const size = image.getSize()
  if (size.width * size.height > 40000000) throw new Error('그림 해상도가 너무 큽니다.')
  const png = image.toPNG()
  if (png.length > 8 * 1024 * 1024) throw new Error('변환된 그림이 8 MB를 넘습니다. 크기를 줄여 주세요.')
  const id = createHash('sha256').update(png).digest('hex')
  const name = path.basename(filePath).replace(/\.[^.]+$/, '') + '.png'
  database().prepare('INSERT OR IGNORE INTO commentary_assets VALUES (?, ?, ?, ?)').run(documentId, id, name, png)
  changed(documentId)
  return { id, name, dataUrl: `data:image/png;base64,${png.toString('base64')}` }
}

export function importCommentarySnapshot(documentId: string, snapshot: CommentarySnapshot) {
  validateDocumentId(documentId)
  if (!snapshot || !Array.isArray(snapshot.notes) || snapshot.notes.length > 10000
    || !Array.isArray(snapshot.assets) || snapshot.assets.length > 1000) throw new Error('주석 묶음이 너무 크거나 올바르지 않습니다.')
  const byId = new Map<string, CommentaryNote>()
  for (const note of snapshot.notes) {
    validateNote(note)
    if (note.documentId !== documentId || byId.has(note.id)) throw new Error('중복되거나 다른 문서의 주석입니다.')
    byId.set(note.id, note)
  }
  // Validate the result of timestamp merging too: two individually valid trees
  // can form a cycle when only some imported revisions replace local notes.
  const merged = new Map(listCommentary(documentId).notes.map(note => [note.id, note]))
  for (const note of snapshot.notes) {
    const existing = merged.get(note.id)
    if (!existing || note.updatedAt > existing.updatedAt) merged.set(note.id, note)
  }
  for (const note of snapshot.notes) {
    const seen = new Set<string>([note.id])
    let current = note
    while (current.parentId) {
      if (seen.has(current.parentId) || seen.size > 128) throw new Error('답글 관계가 순환하거나 너무 깊습니다.')
      seen.add(current.parentId)
      const parent = byId.get(current.parentId)
      if (!parent) throw new Error('답글의 부모 주석이 없습니다.')
      current = parent
    }
  }
  for (const note of merged.values()) {
    const seen = new Set([note.id])
    let current = note
    while (current.parentId) {
      if (seen.has(current.parentId) || seen.size > 128) throw new Error('병합한 답글 관계가 순환하거나 너무 깊습니다.')
      seen.add(current.parentId)
      const parent = merged.get(current.parentId)
      if (!parent) throw new Error('병합한 답글의 부모 주석이 없습니다.')
      current = parent
    }
  }
  let totalBytes = 0
  const assets = snapshot.assets.map(asset => {
    if (!asset || !/^[a-f0-9]{64}$/.test(asset.id) || typeof asset.name !== 'string'
      || typeof asset.dataUrl !== 'string' || !asset.dataUrl.startsWith('data:image/png;base64,')) throw new Error('첨부 그림 데이터가 올바르지 않습니다.')
    const bytes = Buffer.from(asset.dataUrl.slice(22), 'base64')
    totalBytes += bytes.length
    if (bytes.length > 8 * 1024 * 1024 || totalBytes > 128 * 1024 * 1024
      || createHash('sha256').update(bytes).digest('hex') !== asset.id
      || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('첨부 그림 검증에 실패했습니다.')
    return { ...asset, bytes }
  })
  database().transaction(() => {
    for (const note of snapshot.notes) {
      const existing = readNote(documentId, note.id)
      if (!existing || note.updatedAt > existing.updatedAt) putNote(note)
    }
    for (const asset of assets) database().prepare('INSERT OR IGNORE INTO commentary_assets VALUES (?, ?, ?, ?)')
      .run(documentId, asset.id, asset.name, asset.bytes)
  })()
  changed(documentId)
}

export function closeCommentaryDb() { db?.close(); db = null }

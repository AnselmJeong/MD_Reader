import { app } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import type { ExtractedSoulDirective, ExtractedUserProfile } from './memory-extractor'

const USER_TEMPLATE = `# USER

## Intellectual Profile

## Academic Orientation

## Current Research Interests

## Preferred Discussion Style

## Known Strengths

## Productive Frictions

## Avoid

## Open Questions About The User

## Evidence Log
`

const SOUL_TEMPLATE = `# SOUL

## Core Stance
- Be a rigorous discussion partner, not a passive answer engine.

## Conversational Defaults

## When Discussing Texts

## When Building Software

## Challenge Policy

## Things To Avoid

## Pending Review
`

function memoryDir(): string {
  return path.join(app.getPath('userData'), 'agent-memory')
}

export function getAgentMemoryPaths(): { dir: string; user: string; soul: string; reviewQueue: string } {
  const dir = memoryDir()
  return {
    dir,
    user: path.join(dir, 'USER.md'),
    soul: path.join(dir, 'SOUL.md'),
    reviewQueue: path.join(dir, 'review-queue.jsonl')
  }
}

async function ensureMemoryFiles(): Promise<void> {
  const paths = getAgentMemoryPaths()
  await fs.mkdir(paths.dir, { recursive: true })
  await ensureFile(paths.user, USER_TEMPLATE)
  await ensureFile(paths.soul, SOUL_TEMPLATE)
  await ensureFile(paths.reviewQueue, '')
}

async function ensureFile(filePath: string, content: string): Promise<void> {
  try {
    await fs.access(filePath)
  } catch {
    await fs.writeFile(filePath, content, 'utf-8')
  }
}

export async function readAgentMemoryFiles(): Promise<{ user: string; soul: string }> {
  await ensureMemoryFiles()
  const paths = getAgentMemoryPaths()
  const [user, soul] = await Promise.all([
    fs.readFile(paths.user, 'utf-8'),
    fs.readFile(paths.soul, 'utf-8')
  ])
  return { user, soul }
}

function normalizeBullet(text: string): string {
  return text.trim().replace(/\s+/g, ' ').replace(/^[-*]\s+/, '')
}

function insertBullet(markdown: string, section: string, bullet: string): { markdown: string; applied: boolean } {
  const normalized = normalizeBullet(bullet)
  if (!normalized) return { markdown, applied: false }
  const bulletLine = `- ${normalized}`
  if (markdown.includes(bulletLine)) return { markdown, applied: false }

  const heading = `## ${section}`
  const start = markdown.indexOf(heading)
  if (start === -1) {
    const suffix = markdown.endsWith('\n') ? '' : '\n'
    return { markdown: `${markdown}${suffix}\n${heading}\n${bulletLine}\n`, applied: true }
  }

  const afterHeading = start + heading.length
  const nextHeading = markdown.indexOf('\n## ', afterHeading)
  const insertAt = nextHeading === -1 ? markdown.length : nextHeading
  const before = markdown.slice(0, insertAt).replace(/\s*$/, '\n')
  const after = markdown.slice(insertAt)
  return { markdown: `${before}${bulletLine}\n${after}`, applied: true }
}

export const COACH_PROFILE_SECTION = 'Reading Coach Profile'

/** Lines of one USER.md section (bullets only). */
export function readSection(markdown: string, section: string): string[] {
  const heading = `## ${section}`
  const start = markdown.indexOf(heading)
  if (start === -1) return []
  const next = markdown.indexOf('\n## ', start + heading.length)
  return markdown.slice(start + heading.length, next === -1 ? undefined : next).split('\n').map(line => line.trim()).filter(line => line.startsWith('- '))
}

/** Replace a whole USER.md section (unlike extracted insights, the coach summary is rewritten, not appended). Returns whether the file changed. */
export async function replaceUserSection(section: string, lines: string[]): Promise<boolean> {
  await ensureMemoryFiles()
  const paths = getAgentMemoryPaths()
  const markdown = await fs.readFile(paths.user, 'utf-8')
  const heading = `## ${section}`
  const body = lines.map(line => `- ${normalizeBullet(line)}`).join('\n')
  const block = `${heading}\n${body}${body ? '\n' : ''}`
  const start = markdown.indexOf(heading)
  let next: string
  if (start === -1) next = `${markdown.replace(/\s*$/, '\n')}\n${block}`
  else {
    const end = markdown.indexOf('\n## ', start + heading.length)
    next = `${markdown.slice(0, start)}${block}${end === -1 ? '' : markdown.slice(end)}`
  }
  if (next === markdown) return false
  await fs.writeFile(paths.user, next, 'utf-8')
  return true
}

export async function applyUserProfileItems(items: ExtractedUserProfile[]): Promise<number> {
  if (items.length === 0) return 0
  await ensureMemoryFiles()
  const paths = getAgentMemoryPaths()
  let markdown = await fs.readFile(paths.user, 'utf-8')
  let applied = 0

  for (const item of items) {
    if (item.operation === 'no_op') continue
    const result = insertBullet(markdown, item.section, item.content)
    markdown = result.markdown
    if (result.applied) applied += 1
  }

  if (applied > 0) await fs.writeFile(paths.user, markdown, 'utf-8')
  return applied
}

export async function queueSoulDirectives(items: ExtractedSoulDirective[]): Promise<number> {
  if (items.length === 0) return 0
  await ensureMemoryFiles()
  const paths = getAgentMemoryPaths()
  let markdown = await fs.readFile(paths.soul, 'utf-8')
  let queued = 0

  for (const item of items) {
    if (item.operation === 'no_op') continue
    const result = insertBullet(markdown, 'Pending Review', `${item.content} [confidence ${item.confidence.toFixed(2)}]`)
    markdown = result.markdown
    if (result.applied) queued += 1
  }

  if (queued > 0) {
    await fs.writeFile(paths.soul, markdown, 'utf-8')
    const jsonl = items
      .filter((item) => item.operation !== 'no_op')
      .map((item) => JSON.stringify({ type: 'soul_directive', item, queuedAt: Date.now() }))
      .join('\n')
    if (jsonl) await fs.appendFile(paths.reviewQueue, `${jsonl}\n`, 'utf-8')
  }

  return queued
}


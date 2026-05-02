import type { TtsUtterance } from '../../../global'
import { stripMarkdownFrontmatter } from './headings'

function stripMarkdownNoise(content: string): string {
  return stripMarkdownFrontmatter(content)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[\s>*-]*\[[!xX ]]\s+/gm, '')
    .replace(/[*_~]{1,3}/g, '')
    .replace(/\|/g, ' ')
    .replace(/\[(?:@|#)[^\]]+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function splitIntoUtterances(text: string): string[] {
  const parts = text.match(/[^.!?。！？]+[.!?。！？]+(?:["')\]]+)?|[^.!?。！？]+$/g) || [text]
  const utterances: string[] = []
  let buffer = ''

  for (const rawPart of parts) {
    const part = rawPart.trim()
    if (!part) continue
    const next = buffer ? `${buffer} ${part}` : part
    if (next.length < 80) {
      buffer = next
      continue
    }
    utterances.push(next)
    buffer = ''
  }

  if (buffer) utterances.push(buffer)
  return utterances.flatMap((utterance) => {
    if (utterance.length <= 700) return [utterance]
    const chunks: string[] = []
    for (let index = 0; index < utterance.length; index += 650) {
      chunks.push(utterance.slice(index, index + 650).trim())
    }
    return chunks.filter(Boolean)
  })
}

export function buildDocumentTtsUtterances(content: string): TtsUtterance[] {
  return splitIntoUtterances(stripMarkdownNoise(content)).map((text, index) => ({
    id: `tts-${index}`,
    text
  }))
}

export function buildSelectionTtsUtterance(text: string): TtsUtterance[] {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized ? [{ id: 'selection-0', text: normalized }] : []
}

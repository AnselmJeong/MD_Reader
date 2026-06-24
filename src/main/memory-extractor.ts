import type { ContextRow, StoredChatMessage } from './chat-session-service'
import { generateJsonResponse } from './ollama-service'

export type UserProfileSection =
  | 'Intellectual Profile'
  | 'Academic Orientation'
  | 'Current Research Interests'
  | 'Preferred Discussion Style'
  | 'Known Strengths'
  | 'Productive Frictions'
  | 'Avoid'
  | 'Open Questions About The User'

export type SoulSection =
  | 'Core Stance'
  | 'Conversational Defaults'
  | 'When Discussing Texts'
  | 'When Building Software'
  | 'Challenge Policy'
  | 'Things To Avoid'

export interface ExtractedUserProfile {
  operation: 'add' | 'update' | 'no_op'
  section: UserProfileSection
  content: string
  confidence: number
  stability: 'explicit' | 'repeated' | 'inferred' | 'tentative'
  evidence_message_ids: string[]
  rationale: string
}

export interface ExtractedSoulDirective {
  operation: 'add' | 'update' | 'queue_review' | 'no_op'
  section: SoulSection
  content: string
  confidence: number
  stability: 'explicit' | 'repeated' | 'inferred' | 'tentative'
  evidence_message_ids: string[]
  rationale: string
}

export interface ExtractedInsight {
  subtype: 'cross_document_bridge' | 'interpretive_hypothesis' | 'research_lead' | 'conceptual_tool'
  content: string
  confidence: number
  novelty: 'high' | 'medium' | 'low'
  reuse_scenario: string
  evidence_message_ids: string[]
  tags: string[]
}

export interface RejectedMemory {
  content: string
  reason: 'document_fact' | 'too_local' | 'low_confidence' | 'duplicate' | 'sensitive' | 'raw_quote'
}

export interface MemoryExtractionResult {
  user_profile: ExtractedUserProfile[]
  soul_directives: ExtractedSoulDirective[]
  insights: ExtractedInsight[]
  rejects: RejectedMemory[]
}

const MEMORY_EXTRACTION_SYSTEM_PROMPT = `You are the memory curator for MD_Reader, an academic reading and discussion app.

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
- Output valid JSON only.`

const USER_SECTIONS: UserProfileSection[] = [
  'Intellectual Profile',
  'Academic Orientation',
  'Current Research Interests',
  'Preferred Discussion Style',
  'Known Strengths',
  'Productive Frictions',
  'Avoid',
  'Open Questions About The User'
]

const SOUL_SECTIONS: SoulSection[] = [
  'Core Stance',
  'Conversational Defaults',
  'When Discussing Texts',
  'When Building Software',
  'Challenge Policy',
  'Things To Avoid'
]

function clampConfidence(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asStringArray(value: unknown): string[] {
  return asArray(value).map((item) => String(item)).filter(Boolean)
}

function extractJsonObject(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1))
    throw new Error('Extractor did not return valid JSON')
  }
}

function compactMarkdown(markdown: string, maxChars: number): string {
  if (markdown.length <= maxChars) return markdown
  return `${markdown.slice(0, maxChars)}\n\n[truncated]`
}

function transcriptForPrompt(messages: StoredChatMessage[]): string {
  return messages.map((message, index) => {
    const content = message.content.length > 1800 ? `${message.content.slice(0, 1800)}\n[truncated]` : message.content
    const quoted = message.quotedText ? `\nquoted_text: ${message.quotedText.slice(0, 700)}` : ''
    return `<message id="${message.id}" ordinal="${index}" role="${message.role}">\n${content}${quoted}\n</message>`
  }).join('\n\n')
}

function validateExtraction(value: unknown): MemoryExtractionResult {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    user_profile: asArray(record.user_profile).map((item) => {
      const row = item as Record<string, unknown>
      const section = USER_SECTIONS.includes(row.section as UserProfileSection)
        ? row.section as UserProfileSection
        : 'Open Questions About The User'
      const operation: ExtractedUserProfile['operation'] = row.operation === 'update' || row.operation === 'no_op' ? row.operation : 'add'
      const stability: ExtractedUserProfile['stability'] = row.stability === 'explicit' || row.stability === 'repeated' || row.stability === 'tentative'
        ? row.stability
        : 'inferred'
      return {
        operation,
        section,
        content: String(row.content ?? '').trim(),
        confidence: clampConfidence(row.confidence),
        stability,
        evidence_message_ids: asStringArray(row.evidence_message_ids),
        rationale: String(row.rationale ?? '').trim()
      }
    }).filter((item) => item.content),
    soul_directives: asArray(record.soul_directives).map((item) => {
      const row = item as Record<string, unknown>
      const section = SOUL_SECTIONS.includes(row.section as SoulSection) ? row.section as SoulSection : 'Conversational Defaults'
      const operation: ExtractedSoulDirective['operation'] = row.operation === 'add' || row.operation === 'update' || row.operation === 'no_op'
        ? row.operation
        : 'queue_review'
      const stability: ExtractedSoulDirective['stability'] = row.stability === 'explicit' || row.stability === 'repeated' || row.stability === 'tentative'
        ? row.stability
        : 'inferred'
      return {
        operation,
        section,
        content: String(row.content ?? '').trim(),
        confidence: clampConfidence(row.confidence),
        stability,
        evidence_message_ids: asStringArray(row.evidence_message_ids),
        rationale: String(row.rationale ?? '').trim()
      }
    }).filter((item) => item.content),
    insights: asArray(record.insights).map((item) => {
      const row = item as Record<string, unknown>
      const subtype: ExtractedInsight['subtype'] = row.subtype === 'cross_document_bridge' || row.subtype === 'research_lead' || row.subtype === 'conceptual_tool'
        ? row.subtype
        : 'interpretive_hypothesis'
      const novelty: ExtractedInsight['novelty'] = row.novelty === 'high' || row.novelty === 'low' ? row.novelty : 'medium'
      return {
        subtype,
        content: String(row.content ?? '').trim(),
        confidence: clampConfidence(row.confidence),
        novelty,
        reuse_scenario: String(row.reuse_scenario ?? '').trim(),
        evidence_message_ids: asStringArray(row.evidence_message_ids),
        tags: asStringArray(row.tags).slice(0, 8)
      }
    }).filter((item) => item.content),
    rejects: asArray(record.rejects).map((item) => {
      const row = item as Record<string, unknown>
      const reason: RejectedMemory['reason'] = row.reason === 'too_local' || row.reason === 'low_confidence' || row.reason === 'duplicate' || row.reason === 'sensitive' || row.reason === 'raw_quote'
        ? row.reason
        : 'document_fact'
      return {
        content: String(row.content ?? '').trim(),
        reason
      }
    }).filter((item) => item.content)
  }
}

export async function extractSessionMemory(params: {
  model: string
  context: ContextRow
  messages: StoredChatMessage[]
  userMarkdown: string
  soulMarkdown: string
}): Promise<MemoryExtractionResult> {
  const userPrompt = `Session metadata:
${JSON.stringify({
  context_key: params.context.context_key,
  document_kind: params.context.document_kind,
  context_title: params.context.context_title,
  file_name: params.context.file_name,
  chapter_label: params.context.chapter_label
}, null, 2)}

Current USER.md:
${compactMarkdown(params.userMarkdown, 5000)}

Current SOUL.md:
${compactMarkdown(params.soulMarkdown, 4000)}

Transcript:
${transcriptForPrompt(params.messages)}

Return JSON exactly matching this shape:
{
  "user_profile": [{"operation":"add|update|no_op","section":"Intellectual Profile|Academic Orientation|Current Research Interests|Preferred Discussion Style|Known Strengths|Productive Frictions|Avoid|Open Questions About The User","content":"one concise durable bullet","confidence":0.0,"stability":"explicit|repeated|inferred|tentative","evidence_message_ids":["msg-..."],"rationale":"short"}],
  "soul_directives": [{"operation":"add|update|queue_review|no_op","section":"Core Stance|Conversational Defaults|When Discussing Texts|When Building Software|Challenge Policy|Things To Avoid","content":"one concise behavioral instruction","confidence":0.0,"stability":"explicit|repeated|inferred|tentative","evidence_message_ids":["msg-..."],"rationale":"short"}],
  "insights": [{"subtype":"cross_document_bridge|interpretive_hypothesis|research_lead|conceptual_tool","content":"standalone future-usable insight","confidence":0.0,"novelty":"high|medium|low","reuse_scenario":"when this should be retrieved later","evidence_message_ids":["msg-..."],"tags":["..."]}],
  "rejects": [{"content":"what was rejected","reason":"document_fact|too_local|low_confidence|duplicate|sensitive|raw_quote"}]
}`

  const raw = await generateJsonResponse({
    model: params.model,
    systemPrompt: MEMORY_EXTRACTION_SYSTEM_PROMPT,
    userPrompt
  })
  return validateExtraction(extractJsonObject(raw))
}

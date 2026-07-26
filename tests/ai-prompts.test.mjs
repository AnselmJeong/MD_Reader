import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_AI_SYSTEM_PROMPT,
  resolveAiSystemPrompt
} from '../src/shared/ai-prompts.ts'

const PREVIOUS_GROUNDED_DEFAULT = `You are a careful academic reading assistant. Answer in Korean.

Use the provided document context first. When web sources are provided, use them to verify current or external factual claims and cite them with [S1], [S2] markers. If the provided document or sources do not support a claim, say so clearly instead of guessing.

Keep answers precise, distinguish document evidence from web evidence, and avoid inventing citations.`

test('migrates previous default prompts to the active research prompt', () => {
  assert.equal(resolveAiSystemPrompt(PREVIOUS_GROUNDED_DEFAULT), DEFAULT_AI_SYSTEM_PROMPT)
  assert.match(DEFAULT_AI_SYSTEM_PROMPT, /complementary evidence/)
  assert.match(DEFAULT_AI_SYSTEM_PROMPT, /Lead with the answer/)
  assert.match(DEFAULT_AI_SYSTEM_PROMPT, /actively use and synthesize the web evidence/)
  assert.match(DEFAULT_AI_SYSTEM_PROMPT, /untrusted evidence/)
})

test('preserves a user-authored system prompt', () => {
  const custom = 'Use a concise Socratic style and preserve the language of the question.'
  assert.equal(resolveAiSystemPrompt(custom), custom)
})

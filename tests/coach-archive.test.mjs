import assert from 'node:assert/strict'
import test from 'node:test'
import { latestDecks, mergeUserDeck, quotePattern, sanitizeArchiveDeck, sanitizeArchiveImage } from '../src/shared/coach-archive.ts'

const doc = 'd'.repeat(64)
const card = (id, quote, title = 't') => ({ id, kind: 'term', difficulty: 3, quote, title, gloss: 'g' })
const deck = (part, createdAt, cards, key = 'a'.repeat(64)) => ({ key, documentId: doc, chapterHref: 'c.xhtml', part, domain: [], brief: '', sections: [], recap: [], questions: [], cards, dropped: 0, model: 'm', createdAt })

test('quote pattern tolerates whitespace, quote and dash variants', () => {
  assert.match('The “Axial Age” was named', quotePattern('The "Axial Age" was named'))
  assert.match('Karl \n  Jaspers – the', quotePattern('Karl Jaspers - the'))
  assert.match('a (b) c?', quotePattern('a (b) c?'))
  assert.equal(quotePattern(' '), null)
})

test('sanitize binds decks to the book and drops malformed ones', () => {
  const clean = sanitizeArchiveDeck({ ...deck(0, 5, [card('0000000a', 'quote'), card('0000000a', 'dup'), { id: 'x', kind: 'term' }]), documentId: 'e'.repeat(64), chapterHref: 'c.xhtml#frag', extra: 1 }, doc)
  assert.equal(clean.documentId, doc)
  assert.equal(clean.chapterHref, 'c.xhtml')
  assert.equal(clean.cards.length, 1)
  assert.equal('extra' in clean, false)
  assert.equal(sanitizeArchiveDeck({ ...deck(0, 5, [card('0000000a', 'quote')]), key: 'nope' }, doc), null)
  assert.equal(sanitizeArchiveDeck({ ...deck(500, 5, [card('0000000a', 'quote')]) }, doc), null)
  assert.ok(sanitizeArchiveDeck(deck(999, 5, [card('0000000a', 'quote')]), doc))
  assert.equal(sanitizeArchiveDeck(deck(0, 5, []), doc), null)
})

test('sanitize image keeps only http links and known types', () => {
  assert.equal(sanitizeArchiveImage({ key: 'v3:x', mime: 'image/svg+xml' }), null)
  assert.equal(sanitizeArchiveImage({ key: 'v3:x', mime: 'image/png', pageUrl: 'javascript:alert(1)' }).pageUrl, null)
  assert.equal(sanitizeArchiveImage({ key: 'v3:x', mime: 'image/png', pageUrl: 'https://en.wikipedia.org/wiki/X' }).pageUrl, 'https://en.wikipedia.org/wiki/X')
})

test('my cards merge without duplicates; local deck wins', () => {
  const local = deck(999, 1, [card('0000000a', 'one')])
  const merged = mergeUserDeck(local, deck(999, 2, [card('0000000a', 'one'), card('0000000b', 'one', 'same quote'), card('0000000c', 'two')]))
  assert.deepEqual(merged.cards.map(item => item.id), ['0000000a', '0000000c'])
  assert.equal(mergeUserDeck(local, deck(999, 2, [card('0000000a', 'one')])), local)
})

test('export keeps the newest deck per chapter part', () => {
  const kept = latestDecks([deck(0, 1, [], 'a'.repeat(64)), deck(0, 3, [], 'b'.repeat(64)), deck(1, 2, [], 'c'.repeat(64))])
  assert.deepEqual(kept.map(item => item.key[0]), ['b', 'c'])
})

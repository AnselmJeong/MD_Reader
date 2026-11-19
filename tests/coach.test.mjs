import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyCoachEvent, baseCardScore, buildCoachDeckPrompt, coachDeckCacheInput, DEFAULT_COACH_PREFERENCES, EMPTY_COACH_PROFILE,
  estimatedLevels, parseCoachDeck, partForVisibleText, profileMismatch, sanitizePreferences, selectCoachCards, showsBriefing,
  splitChapterText, coachTermKey, nextReviewInterval, summarizeCoachProfile
} from '../src/shared/coach.ts'
import { findWikipediaImage, wikipediaArticle, wikipediaTitleMatches } from '../src/main/coach-image-service.ts'
import { searchTinyFishWeb } from '../src/main/tinyfish-web-search-service.ts'

const chapter = `The “Axial Age” was named by Karl Jaspers. In this period, Confucius and the Buddha taught.
Later critics argued that the idea of a single age is too neat.`

const response = {
  domain: ['Religious Studies'],
  brief: '축의 시대 개념을 먼저 알면 좋습니다.',
  sections: [{ quote: 'The "Axial Age" was named', summary: '야스퍼스의 개념 소개' }, { quote: 'not in the text', summary: '버려질 요약' }],
  recap: ['핵심 1'], questions: ['질문 1'],
  cards: [
    { kind: 'term', difficulty: 1, quote: 'Axial Age', title: '축의 시대', gloss: '기원전 800~200년 무렵.', image_query: 'Axial Age Karl Jaspers' },
    { kind: 'person', difficulty: 2, quote: 'Karl Jaspers', title: '카를 야스퍼스', gloss: '독일 철학자.' },
    { kind: 'critique', difficulty: 4, quote: 'too  neat', title: '단일 시대론 비판', gloss: '시대 구분이 지나치게 깔끔하다는 비판.' },
    { kind: 'term', difficulty: 2, quote: 'Hallucinated phrase', title: '환각', gloss: '본문에 없음.' },
    { kind: 'unknown', difficulty: 2, quote: 'Buddha', title: '붓다', gloss: '종류 오류' },
    { kind: 'term', difficulty: 1, quote: 'Axial Age', title: '축의 시대', gloss: '중복' }
  ]
}

test('deck parsing keeps only items anchored in the chapter, tolerating quotes and whitespace', () => {
  const deck = parseCoachDeck(response, chapter)
  assert.deepEqual(deck.cards.map(card => card.title), ['축의 시대', '카를 야스퍼스', '단일 시대론 비판'])
  assert.equal(deck.sections.length, 1)
  assert.equal(deck.dropped, 2)
  assert.deepEqual(deck.domain, ['religious studies'])
  assert.equal(deck.cards[0].imageQuery, 'Axial Age Karl Jaspers')
  assert.match(deck.cards[0].id, /^[a-f0-9]{8}$/)
  assert.throws(() => parseCoachDeck([], chapter), /JSON/)
})

test('prompt marks the chapter as untrusted and carries the free request', () => {
  const prompt = buildCoachDeckPrompt({ bookTitle: 'B', chapterTitle: 'C', chapterText: 'text', request: '원어를 함께' })
  assert.match(prompt.system, /untrusted/)
  assert.match(prompt.user, /원어를 함께/)
  assert.match(prompt.user, /<chapter_text>\ntext\n<\/chapter_text>/)
  assert.notEqual(coachDeckCacheInput({ documentId: 'd', chapterHref: 'c.xhtml#x', part: 0 }, 'ko', ''), coachDeckCacheInput({ documentId: 'd', chapterHref: 'c.xhtml', part: 0 }, 'ko', 'new request'))
  assert.equal(coachDeckCacheInput({ documentId: 'd', chapterHref: 'c.xhtml#x', part: 0 }, 'ko', ''), coachDeckCacheInput({ documentId: 'd', chapterHref: 'c.xhtml', part: 0 }, 'ko', ' '))
})

test('selection differs by purpose and familiarity, not only in amount', () => {
  const deck = { ...parseCoachDeck(response, chapter), chapterHref: 'c.xhtml' }
  const novice = selectCoachCards(deck, { ...DEFAULT_COACH_PREFERENCES, purpose: 'study', familiarity: 'new' }, EMPTY_COACH_PROFILE)
  const expert = selectCoachCards(deck, { ...DEFAULT_COACH_PREFERENCES, purpose: 'critique', familiarity: 'familiar' }, EMPTY_COACH_PROFILE)
  assert.ok(novice.some(item => item.card.title === '축의 시대'))
  assert.ok(!expert.some(item => item.card.title === '축의 시대' && item.reason === 'match'))
  assert.ok(expert.some(item => item.card.kind === 'critique'))
  assert.deepEqual(selectCoachCards(deck, { ...DEFAULT_COACH_PREFERENCES, proactivity: 'onDemand' }, EMPTY_COACH_PROFILE), [])
  assert.deepEqual(selectCoachCards(deck, { ...DEFAULT_COACH_PREFERENCES, enabled: false }, EMPTY_COACH_PROFILE), [])
  const suppressed = new Set([novice[0].card.id])
  assert.ok(!selectCoachCards(deck, { ...DEFAULT_COACH_PREFERENCES, familiarity: 'new' }, EMPTY_COACH_PROFILE, { suppressed }).some(item => item.card.id === novice[0].card.id))
})

test('"already known" lowers that difficulty, "not interested" lowers that kind, within the explicit choice', () => {
  const preferences = { ...DEFAULT_COACH_PREFERENCES, purpose: 'study', familiarity: 'new' }
  const card = { kind: 'term', difficulty: 1 }
  const base = baseCardScore(card, preferences)
  let profile = EMPTY_COACH_PROFILE
  const now = Date.now()
  for (let index = 0; index < 8; index += 1) profile = applyCoachEvent(profile, { documentId: 'd', chapterHref: 'c', type: 'known', domain: ['history'], kind: 'term', difficulty: 1, at: now })
  const deck = { chapterHref: 'c', domain: ['history'], cards: [{ id: 'a', kind: 'term', difficulty: 1, quote: 'q', title: 't', gloss: 'g' }] }
  const [shown] = selectCoachCards(deck, preferences, EMPTY_COACH_PROFILE, { now })
  assert.equal(shown?.reason, 'match')
  const after = selectCoachCards(deck, preferences, profile, { now, day: 'x' })
  assert.ok(!after.some(item => item.reason === 'match'))
  assert.ok(profile.cells['d|history|low'].b > 0 && !profile.cells['k|history|term'])
  const kindProfile = applyCoachEvent(EMPTY_COACH_PROFILE, { documentId: 'd', chapterHref: 'c', type: 'notInterested', domain: ['history'], kind: 'person', difficulty: 2, at: now })
  assert.ok(kindProfile.cells['k|history|person'].b > 0 && !kindProfile.cells['d|history|low'])
  assert.ok(base > 0.5)
  assert.match(profileMismatch(preferences, profile, ['history'], now) ?? '', /조금 알아요/)
  assert.equal(estimatedLevels(profile, now)[0].domain, 'history')
  const missed = applyCoachEvent(EMPTY_COACH_PROFILE, { documentId: 'd', chapterHref: 'c', type: 'miss', domain: ['history'], at: now })
  assert.ok(missed.cells['d|history|low'].a > 0)
})

test('old evidence decays over time', () => {
  const preferences = { ...DEFAULT_COACH_PREFERENCES, familiarity: 'new' }
  const old = Date.now() - 365 * 86400000
  let profile = EMPTY_COACH_PROFILE
  for (let index = 0; index < 8; index += 1) profile = applyCoachEvent(profile, { documentId: 'd', chapterHref: 'c', type: 'known', domain: ['x'], kind: 'term', difficulty: 1, at: old })
  const deck = { chapterHref: 'c', domain: ['x'], cards: [{ id: 'a', kind: 'term', difficulty: 1, quote: 'q', title: 't', gloss: 'g' }] }
  assert.equal(selectCoachCards(deck, preferences, profile)[0]?.reason, 'match')
})

test('briefing, preferences sanitizing, and long chapter parts', () => {
  assert.equal(showsBriefing({ ...DEFAULT_COACH_PREFERENCES, proactivity: 'quiet' }), false)
  assert.equal(showsBriefing({ ...DEFAULT_COACH_PREFERENCES, purpose: 'skim' }), true)
  assert.equal(showsBriefing({ ...DEFAULT_COACH_PREFERENCES, proactivity: 'suggest' }), true)
  const clean = sanitizePreferences({ purpose: 'evil', familiarity: 'new', proactivity: 'suggest', enabled: false, request: 1 })
  assert.deepEqual([clean.purpose, clean.familiarity, clean.proactivity, clean.enabled, clean.request], ['study', 'new', 'suggest', false, ''])
  const long = Array.from({ length: 30 }, (_, index) => `Paragraph ${index} ${'word '.repeat(400)}`).join('\n\n')
  const parts = splitChapterText(long, 6000)
  assert.equal(parts.length, 3)
  assert.equal(partForVisibleText(parts, 'Paragraph 29 word word'), 2)
  assert.equal(partForVisibleText(parts, 'nowhere'), 0)
})

test('Wikipedia article matching rejects unrelated or special pages', () => {
  assert.deepEqual(wikipediaArticle('https://en.wikipedia.org/wiki/Karl_Jaspers'), { lang: 'en', title: 'Karl_Jaspers' })
  assert.equal(wikipediaArticle('https://en.wikipedia.org/wiki/File:Jaspers.jpg'), null)
  assert.equal(wikipediaArticle('https://evil.org/wiki/Karl_Jaspers'), null)
  assert.equal(wikipediaTitleMatches('Karl_Jaspers', { title: '카를 야스퍼스', imageQuery: 'Karl Jaspers philosopher' }), true)
  assert.equal(wikipediaTitleMatches('Axial Age', { title: '축의 시대', imageQuery: 'Axial Age Karl Jaspers' }), true)
  assert.equal(wikipediaTitleMatches('Jaspers (band)', { title: '카를 야스퍼스', imageQuery: 'Karl Jaspers philosopher' }), true)
  assert.equal(wikipediaTitleMatches('Confucianism in Korea', { title: '카를 야스퍼스', imageQuery: 'Karl Jaspers philosopher' }), false)
})

test('TinyFish search can be restricted to Wikipedia', async () => {
  await searchTinyFishWeb('Karl Jaspers', 'key', { includeDomains: ['wikipedia.org', 'bad domain'], fetchImpl: async (url) => {
    assert.equal(new URL(url).searchParams.get('include_domains'), 'wikipedia.org')
    return Response.json({ results: [] })
  } })
})

test('picture lookup: TinyFish finds the article, Wikipedia supplies the picture', async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push(String(url))
    if (String(url).startsWith('https://api.search.tinyfish.ai')) {
      assert.equal(new URL(url).searchParams.get('include_domains'), 'wikipedia.org')
      return Response.json({ results: [{ url: 'https://en.wikipedia.org/wiki/Karl_Jaspers', title: 'Karl Jaspers - Wikipedia' }] })
    }
    if (String(url).includes('/api/rest_v1/page/summary/')) {
      assert.match(init.headers['User-Agent'], /MD-Reader/)
      return Response.json({ type: 'standard', title: 'Karl Jaspers', thumbnail: { source: 'https://upload.wikimedia.org/k.jpg' }, content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Karl_Jaspers' } } })
    }
    return new Response(png, { headers: { 'content-type': 'image/jpeg' } })
  }
  const search = (fetchImpl) => (query, signal) => searchTinyFishWeb(query, 'key', { fetchImpl, signal, includeDomains: ['wikipedia.org'] })
  const found = await findWikipediaImage({ title: '카를 야스퍼스', imageQuery: 'Karl Jaspers philosopher' }, search(fetchImpl), { fetchImpl })
  assert.equal(found.pageTitle, 'Karl Jaspers')
  assert.equal(found.pageUrl, 'https://en.wikipedia.org/wiki/Karl_Jaspers')
  assert.deepEqual([...found.bytes], [...png])
  assert.equal(calls.length, 3)

  const offHost = async (url) => String(url).startsWith('https://api.search') ? Response.json({ results: [{ url: 'https://en.wikipedia.org/wiki/Karl_Jaspers' }] })
    : Response.json({ type: 'standard', title: 'Karl Jaspers', thumbnail: { source: 'https://evil.example/k.jpg' } })
  assert.equal(await findWikipediaImage({ title: 't', imageQuery: 'Karl Jaspers' }, search(offHost), { fetchImpl: offHost }), null)
  const disambiguation = async (url) => String(url).startsWith('https://api.search') ? Response.json({ results: [{ url: 'https://en.wikipedia.org/wiki/Karl_Jaspers' }] })
    : Response.json({ type: 'disambiguation', title: 'Karl Jaspers', thumbnail: { source: 'https://upload.wikimedia.org/k.jpg' } })
  assert.equal(await findWikipediaImage({ title: 't', imageQuery: 'Karl Jaspers' }, search(disambiguation), { fetchImpl: disambiguation }), null)
  const unrelated = async () => Response.json({ results: [{ url: 'https://en.wikipedia.org/wiki/Tokyo' }] })
  assert.equal(await findWikipediaImage({ title: 't', imageQuery: 'Karl Jaspers' }, search(unrelated), { fetchImpl: unrelated }), null)
})

test('phase 5: term keys match across books, review intervals expand, profile summary', () => {
  assert.equal(coachTermKey({ quote: 'The  “Axial Age”', title: '축의 시대' }), coachTermKey({ quote: '"axial age"', title: 'Axial' }))
  assert.deepEqual([1, 3, 7, 16, 35, 80].map(days => nextReviewInterval(days, true)), [3, 7, 16, 35, 80, 176])
  assert.equal(nextReviewInterval(0, true), 1)
  assert.equal(nextReviewInterval(35, false), 1)
  const now = Date.now()
  let profile = EMPTY_COACH_PROFILE
  for (let index = 0; index < 4; index += 1) {
    profile = applyCoachEvent(profile, { documentId: 'd', chapterHref: 'c', type: 'known', domain: ['philosophy'], kind: 'term', difficulty: 2, at: now })
    profile = applyCoachEvent(profile, { documentId: 'd', chapterHref: 'c', type: 'more', domain: ['philosophy'], kind: 'critique', difficulty: 4, at: now })
    profile = applyCoachEvent(profile, { documentId: 'd', chapterHref: 'c', type: 'notInterested', domain: ['philosophy'], kind: 'place', difficulty: 3, at: now })
  }
  const lines = summarizeCoachProfile(profile, now)
  assert.ok(lines.some(line => /philosophy: (intermediate|advanced)/.test(line)), lines.join('\n'))
  assert.ok(lines.some(line => /useful: .*critique \(philosophy\)/.test(line)))
  assert.ok(lines.some(line => /Does not want .*place \(philosophy\)/.test(line)))
  assert.deepEqual(summarizeCoachProfile(EMPTY_COACH_PROFILE, now), [])
})

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  mergeAndReindexSources,
  prepareEnglishSearchQuery,
  selectRelevantExcerpt
} from '../src/main/web-research.ts'

test('translates Korean and mixed reading context before sending an English query to TinyFish', async () => {
  const { searchTinyFishWeb } = await import('../src/main/tinyfish-web-search-service.ts')
  const request = '작업 기억에 대한 tDCS의 효과를 다룬 논문을 찾아줘 context: 인지 신경과학'
  const query = await prepareEnglishSearchQuery(request, async input => {
    assert.equal(JSON.parse(input).researchRequest, request)
    return JSON.stringify({ query: '  tDCS   working memory randomized controlled trial systematic review  ' })
  })
  await searchTinyFishWeb(query, 'test-key', { fetchImpl: async url => {
    const params = new URL(url).searchParams
    assert.equal(params.get('query'), 'tDCS working memory randomized controlled trial systematic review')
    assert.equal(params.get('language'), 'en')
    assert.doesNotMatch(params.get('query'), /\p{Script=Hangul}/u)
    return Response.json({ results: [] })
  } })
})

test('retries an untranslated mixed query instead of dropping Korean terms', async () => {
  let calls = 0
  const query = await prepareEnglishSearchQuery('tDCS 작업 기억 근거', async input => {
    calls++
    if (calls === 1) return JSON.stringify({ query: 'tDCS 작업 기억 evidence' })
    assert.match(JSON.parse(input).correction, /English/)
    return JSON.stringify({ query: 'tDCS working memory evidence' })
  })
  assert.equal(query, 'tDCS working memory evidence')
  assert.equal(calls, 2)
})

test('invalid translations fail after one retry without returning the original question', async () => {
  for (const output of ['not JSON', 'null', '{}', '{"query":42}', '{"query":""}', '{"query":"한국어 검색"}', JSON.stringify({ query: 'a'.repeat(501) })]) {
    let calls = 0
    await assert.rejects(prepareEnglishSearchQuery('한국어 질문', async () => {
      calls++
      return output
    }), /English search query/)
    assert.equal(calls, 2)
  }
})

test('preserves English names, scientific terms, dates, and qualifiers', async () => {
  const expected = 'Goethe Christiane Vulpius marriage 1806 first wife biography'
  assert.equal(await prepareEnglishSearchQuery('괴테의 첫 결혼은 언제?', async () => JSON.stringify({ query: expected })), expected)
})

test('translation provider errors and cancellation never fall back to raw input', async () => {
  await assert.rejects(prepareEnglishSearchQuery('한국어 질문', async () => { throw new Error('provider unavailable') }), /provider unavailable/)
  await assert.rejects(prepareEnglishSearchQuery('한국어 질문', async () => { assert.fail('must not call a canceled provider') }, AbortSignal.abort()), { name: 'AbortError' })
  const controller = new AbortController()
  await assert.rejects(prepareEnglishSearchQuery('한국어 질문', async (_input, signal) => {
    assert.equal(signal, controller.signal)
    controller.abort()
    return '{"query":"working memory"}'
  }, controller.signal), { name: 'AbortError' })
})

test('selects answer-bearing passages instead of a generic page introduction', () => {
  const content = `Johann Wolfgang von Goethe was a German writer, poet, scientist, and statesman. His work influenced European literature for generations.

Goethe met Christiane Vulpius in 1788. They lived together for many years and married in 1806. Christiane was Goethe's first and only legal wife.

Goethe also conducted research in botany, anatomy, optics, and mineralogy.`

  const excerpt = selectRelevantExcerpt(
    content,
    'Did Goethe have a wife before Christiane Vulpius',
    '괴테는 크리스티아네를 만나기 전에 원래 부인은 없었나?',
    500
  )

  assert.match(excerpt, /first and only legal wife/)
  assert.doesNotMatch(excerpt, /botany/)
})

test('deduplicates follow-up results and assigns stable citation ids', () => {
  const merged = mergeAndReindexSources(
    [
      { id: 'S1', title: 'Biography', url: 'https://example.com/goethe', snippet: 'First result' },
      { id: 'S2', title: 'Archive', url: 'https://archive.example/goethe', snippet: 'Archive result' }
    ],
    [
      { id: 'S1', title: 'Duplicate', url: 'https://example.com/goethe#life', snippet: 'Duplicate result' },
      { id: 'S2', title: 'Marriage record', url: 'https://records.example/marriage', snippet: 'Marriage result' }
    ]
  )

  assert.deepEqual(merged.map((source) => source.id), ['S1', 'S2', 'S3'])
  assert.deepEqual(merged.map((source) => source.title), ['Biography', 'Archive', 'Marriage record'])
})

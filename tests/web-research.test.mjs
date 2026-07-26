import assert from 'node:assert/strict'
import test from 'node:test'
import {
  mergeAndReindexSources,
  selectRelevantExcerpt
} from '../src/main/web-research.ts'

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

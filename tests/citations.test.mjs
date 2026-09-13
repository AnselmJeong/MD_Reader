import assert from 'node:assert/strict'
import test from 'node:test'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkRehype from 'remark-rehype'
import rehypeStringify from 'rehype-stringify'
import { remarkCitations } from '../src/renderer/src/components/DocumentReader/utils/remarkCitations.ts'
import { buildBibIndex, formatBibEntry } from '../src/renderer/src/components/DocumentReader/utils/bibtex.ts'

const render = (source) => String(unified().use(remarkParse).use(remarkGfm).use(remarkMath)
  .use(remarkCitations).use(remarkRehype).use(rehypeStringify).processSync(source))

test('renders each grouped citation as an IEEE number with its own hover target', () => {
  const source = '정리 [@strogatz2015; @izhikevich2007; @rabinovich2006]에 따른다.'
  const html = render(source)
  const keys = [...html.matchAll(/data-cite-key="([^"]+)"/g)].map((match) => match[1])
  assert.deepEqual(keys, ['strogatz2015', 'izhikevich2007', 'rabinovich2006'])
  assert.equal((html.match(/tabindex="0"/g) || []).length, 3)
  assert.equal(html.replace(/<[^>]+>/g, ''), '정리 [1], [2], [3]에 따른다.')
  const index = buildBibIndex('@book{strogatz2015, title={Nonlinear Dynamics and Chaos}, year={2015}}')
  assert.equal(formatBibEntry(index.byKey[keys[0]]), 'Nonlinear Dynamics and Chaos (2015)')
})

test('supports narrative, author-suppressed, locator, and punctuated citation keys', () => {
  const html = render('@Smith2024 states [-@doe:2023-a, pp. 12–14; @other_2022].')
  assert.deepEqual([...html.matchAll(/data-cite-key="([^"]+)"/g)].map((m) => m[1]), ['Smith2024', 'doe:2023-a', 'other_2022'])
  assert.equal(html.replace(/<[^>]+>/g, ''), '[1] states [2, pp. 12–14], [3].')
})

test('reuses numbers across paragraphs and formatting and resets for each document', () => {
  const html = render('[@b; @a]\n\n**Again [@B]** and @c, then [@a].')
  assert.equal(html.replace(/<[^>]+>/g, ''), '[1], [2]\nAgain [1] and [3], then [2].')
  assert.equal(render('[@c]').replace(/<[^>]+>/g, ''), '[1]')
})

test('preserves locators and prefixes without doubling brackets or changing ordinary bracketed prose', () => {
  const html = render('[see @smith2024, p. 8; @jones2023, ch. 2] [ordinary text] [-@smith2024].')
  assert.equal(html.replace(/<[^>]+>/g, ''), 'see [1, p. 8], [2, ch. 2] [ordinary text] [1].')
})

test('excluded code and links do not consume citation numbers', () => {
  const html = render('`@code` [@link](https://example.com) $@math$\n\n[@actual]')
  assert.match(html, /data-cite-key="actual" tabindex="0">\[1\]/)
})

test('citation-leading paragraphs opt out of decorative drop caps', () => {
  assert.match(render('[@smith2024] states this.'), /<p data-citation-leading/)
  assert.ok(!render('See [@smith2024].').includes('data-citation-leading'))
})

test('leaves code, math, email addresses, and existing links untouched', () => {
  for (const source of [
    '`[@smith2024]`', '```md\n[@smith2024]\n```', '$@smith2024$',
    'name@example.com', '[@smith2024](#ref-smith2024)',
    '[@smith2024][ref]\n\n[ref]: https://example.com',
    '![alt @smith2024](image.png)', '<https://example.com/@smith2024>'
  ]) assert.ok(!render(source).includes('data-cite-key'), source)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeStringify from 'rehype-stringify'
import { remarkKoreanStrong } from '../src/renderer/src/components/DocumentReader/utils/remarkKoreanStrong.ts'

const processor = (korean) => {
  const instance = unified().use(remarkParse)
  if (korean) instance.use(remarkKoreanStrong)
  return instance.use(remarkMath).use(remarkGfm).use(remarkRehype).use(rehypeStringify)
}
const render = (text) => String(processor(true).processSync(text))

test('closes bold terms ending with punctuation before Korean suffixes', () => {
  assert.equal(render('**지배 고유값(dominant eigenvalue)**이라'), '<p><strong>지배 고유값(dominant eigenvalue)</strong>이라</p>')
  assert.equal(render('**동역학계(dynamical system)**란'), '<p><strong>동역학계(dynamical system)</strong>란</p>')
  assert.equal(render('**“인용문”**은 **[용어]**를'), '<p><strong>“인용문”</strong>은 <strong>[용어]</strong>를</p>')
})

test('keeps neighboring strong terms and inline mathematical symbols separate', () => {
  const text = "**동역학계(dynamical system)**란, 어떤 계의 모음인 **상태벡터(state vector) x ∈ ℝⁿ**(실수 n개)와 규칙 d**x**/dt = **F**(**x**; θ, **u**)의 짝이다. **상태공간(state space)**에 그려지는 곡선을 **궤적(trajectory)**이라 한다."
  const html = render(text)
  assert.equal((html.match(/<strong>/g) || []).length, 8)
  assert.ok(!html.includes('**'))
  assert.match(html, /<strong>동역학계\(dynamical system\)<\/strong>란, 어떤 계의 모음인/)
  assert.match(html, /d<strong>x<\/strong>\/dt/)
  assert.match(html, /<strong>궤적\(trajectory\)<\/strong>이라/)
})

test('preserves normal Markdown, literal escapes, code, math, and link destinations', () => {
  const cases = [
    '**plain** and **한글**은', '*italic* and ***both***', '__other__',
    '**parenthesis)**English', 'unclosed)**는',
    '`**괄호(term)**는`', '````md\n**괄호(term)**는\n````',
    '    **괄호(term)**는', '\\*\\*괄호(term)\\*\\*는',
    '$**괄호(term)**는$', '$$\n**괄호(term)**는\n$$',
    '[link](https://example.com/**term**한글)', '![alt **term**](image.png)',
    '| 열 |\n| --- |\n| **한글** |'
  ]
  for (const text of cases) assert.equal(render(text), String(processor(false).processSync(text)), text)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkMath from 'remark-math'
import remarkRehype from 'remark-rehype'
import rehypeKatex from 'rehype-katex'
import rehypeStringify from 'rehype-stringify'
import { normalizeMathDelimiters, remarkLegacyChatMath } from '../src/renderer/src/components/ChatPanel/utils/chatMath.ts'
import { AI_MATH_FORMAT_INSTRUCTIONS } from '../src/shared/ai-prompts.ts'
const render = (s) => String(unified().use(remarkParse).use(remarkMath).use(remarkLegacyChatMath).use(remarkRehype).use(rehypeKatex).use(rehypeStringify).processSync(normalizeMathDelimiters(s)))
test('standard and alternate delimiters render inline and display KaTeX',()=>{
  for(const source of [String.raw`$w_{ij}=w_{ji}$`,String.raw`\(w_{ij}=w_{ji}\)`]) assert.match(render(source), /class="katex"/)
  for(const source of ['$$\nE = -\\frac{1}{2}\\sum_{i,j} w_{ij}s_i s_j\n$$',String.raw`\[E = -\frac{1}{2}\sum_{i,j} w_{ij}s_i s_j\]`]) assert.match(render(source), /katex-display/)
})
test('the saved unmarked Hopfield answer renders without editing the stored message',()=>{
  const source='수식으로 쓰면 w_ij = w_ji. 자기결합(w_ii = 0).\n\nE = −(1/2) Σ_ij w_ij s_i s_j\n\n인데, s_i s_j = s_j s_i이므로'
  const html=render(source)
  assert.match(html,/katex-display/)
  assert.match(html,/w_\{ij\} = w_\{ji\}/)
  assert.match(html,/\\sum_\{ij\}/)
  assert.ok(!html.includes('katex-error'))
  assert.ok(source.includes('Σ_ij'))
})
test('ordinary prose, source markers, file names, code and incomplete delimiters stay literal',()=>{
  for(const source of ['normal_file_name [S1] 비용 20원', '`w_ij = w_ji`', '```python\nw_ij = w_ji\n```',String.raw`\(unfinished`,String.raw`~~~text
\(w_{ij}\)
~~~`]) assert.ok(!render(source).includes('class="katex"'),source)
})
test('new replies are explicitly instructed to use LaTeX math delimiters',()=>{
 assert.match(AI_MATH_FORMAT_INSTRUCTIONS,/KaTeX/)
 assert.ok(AI_MATH_FORMAT_INSTRUCTIONS.includes('$w_{ij}=w_{ji}$'))
})

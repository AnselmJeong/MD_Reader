import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkRehype from 'remark-rehype'
import rehypeStringify from 'rehype-stringify'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import { prepareQuartoSource, remarkQuarto } from '../src/renderer/src/components/DocumentReader/utils/remarkQuarto.ts'
import { remarkCitations } from '../src/renderer/src/components/DocumentReader/utils/remarkCitations.ts'
import { authorNames, readDocumentMetadata, splitFrontmatter } from '../src/shared/document-metadata.ts'
import { readDocumentImage } from '../src/main/document-image-service.ts'

const render = source => String(unified().use(remarkParse).use(remarkGfm).use(remarkMath)
  .use(remarkQuarto).use(remarkCitations).use(remarkRehype).use(rehypeKatex)
  .use(rehypeHighlight, { detect: true }).use(rehypeStringify)
  .processSync(prepareQuartoSource(splitFrontmatter(source).body)))

test('parses BOM/CRLF YAML and structured authors without changing the source', () => {
  const source = '\uFEFF---\r\ntitle: QMD\r\nauthor:\r\n  - name: Kim\r\n    affiliations: University\r\n  - name:\r\n      given: Jane\r\n      family: Doe\r\n...\r\n# Body'
  assert.equal(readDocumentMetadata(source).title, 'QMD')
  assert.equal(authorNames(readDocumentMetadata(source).author), 'Kim, Jane Doe')
  assert.equal(splitFrontmatter(source).body, '# Body')
  assert.ok(!render(source).includes('affiliations'))
  assert.deepEqual(readDocumentMetadata('---\n[not: valid\n---'), {})
  assert.equal(authorNames(readDocumentMetadata('---\nauthor: &author\n  name: *author\n---').author), '')
  assert.equal(splitFrontmatter('---\nno closing fence').body, '---\nno closing fence')
})

test('resolves forward sections/figures/tables before bibliography citations', () => {
  const html = render('See @sec-intro, [@fig-elephant; @tbl-data], -@fig-elephant, and [@smith2024].\n\n# Introduction {#sec-intro}\n\n![An elephant](elephant.png){#fig-elephant width="50%" fig-alt="Side view"}\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n: Data *caption* {#tbl-data}')
  assert.match(html, /<h1 id="sec-intro">Introduction<\/h1>/)
  assert.match(html, /href="#sec-intro"[^>]*>Introduction<\/a>/)
  assert.match(html, /href="#fig-elephant"[^>]*>Figure 1<\/a>/)
  assert.match(html, /href="#tbl-data"[^>]*>Table 1<\/a>/)
  assert.match(html, /<figure id="fig-elephant"/)
  assert.match(html, /alt="Side view"/)
  assert.match(html, /width:50%/)
  assert.match(html, /<figcaption>Figure 1: An elephant<\/figcaption>/)
  assert.match(html, /<figcaption>Table 1: Data <em>caption<\/em><\/figcaption>/)
  assert.match(html, /data-cite-key="smith2024" tabindex="0">\[1\]/)
  assert.doesNotMatch(html, /data-cite-key="(?:sec|fig|tbl)-/)
})

test('preserves missing targets, code, math, emails and explicit links', () => {
  const html = render('@fig-missing and `@fig-code`, name@example.com, $@fig-math$, [@fig-link](https://example.com), then @paper.\n\n```{python}\n#| label: fig-code\nprint("@fig-literal")\n```')
  assert.match(html, /quarto-unresolved-ref/)
  assert.match(html, /@fig-missing/)
  assert.match(html, /language-python/)
  assert.match(html, /fig-code/)
  assert.match(html, /data-cite-key="paper" tabindex="0">\[1\]/)
  assert.equal((html.match(/data-cite-key=/g) ?? []).length, 1)
  assert.ok(!render('```{r}\n#| echo: false\nplot(1)\n```').includes('Failed'))
})

test('supports nested fenced callouts and labelled table divs', () => {
  const source = '::: {.callout-note}\n## Note\nText\n:::: {#tbl-div}\n| A |\n|---|\n| 1 |\n\nA caption.\n::::\nMore text.\n:::\n\nSee @tbl-div.'
  const html = render(source)
  assert.match(html, /class="callout callout-note"/)
  assert.match(html, /<figure id="tbl-div"/)
  assert.match(html, /Table 1: A caption/)
  assert.match(html, /href="#tbl-div"/)
  assert.doesNotMatch(html, /:::/)
  const code = '````markdown\n::: {.callout-note}\n```\n::: stay literal\n````'
  assert.equal(prepareQuartoSource(code), code)
  assert.match(render(code), /callout-note/)
  assert.doesNotMatch(render(code), /<div class="callout/)
})

test('supports setext headings, Unicode IDs, and repeated automatic IDs', () => {
  const html = render('분석 {#sec-분석}\n===\n\n## Résumé\n\n## Résumé\n\nSee @sec-분석.')
  assert.match(html, /id="sec-분석"/)
  assert.match(html, /id="résumé"/)
  assert.match(html, /id="résumé-1"/)
  assert.match(html, /href="#sec-%EB%B6%84%EC%84%9D"/)
})

test('reads local encoded images relative to the document, rejects non-images and missing files', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qmd-image-'))
  try {
    await fs.mkdir(path.join(dir, 'images'))
    await fs.writeFile(path.join(dir, 'images', '한 글.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    assert.match(await readDocumentImage(path.join(dir, 'paper.qmd'), 'images/%ED%95%9C%20%EA%B8%80.svg'), /^data:image\/svg\+xml;base64,/)
    assert.equal(await readDocumentImage(path.join(dir, 'paper.qmd'), 'missing.png'), null)
    assert.equal(await readDocumentImage(path.join(dir, 'paper.qmd'), 'paper.qmd'), null)
    assert.equal(await readDocumentImage(path.join(dir, 'paper.qmd'), 'https://example.com/a.png'), null)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})


test('resolves references followed by Korean particles while preserving unknown longer IDs', () => {
  const html = render('# 소개 {#sec-intro}\n\n![추세](plot.png){#fig-trend}\n\n@fig-trend와 @sec-intro로 이동합니다. @fig-trend-missing stays unresolved.')
  assert.match(html, /href="#fig-trend"[^>]*>Figure 1<\/a>와/)
  assert.match(html, /href="#sec-intro"[^>]*>소개<\/a>로/)
  assert.match(html, /@fig-trend-missing<\/span>/)
})

test('renders image captions without IDs, reference-style images, and captions above tables', () => {
  const html = render('![Plain caption](a.png){width=200}\n\n![Reference caption][image]{#fig-reference}\n\n[image]: b.png\n\nTable: Top caption {#tbl-top}\n\n| A |\n|---|\n| 1 |\n\n@tbl-top')
  assert.match(html, /<figcaption>Plain caption<\/figcaption>/)
  assert.match(html, /width:200px/)
  assert.match(html, /src="b.png"/)
  assert.match(html, /<figcaption>Figure 1: Reference caption<\/figcaption>/)
  assert.match(html, /<figcaption>Table 1: Top caption<\/figcaption>/)
})


test('highlights prose while preserving markers inside tilde-fenced cells and inline code', () => {
  const html = render('==Important text== and `==literal code==`\n\n~~~{python}\n#| echo: false\nprint("==unchanged==")\n~~~')
  assert.match(html, /<mark>Important text<\/mark>/)
  assert.match(html, /<code>==literal code==<\/code>/)
  assert.match(html, /==unchanged==/)
  assert.equal((html.match(/<mark>/g) ?? []).length, 1)
})

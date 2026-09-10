import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readBibliography } from '../src/main/bibliography-service.ts'
import { buildBibIndex, findBibEntryForExternalLink, findBibEntryForInternalLink, formatBibEntry, getDoiUrl } from '../src/renderer/src/components/DocumentReader/utils/bibtex.ts'

test('custom bibliography overrides siblings, reset restores automatic selection, and missing custom never silently falls back', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'md-reader-bib-'))
  try {
    const document = path.join(dir, 'paper.md')
    const sibling = path.join(dir, 'paper.bib')
    const custom = path.join(dir, 'elsewhere', 'library.bib')
    await fs.mkdir(path.dirname(custom))
    await fs.writeFile(sibling, 'sibling bibliography')
    await fs.writeFile(path.join(dir, 'a.bib'), 'fallback bibliography')
    await fs.writeFile(custom, 'custom bibliography')
    assert.equal((await readBibliography(document)).bibFilePath, sibling)
    const selected = await readBibliography(document, custom)
    assert.equal(selected.bibContent, 'custom bibliography')
    assert.equal(selected.customBibFilePath, custom)
    assert.equal((await readBibliography(document)).bibContent, 'sibling bibliography')
    await fs.unlink(custom)
    const missing = await readBibliography(document, custom)
    assert.equal(missing.bibContent, null)
    assert.equal(missing.customBibFilePath, custom)
    assert.match(missing.bibError, /Could not read bibliography/)
    await fs.unlink(sibling)
    assert.equal((await readBibliography(document)).bibContent, 'fallback bibliography')
    await fs.unlink(path.join(dir, 'a.bib'))
    assert.equal((await readBibliography(document)).bibError, null)
    assert.equal((await readBibliography(document)).bibFilePath, null)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('citation titles retain nested braces and DOI links resolve by key or DOI', () => {
  const index = buildBibIndex(`@article{Smith2024,
    title = {A {Nested} Title for {EEG}},
    author = {Smith, Jane and Doe, John},
    year = 2024,
    doi = {https://dx.doi.org/10.1234/Example}
  }
  @article{NoDoi, title = "A paper without DOI"}`)
  const entry = findBibEntryForInternalLink('ref-Smith2024', index)
  assert.equal(formatBibEntry(entry), 'A Nested Title for EEG (2024)')
  assert.equal(getDoiUrl(entry.doi), 'https://doi.org/10.1234/Example')
  assert.equal(findBibEntryForExternalLink('https://doi.org/10.1234/example', '', index), entry)
  assert.equal(findBibEntryForExternalLink('https://example.com/paper', 'Smith et al. (2024)', index), entry)
  assert.equal(getDoiUrl(findBibEntryForInternalLink('NoDoi', index).doi), null)
  assert.equal(findBibEntryForInternalLink('unknown', index), null)
})

test('DOI normalization supports prefixes and encoded identifiers without changing the URL host', () => {
  assert.equal(getDoiUrl(' doi:10.1234/abc '), 'https://doi.org/10.1234/abc')
  assert.equal(getDoiUrl('https://doi.org/10.1234/abc%23x'), 'https://doi.org/10.1234/abc%23x')
  assert.equal(getDoiUrl('javascript:alert(1)'), null)
  assert.equal(getDoiUrl('https://example.com/10.1234/abc'), null)
  assert.equal(getDoiUrl('10.1234/with whitespace'), null)
  assert.equal(getDoiUrl(null), null)
})

// Run in Electron for the application's native SQLite ABI.
// npx esbuild tests/commentary-archive.smoke.ts --bundle --platform=node --external:electron --external:better-sqlite3 --outfile=.tmp/commentary-archive.cjs
// node_modules/.bin/electron .tmp/commentary-archive.cjs
import { app } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import JSZip from 'jszip'
import { compileCommentaryEpub, exportCommentaryEpub, readCommentaryEpub, commentaryExportPath } from '../src/main/commentary-epub'
import { closeCommentaryDb, saveCommentary, listCommentary, importCommentarySnapshot } from '../src/main/commentary-service'
import { exportCoachArchive, importCoachArchive, getCoachUserDeck } from '../src/main/coach-service'
import { readDeck, readImportedDeck, writeDeck, writeImage, readImage, closeCoachDb } from '../src/main/coach-store'
import { coachImageStoreKey } from '../src/shared/coach'

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'md-reader-commentary-archive-'))
app.setPath('userData', fixture)
app.whenReady().then(async () => {
  try {
    const zip = new JSZip()
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
    zip.file('META-INF/container.xml', '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
    zip.file('OEBPS/book.opf', '<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">archive-test</dc:identifier><dc:title>Archive test</dc:title><dc:language>en</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest><spine toc="ncx"><itemref idref="chapter"/></spine></package>')
    zip.file('OEBPS/chapter.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Source</title></head><body><p id="first">First paragraph.</p><p id="second">Second paragraph.</p></body></html>')
    zip.file('OEBPS/toc.ncx', '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="archive-test"/></head><docTitle><text>Archive test</text></docTitle><navMap><navPoint id="chapter" playOrder="1"><navLabel><text>Source</text></navLabel><content src="chapter.xhtml"/></navPoint></navMap></ncx>')
    const original = await zip.generateAsync({ type: 'nodebuffer' })
    const documentId = createHash('sha256').update(original).digest('hex')
    const anchor = { chapterHref: 'chapter.xhtml', path: [0], quote: 'First paragraph.', tagName: 'p' }
    const root = saveCommentary({ documentId, parentId: null, anchor, markdown: 'An explanation: $E=mc^2$' })
    const child = saveCommentary({ documentId, parentId: root.id, anchor, markdown: 'A reply.' })
    const moved = saveCommentary({ ...root, anchor: { ...anchor, path: [1], quote: 'Second paragraph.' }, expectedUpdatedAt: root.updatedAt })
    assert.equal(listCommentary(documentId).notes.find(note => note.id === child.id)!.anchor.quote, 'Second paragraph.')
    assert.throws(() => saveCommentary({ ...root, markdown: 'Stale edit', expectedUpdatedAt: root.updatedAt }), /다른 창/)
    const baseline = listCommentary(documentId)
    assert.throws(() => importCommentarySnapshot(documentId, { ...baseline, notes: baseline.notes.map(note => ({ ...note, parentId: note.id })) }), /순환/)
    assert.deepEqual(listCommentary(documentId), baseline)
    // An incoming valid tree can conflict with a newer local parent revision.
    assert.throws(() => importCommentarySnapshot(documentId, { assets: [], notes: [
      { ...moved, parentId: child.id, updatedAt: moved.updatedAt + 100 },
      { ...child, parentId: null }
    ] }), /병합한 답글 관계/)
    assert.deepEqual(listCommentary(documentId), baseline)
    assert.throws(() => importCommentarySnapshot(documentId, { notes: [{ ...moved, markdown: 'Must not persist', updatedAt: moved.updatedAt + 100 }], assets: [{ id: '0'.repeat(64), name: 'bad.png', dataUrl: 'data:image/png;base64,YmFk' }] }), /그림 검증/)
    assert.deepEqual(listCommentary(documentId), baseline)
    const portable = await compileCommentaryEpub(original, baseline)
    const packed = await JSZip.loadAsync(portable)
    const opf = await packed.file('OEBPS/book.opf')!.async('string')
    assert.ok(opf.includes('version="3.0"')); assert.ok(opf.includes('properties="nav"'))
    assert.ok((await packed.file('OEBPS/chapter.xhtml')!.async('string')).includes('MathML'))
    assert.deepEqual(await readCommentaryEpub(portable, false), original)
    const sourcePath = path.join(fixture, 'source.epub'); fs.writeFileSync(sourcePath, original)
    await assert.rejects(exportCommentaryEpub(sourcePath, sourcePath, documentId), /다른 파일 이름/)
    fs.symlinkSync(fixture, path.join(fixture, 'alias'))
    await assert.rejects(exportCommentaryEpub(sourcePath, path.join(fixture, 'alias/source.epub'), documentId), /다른 파일 이름/)
    assert.deepEqual(fs.readFileSync(sourcePath), original)
    assert.equal(commentaryExportPath('/books/book.epub'), '/books/book-annotated.epub')
    assert.equal(commentaryExportPath('/books/book-annotated.epub'), '/books/book-annotated.epub')
    assert.equal(commentaryExportPath('/books/book-annotated-annotated.EPUB'), '/books/book-annotated.epub')
    assert.equal(commentaryExportPath('/books/annotated-theory.epub'), '/books/annotated-theory-annotated.epub')
    const spoof = path.join(fixture, 'original-annotated.epub')
    fs.writeFileSync(spoof, original)
    await assert.rejects(exportCommentaryEpub(spoof, spoof, documentId), /다른 파일 이름/)
    const annotatedPath = path.join(fixture, 'book-annotated.epub')
    fs.writeFileSync(annotatedPath, portable)
    await exportCommentaryEpub(annotatedPath, annotatedPath, documentId)
    const resaved = fs.readFileSync(annotatedPath)
    assert.deepEqual(await readCommentaryEpub(resaved, false), original)
    const resavedZip = await JSZip.loadAsync(resaved)
    const resavedMetadata = JSON.parse(await resavedZip.file('MDReader-Commentary/commentary.json')!.async('string'))
    assert.deepEqual(resavedMetadata.notes, baseline.notes)
    assert.equal(Object.keys(resavedZip.files).filter(name => name.endsWith('original.epub')).length, 1)
    const alias = path.join(fixture, 'saved-alias.epub')
    fs.symlinkSync(annotatedPath, alias)
    await exportCommentaryEpub(alias, alias, documentId)
    assert.ok(fs.lstatSync(alias).isSymbolicLink())
    assert.deepEqual(await readCommentaryEpub(fs.readFileSync(annotatedPath), false), original)
    assert.deepEqual(fs.readFileSync(sourcePath), original)
    fs.writeFileSync(path.resolve('.tmp/commentary-epub2-export.epub'), portable)
    packed.file('MDReader-Commentary/original.epub', 'corrupted')
    await assert.rejects(readCommentaryEpub(await packed.generateAsync({ type: 'nodebuffer' })), /원본 EPUB 검증/)
    assert.deepEqual(listCommentary(documentId), baseline)

    // Coach cards travel in the book: footnotes for other readers, coach.json for MD Reader.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
    const coachCard = { id: '0000000a', kind: 'term' as const, difficulty: 3, quote: 'First paragraph', title: '첫 문단', gloss: '설명', imageQuery: 'first' }
    const userCard = { ...coachCard, id: '0000000b', quote: 'Second', title: '둘째', imageQuery: undefined }
    const generated = { key: 'a'.repeat(64), documentId, chapterHref: 'chapter.xhtml', part: 0, domain: [], brief: '', sections: [], recap: [], questions: [], cards: [coachCard], dropped: 0, model: 'm', createdAt: 1 }
    writeDeck(generated)
    writeDeck({ ...generated, key: 'c'.repeat(64), part: 999, cards: [userCard] })
    writeImage(coachImageStoreKey(coachCard), { status: 'ready', png, pageTitle: 'P', pageUrl: 'https://en.wikipedia.org/wiki/P', source: 'Wikipedia', createdAt: 1 })
    const coach = exportCoachArchive(documentId)
    assert.equal(coach.decks.length, 2)
    assert.equal(coach.images.length, 1)
    const withCoach = await compileCommentaryEpub(original, listCommentary(documentId), coach)
    const coachZip = await JSZip.loadAsync(withCoach)
    assert.match(await coachZip.file('OEBPS/chapter.xhtml')!.async('string'), /epub:type="noteref"[^>]*>First paragraph<\/a>/)
    // A second device: nothing local yet.
    closeCoachDb()
    app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'md-reader-coach-import-')))
    closeCommentaryDb()
    let imported = 0
    await readCommentaryEpub(withCoach, true, (id, archive) => { imported += importCoachArchive(id, archive).decks })
    assert.equal(imported, 2)
    assert.equal(readImportedDeck(documentId, 'chapter.xhtml', 0)!.cards[0].id, '0000000a')
    assert.equal(getCoachUserDeck(documentId, 'chapter.xhtml')!.cards[0].id, '0000000b')
    assert.equal(readImage(coachImageStoreKey(coachCard))!.status, 'ready')
    // Opening again adds nothing; a local deck is never replaced.
    imported = 0
    await readCommentaryEpub(withCoach, true, (id, archive) => { imported += importCoachArchive(id, archive).decks })
    assert.equal(imported, 0)
    assert.ok(readDeck('a'.repeat(64)))
    closeCoachDb()
    closeCommentaryDb()
    console.log('PASS: coach cards exported as footnotes and coach.json, imported once on another device.')
    console.log('PASS: EPUB 2 to portable EPUB 3; MathML/nav; root relocation; stale edit, merged cycles, corrupt images/original rejected; failed imports atomic; original overwrite prevented; single annotated suffix; verified annotated same-file and symlink resave with original and notes intact.')
    app.exit(0)
  } catch (error) { console.error(error); closeCommentaryDb(); app.exit(1) }
})

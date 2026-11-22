import type {
  BookDocument,
  BookMetadata,
  ReadingAnchor,
  ThemeMode,
  TypographySettings
} from '../../types/book';
import { parseEpubBuffer, type ParsedEpub } from './epubParser';
import {
  EpubPaginator,
  getMargins,
  LOGICAL_PAGE_HEIGHT,
  LOGICAL_PAGE_WIDTH,
  type PaginatedPage
} from './epubPaginator';
import { parseXhtmlToBlocks, type SemanticBlock } from './xhtmlParser';
import { renderPaginatedPageToCanvas, type PageMarkRect } from './canvasPageRenderer';
import { normalizeCoachText } from '../../../../../shared/coach';

export type { PageMarkRect };

/** Whitespace-free text of one chapter as laid out, with each character's place on the pages. */
export interface SpineTextIndex {
  text: string;
  positions: Array<{ page: number; line: number; run: number; char: number }>;
}

export interface QuoteEntry {
  cardId: string;
  quote: string;
  occurrence?: number;
}

/** Same comparison as the 2D coach marks: whitespace is ignored, quotes and dashes normalized. */
export const compactText = (text: string): string => normalizeCoachText(text).replace(/\s+/g, '');

/** Pixel size from a PNG, GIF, JPEG or WebP header, without decoding the image. */
export function readImageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const at = (i: number) => bytes[i] ?? 0;
  if (bytes.length > 24 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.length > 10 && at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46) {
    return { width: at(6) | (at(7) << 8), height: at(8) | (at(9) << 8) };
  }
  if (at(0) === 0xff && at(1) === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (at(i) !== 0xff) { i++; continue; }
      const marker = at(i + 1);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: (at(i + 5) << 8) | at(i + 6), width: (at(i + 7) << 8) | at(i + 8) };
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      i += 2 + ((at(i + 2) << 8) | at(i + 3));
    }
    return null;
  }
  if (bytes.length > 30 && at(0) === 0x52 && at(1) === 0x49 && at(8) === 0x57 && at(9) === 0x45) {
    const chunk = String.fromCharCode(at(12), at(13), at(14), at(15));
    if (chunk === 'VP8X') return { width: 1 + (at(24) | (at(25) << 8) | (at(26) << 16)), height: 1 + (at(27) | (at(28) << 8) | (at(29) << 16)) };
    if (chunk === 'VP8 ') return { width: (at(26) | (at(27) << 8)) & 0x3fff, height: (at(28) | (at(29) << 8)) & 0x3fff };
    if (chunk === 'VP8L') {
      const b = at(21) | (at(22) << 8) | (at(23) << 16) | (at(24) << 24);
      return { width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) };
    }
  }
  return null;
}

export function parseChapterDocument(xhtml: string): Document {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xhtml, 'application/xhtml+xml');
  if (doc.querySelector('parsererror') || !doc.body) return parser.parseFromString(xhtml, 'text/html');
  return doc;
}

export class EpubAdapter implements BookDocument {
  public readonly format = 'epub' as const;
  public readonly isReflowable = true;
  public readonly metadata: BookMetadata;

  private parsed: ParsedEpub;
  private chapters: Array<{ spineIndex: number; chapterTitle: string; blocks: SemanticBlock[] }>;
  private paginator: EpubPaginator;
  private pages: PaginatedPage[] = [];
  private spineStartPage = new Map<number, number>();
  private settings: TypographySettings;
  private bitmapCache = new Map<string, ImageBitmap>();
  private textIndexCache = new Map<number, SpineTextIndex>();
  private chapterDocs = new Map<number, Document>();
  private marksByPage = new Map<number, PageMarkRect[]>();
  private markColor = '#3b6fb6';
  private measureCtx: CanvasRenderingContext2D | null = null;

  private constructor(
    parsed: ParsedEpub,
    chapters: Array<{ spineIndex: number; chapterTitle: string; blocks: SemanticBlock[] }>,
    settings: TypographySettings
  ) {
    this.parsed = parsed;
    this.chapters = chapters;
    this.metadata = parsed.metadata;
    this.settings = { ...settings };
    this.paginator = new EpubPaginator();
    this.runPagination();
  }

  public static async fromBuffer(
    buffer: ArrayBuffer,
    initialSettings: TypographySettings
  ): Promise<EpubAdapter> {
    const parsed = await parseEpubBuffer(buffer);
    const chapters: Array<{ spineIndex: number; chapterTitle: string; blocks: SemanticBlock[] }> = [];

    for (let i = 0; i < parsed.spine.length; i++) {
      const item = parsed.spine[i];
      const { blocks, inferredTitle } = parseXhtmlToBlocks(item.xhtml, item.fullPath, i);
      // Images are laid out at their own proportions (and never blown up past their pixel size).
      for (const block of blocks) {
        if (block.kind !== 'image' || !block.imagePath) continue;
        const lower = block.imagePath.toLowerCase();
        let bytes = parsed.files.get(block.imagePath);
        if (!bytes) for (const [key, value] of parsed.files) if (key.toLowerCase() === lower) { bytes = value; break; }
        const size = bytes ? readImageSize(bytes) : null;
        if (size && size.width > 0 && size.height > 0) {
          block.imageWidth = size.width;
          block.imageHeight = size.height;
        }
      }
      const chapterTitle = item.chapterTitle || inferredTitle || `Chapter ${i + 1}`;
      item.chapterTitle = chapterTitle;
      chapters.push({
        spineIndex: i,
        chapterTitle,
        blocks
      });
    }

    // If TOC was empty, synthesize TOC from chapter titles
    if (parsed.metadata.toc.length === 0) {
      for (const ch of chapters) {
        if (ch.blocks.length > 0) {
          parsed.metadata.toc.push({
            label: ch.chapterTitle,
            href: parsed.spine[ch.spineIndex].fullPath,
            spineIndex: ch.spineIndex,
            depth: 0
          });
        }
      }
    }

    return new EpubAdapter(parsed, chapters, initialSettings);
  }

  private runPagination(): void {
    const result = this.paginator.paginate(
      this.chapters,
      this.settings,
      this.parsed.loadedFontFamilies
    );
    this.pages = result.pages;
    this.spineStartPage = result.spineStartPage;
    this.textIndexCache.clear();
    this.marksByPage.clear();

    for (const item of this.metadata.toc) {
      item.pageIndex = this.spineStartPage.get(item.spineIndex) ?? 0;
    }
  }

  public getPageCount(): number {
    return this.pages.length;
  }

  public getPageAspectRatio(): number {
    return LOGICAL_PAGE_WIDTH / LOGICAL_PAGE_HEIGHT;
  }

  public getPageIndexForSpine(spineIndex: number): number {
    return this.spineStartPage.get(spineIndex) ?? 0;
  }

  public getAnchorForPage(pageIndex: number): ReadingAnchor {
    const clamped = Math.max(0, Math.min(this.pages.length - 1, pageIndex));
    return { ...this.pages[clamped].startAnchor };
  }

  public async relayout(settings: TypographySettings, anchor: ReadingAnchor): Promise<number> {
    this.settings = { ...settings };
    this.runPagination();
    return this.findPageForAnchor(anchor);
  }

  private findPageForAnchor(anchor: ReadingAnchor): number {
    // Find the last page whose startAnchor <= target anchor
    let best = 0;
    for (let i = 0; i < this.pages.length; i++) {
      const a = this.pages[i].startAnchor;
      const cmp =
        a.spineIndex !== anchor.spineIndex
          ? a.spineIndex - anchor.spineIndex
          : a.blockIndex !== anchor.blockIndex
            ? a.blockIndex - anchor.blockIndex
            : a.tokenOffset - anchor.tokenOffset;
      if (cmp <= 0) {
        best = i;
      } else {
        break;
      }
    }
    return best;
  }

  private async getImageBitmap(path: string): Promise<ImageBitmap | null> {
    const cached = this.bitmapCache.get(path);
    if (cached) return cached;

    let bytes = this.parsed.files.get(path);
    if (!bytes) {
      const lower = path.toLowerCase();
      for (const [k, v] of this.parsed.files.entries()) {
        if (k.toLowerCase() === lower) {
          bytes = v;
          break;
        }
      }
    }
    if (!bytes) return null;

    try {
      const mime = path.toLowerCase().endsWith('.svg')
        ? 'image/svg+xml'
        : path.toLowerCase().endsWith('.png')
          ? 'image/png'
          : path.toLowerCase().endsWith('.webp')
            ? 'image/webp'
            : 'image/jpeg';
      const blob = new Blob([bytes.slice()], { type: mime });
      if (mime === 'image/svg+xml') {
        const url = URL.createObjectURL(blob);
        try {
          const img = new Image();
          img.decoding = 'async';
          await new Promise<void>((res, rej) => {
            img.onload = () => res();
            img.onerror = () => rej(new Error('SVG load failed'));
            img.src = url;
          });
          const bmp = await createImageBitmap(img);
          this.bitmapCache.set(path, bmp);
          return bmp;
        } finally {
          URL.revokeObjectURL(url);
        }
      }
      const bmp = await createImageBitmap(blob);
      this.bitmapCache.set(path, bmp);
      return bmp;
    } catch {
      return null;
    }
  }

  public async renderPage(
    pageIndex: number,
    targetCanvas: HTMLCanvasElement,
    pixelWidth: number,
    pixelHeight: number,
    theme: ThemeMode
  ): Promise<void> {
    const page = pageIndex >= 0 && pageIndex < this.pages.length ? this.pages[pageIndex] : null;
    // Standard book convention: pageIndex 0 = page 1 (left or right depending on spread; here even index = left page, odd = right page)
    const isLeftPage = pageIndex % 2 === 0;
    await renderPaginatedPageToCanvas(
      page,
      this.metadata.title,
      pageIndex + 1,
      isLeftPage,
      this.settings.marginPreset,
      theme,
      targetCanvas,
      pixelWidth,
      pixelHeight,
      { getImageBitmap: (p) => this.getImageBitmap(p) },
      { rects: this.marksByPage.get(pageIndex) ?? [], color: this.markColor }
    );
  }

  // ─── Spine and text lookups used by the host app ───

  /** Every distinct character in the book: web fonts split by unicode-range load only what is asked for. */
  public getDistinctCharacters(): string {
    const seen = new Set<string>();
    for (const chapter of this.chapters) {
      for (const block of chapter.blocks) {
        for (const run of block.runs) for (const ch of run.text) seen.add(ch);
      }
    }
    return [...seen].join('');
  }

  public getSpineItems(): Array<{ spineIndex: number; href: string; cfiBase: string; chapterTitle: string }> {
    return this.parsed.spine.map((item, spineIndex) => ({
      spineIndex,
      href: item.href.split('#')[0],
      cfiBase: item.cfiBase,
      chapterTitle: item.chapterTitle
    }));
  }

  /** The spine item whose manifest href (the key epub.js uses) matches. */
  public getSpineIndexForHref(href: string | null | undefined): number {
    if (!href) return -1;
    const clean = (value: string) => {
      const base = value.split('#')[0];
      try {
        return decodeURIComponent(base);
      } catch {
        return base;
      }
    };
    const target = clean(href);
    const exact = this.parsed.spine.findIndex((item) => clean(item.href) === target);
    if (exact >= 0) return exact;
    return this.parsed.spine.findIndex(
      (item) => item.fullPath === target || item.fullPath.endsWith(`/${target}`) || target.endsWith(`/${clean(item.href)}`)
    );
  }

  public getPageSpine(pageIndex: number): number {
    return this.pages[pageIndex]?.spineIndex ?? -1;
  }

  /** First and last page of a chapter (inclusive), or null if it has no pages. */
  public getSpinePageRange(spineIndex: number): [number, number] | null {
    const start = this.spineStartPage.get(spineIndex);
    if (start === undefined) return null;
    let end = start;
    while (end + 1 < this.pages.length && this.pages[end + 1].spineIndex === spineIndex) end++;
    return [start, end];
  }

  /** The chapter's XHTML as a document, parsed the way epub.js shows it (for CFIs and coach anchors). */
  public getChapterDocument(spineIndex: number): Document | null {
    const item = this.parsed.spine[spineIndex];
    if (!item) return null;
    let doc = this.chapterDocs.get(spineIndex);
    if (!doc) {
      doc = parseChapterDocument(item.xhtml);
      this.chapterDocs.set(spineIndex, doc);
    }
    return doc;
  }

  /** The words printed on one page, paragraphs separated by blank lines. */
  public getPageText(pageIndex: number): string {
    const page = this.pages[pageIndex];
    if (!page) return '';
    let text = '';
    for (const line of page.lines) {
      text += line.runs.map((run) => run.text).join('');
      text += line.isLastInParagraph ? '\n\n' : ' ';
    }
    return text.trim();
  }

  public getSpineTextIndex(spineIndex: number): SpineTextIndex {
    const cached = this.textIndexCache.get(spineIndex);
    if (cached) return cached;
    const index: SpineTextIndex = { text: '', positions: [] };
    const range = this.getSpinePageRange(spineIndex);
    if (range) {
      for (let page = range[0]; page <= range[1]; page++) {
        this.pages[page].lines.forEach((line, lineIndex) => {
          line.runs.forEach((run, runIndex) => {
            if (run.isSpace) return;
            for (let char = 0; char < run.text.length; char++) {
              const value = compactText(run.text[char]);
              if (!value) continue;
              index.text += value;
              index.positions.push({ page, line: lineIndex, run: runIndex, char });
            }
          });
        });
      }
    }
    this.textIndexCache.set(spineIndex, index);
    return index;
  }

  /** Where the first character of a page falls in its chapter's whitespace-free text. */
  public getCompactOffsetForPage(pageIndex: number): { spineIndex: number; offset: number } | null {
    const page = this.pages[pageIndex];
    if (!page) return null;
    const index = this.getSpineTextIndex(page.spineIndex);
    const offset = index.positions.findIndex((position) => position.page >= pageIndex);
    return { spineIndex: page.spineIndex, offset: offset < 0 ? index.positions.length : offset };
  }

  public getPageForCompactOffset(spineIndex: number, offset: number): number {
    const index = this.getSpineTextIndex(spineIndex);
    const position = index.positions[Math.max(0, Math.min(index.positions.length - 1, offset))];
    return position?.page ?? this.getPageIndexForSpine(spineIndex);
  }

  private measureText(text: string, font: string): number {
    if (!this.measureCtx) this.measureCtx = document.createElement('canvas').getContext('2d');
    if (!this.measureCtx) return 0;
    this.measureCtx.font = font;
    return this.measureCtx.measureText(text).width;
  }

  /** Underline rectangles for each quote, per page. `missing` counts quotes not found in the layout. */
  public findQuoteMarks(spineIndex: number, entries: QuoteEntry[]): { byPage: Map<number, PageMarkRect[]>; missing: number } {
    const byPage = new Map<number, PageMarkRect[]>();
    const index = this.getSpineTextIndex(spineIndex);
    const margins = getMargins(this.settings.marginPreset);
    let missing = 0;
    for (const entry of entries) {
      const needle = compactText(entry.quote);
      if (needle.length < 2) continue;
      let start = index.text.indexOf(needle);
      if (start < 0) {
        missing++;
        continue;
      }
      for (let n = entry.occurrence ?? 0; n > 0; n--) {
        const next = index.text.indexOf(needle, start + 1);
        if (next < 0) break;
        start = next;
      }
      // One rectangle per printed line the quote touches.
      let segment: { page: number; line: number; first: SpineTextIndex['positions'][number]; last: SpineTextIndex['positions'][number] } | null = null;
      const flush = () => {
        if (!segment) return;
        const page = this.pages[segment.page];
        const line = page.lines[segment.line];
        const leftMargin = segment.page % 2 === 0 ? margins.outer : margins.inner;
        const xOf = (position: SpineTextIndex['positions'][number], after: boolean) => {
          const run = line.runs[position.run];
          return leftMargin + line.indentLeft + run.x + this.measureText(run.text.slice(0, position.char + (after ? 1 : 0)), run.fontString);
        };
        const x = xOf(segment.first, false);
        const rect: PageMarkRect = {
          cardId: entry.cardId,
          x,
          y: line.y,
          width: Math.max(2, xOf(segment.last, true) - x),
          height: line.height,
          baseline: line.y + line.baselineOffset
        };
        byPage.set(segment.page, [...(byPage.get(segment.page) ?? []), rect]);
        segment = null;
      };
      for (let i = start; i < start + needle.length; i++) {
        const position = index.positions[i];
        if (!position) break;
        if (segment && (segment.page !== position.page || segment.line !== position.line)) flush();
        if (!segment) segment = { page: position.page, line: position.line, first: position, last: position };
        else segment.last = position;
      }
      flush();
    }
    return { byPage, missing };
  }

  /** Marks drawn into page textures from now on. Returns the pages whose marks changed. */
  public setMarks(byPage: Map<number, PageMarkRect[]>, color: string): number[] {
    const changed = new Set<number>();
    const signature = (rects: PageMarkRect[] | undefined) => (rects ?? []).map((r) => `${r.cardId}:${Math.round(r.x)}:${Math.round(r.y)}:${Math.round(r.width)}`).join('|');
    const colorChanged = color !== this.markColor;
    for (const page of new Set([...this.marksByPage.keys(), ...byPage.keys()])) {
      if (colorChanged || signature(this.marksByPage.get(page)) !== signature(byPage.get(page))) changed.add(page);
    }
    this.marksByPage = byPage;
    this.markColor = color;
    return [...changed];
  }

  public getMarksForPage(pageIndex: number): PageMarkRect[] {
    return this.marksByPage.get(pageIndex) ?? [];
  }

  public dispose(): void {
    for (const bmp of this.bitmapCache.values()) {
      bmp.close();
    }
    this.bitmapCache.clear();
    this.chapterDocs.clear();
    this.textIndexCache.clear();
    this.parsed.cleanupFonts();
  }
}

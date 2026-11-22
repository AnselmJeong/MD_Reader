import type { FontPreset, MarginPreset, ReadingAnchor, TypographySettings } from '../../types/book';
import type { InlineStyle, SemanticBlock } from './xhtmlParser';
import { MATH_PAD, measureMath, type MathMetrics, type MathSpec } from './mathLayout';

export const LOGICAL_PAGE_WIDTH = 640;
export const LOGICAL_PAGE_HEIGHT = 910; // ~0.703 aspect ratio (classic hardcover)

export interface LaidOutRun {
  text: string;
  x: number;
  width: number;
  fontSize: number;
  fontString: string;
  style: InlineStyle;
  isSpace: boolean;
  /** A formula drawn as one box: `scale` shrinks one that is wider than the line. */
  math?: { spec: MathSpec; metrics: MathMetrics; scale: number };
}

/** The tinted panel behind the blocks of a framed aside; one per page the aside touches. */
export interface LaidOutBox {
  y: number;
  height: number;
  /** The aside continues from the previous page / onto the next one. */
  openTop: boolean;
  openBottom: boolean;
}

export interface LaidOutLine {
  y: number;
  height: number;
  baselineOffset: number;
  runs: LaidOutRun[];
  align: 'left' | 'center' | 'right' | 'justify';
  isLastInParagraph: boolean;
  maxWidth: number;
  indentLeft: number;
  isQuote?: boolean;
  isCode?: boolean;
  listMarker?: string;
  anchor: { spineIndex: number; blockIndex: number; tokenOffset: number };
}

export interface LaidOutImage {
  y: number;
  height: number;
  maxWidth: number;
  imagePath: string;
  caption?: string;
  anchor: { spineIndex: number; blockIndex: number; tokenOffset: number };
}

export interface LaidOutRule {
  y: number;
  width: number;
}

export interface PaginatedPage {
  pageIndex: number;
  spineIndex: number;
  chapterTitle: string;
  isChapterStart: boolean;
  lines: LaidOutLine[];
  images: LaidOutImage[];
  rules: LaidOutRule[];
  boxes: LaidOutBox[];
  startAnchor: ReadingAnchor;
}

export interface PageMargins {
  top: number;
  bottom: number;
  inner: number; // gutter side (wider for 3D book legibility!)
  outer: number;
}

export function getMargins(preset: MarginPreset): PageMargins {
  switch (preset) {
    case 'compact':
      return { top: 68, bottom: 62, inner: 72, outer: 48 };
    case 'wide':
      return { top: 96, bottom: 84, inner: 102, outer: 78 };
    case 'balanced':
    default:
      return { top: 82, bottom: 72, inner: 86, outer: 62 };
  }
}

export function resolveFontFamily(preset: FontPreset, embeddedFonts: string[]): string {
  const embeddedPrefix = embeddedFonts.length > 0 ? `"${embeddedFonts[0]}", ` : '';
  switch (preset) {
    case 'serif-kr':
      return `${embeddedPrefix}"Noto Serif KR", "AppleMyungjo", "Batang", "EB Garamond", Georgia, serif`;
    case 'sans-clean':
      return `"Inter", -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
    case 'serif-classic':
    default:
      return `${embeddedPrefix}"EB Garamond", "Noto Serif KR", "AppleMyungjo", Georgia, "Times New Roman", serif`;
  }
}

export function buildFontString(
  baseFamily: string,
  fontSize: number,
  style: InlineStyle
): string {
  const italic = style.italic ? 'italic ' : '';
  const weight = style.bold ? '600 ' : '400 ';
  const family = style.code
    ? '"SFMono-Regular", ui-monospace, Menlo, Consolas, monospace'
    : baseFamily;
  const size = style.sup || style.sub ? Math.round(fontSize * 0.72) : fontSize;
  return `${italic}${weight}${size}px ${family}`;
}

interface AtomicToken {
  text: string;
  style: InlineStyle;
  isSpace: boolean;
  isNewline: boolean;
  tokenOffset: number;
  math?: MathSpec;
}

const NO_LINE_START_CHARS = new Set([
  '.', ',', '!', '?', ';', ':', ')', ']', '}', '”', '’', '»', '…', '·',
  '。', '、', '，', '！', '？', '：', '；', '」', '』', '）', '】', '〉', '》'
]);

function tokenizeRuns(runs: { text: string; style: InlineStyle; math?: MathSpec }[]): AtomicToken[] {
  const tokens: AtomicToken[] = [];
  let offset = 0;

  for (const run of runs) {
    if (run.math) {
      tokens.push({
        text: '',
        style: run.style,
        isSpace: false,
        isNewline: false,
        tokenOffset: offset++,
        math: run.math
      });
      continue;
    }
    const parts = run.text.split(/(\n| +)/);
    for (const part of parts) {
      if (!part) continue;
      if (part === '\n') {
        tokens.push({
          text: '\n',
          style: run.style,
          isSpace: false,
          isNewline: true,
          tokenOffset: offset++
        });
      } else if (/^ +$/.test(part)) {
        tokens.push({
          text: ' ',
          style: run.style,
          isSpace: true,
          isNewline: false,
          tokenOffset: offset++
        });
      } else {
        // Keep words/Korean eojeol intact (keep-all), splitting only on long CJK/dash if needed later
        tokens.push({
          text: part,
          style: run.style,
          isSpace: false,
          isNewline: false,
          tokenOffset: offset++
        });
      }
    }
  }
  return tokens;
}

export class EpubPaginator {
  private measureCanvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private widthCache = new Map<string, number>();

  constructor() {
    this.measureCanvas = document.createElement('canvas');
    this.measureCanvas.width = 16;
    this.measureCanvas.height = 16;
    const ctx = this.measureCanvas.getContext('2d');
    if (!ctx) throw new Error('2D Canvas context unavailable');
    this.ctx = ctx;
  }

  private measure(text: string, fontString: string): number {
    const key = `${fontString}\u0000${text}`;
    const cached = this.widthCache.get(key);
    if (cached !== undefined) return cached;
    this.ctx.font = fontString;
    const w = this.ctx.measureText(text).width;
    if (this.widthCache.size > 60000) {
      this.widthCache.clear();
    }
    this.widthCache.set(key, w);
    return w;
  }

  public paginate(
    chapters: Array<{ spineIndex: number; chapterTitle: string; blocks: SemanticBlock[] }>,
    settings: TypographySettings,
    embeddedFonts: string[]
  ): { pages: PaginatedPage[]; spineStartPage: Map<number, number> } {
    this.widthCache.clear();

    const margins = getMargins(settings.marginPreset);
    const contentWidth = LOGICAL_PAGE_WIDTH - margins.inner - margins.outer;
    const contentTop = margins.top;
    const contentBottom = LOGICAL_PAGE_HEIGHT - margins.bottom;
    const baseFamily = settings.fontFamily
      ? `"${settings.fontFamily.replaceAll('"', '')}", "Noto Serif KR", "AppleMyungjo", Georgia, serif`
      : resolveFontFamily(settings.fontPreset, embeddedFonts);

    const pages: PaginatedPage[] = [];
    const spineStartPage = new Map<number, number>();

    let currentPage: PaginatedPage | null = null;
    let cursorY = contentTop;
    // The framed aside being laid out, and its panel on the current page.
    let activeBox: { id: number; panel: LaidOutBox } | null = null;
    const BOX_PAD_X = 14;
    const BOX_PAD_TOP = 10;
    const BOX_PAD_BOTTOM = 6;
    const BOX_GAP = 12;

    const startNewPage = (
      spineIndex: number,
      chapterTitle: string,
      isChapterStart: boolean,
      blockIndex: number,
      tokenOffset: number
    ): PaginatedPage => {
      if (activeBox) {
        activeBox.panel.height = Math.max(0, cursorY - activeBox.panel.y);
        activeBox.panel.openBottom = true;
      }
      const page: PaginatedPage = {
        pageIndex: pages.length,
        spineIndex,
        chapterTitle,
        isChapterStart,
        lines: [],
        images: [],
        rules: [],
        boxes: [],
        startAnchor: {
          spineIndex,
          blockIndex,
          tokenOffset,
          globalProgress: 0
        }
      };
      pages.push(page);
      currentPage = page;
      cursorY = isChapterStart ? contentTop + 28 : contentTop;
      if (activeBox) {
        activeBox.panel = { y: cursorY, height: 0, openTop: true, openBottom: false };
        page.boxes.push(activeBox.panel);
        cursorY += BOX_PAD_TOP;
      }
      return page;
    };

    const wrapTokens = (
      tokens: AtomicToken[],
      maxWidth: number,
      firstLineIndent: number,
      fontSize: number,
      lineHeightPx: number,
      spineIndex: number,
      blockIndex: number
    ): Array<{
      runs: LaidOutRun[];
      width: number;
      isFirst: boolean;
      tokenOffset: number;
    }> => {
      const result: Array<{
        runs: LaidOutRun[];
        width: number;
        isFirst: boolean;
        tokenOffset: number;
      }> = [];

      let lineRuns: LaidOutRun[] = [];
      let lineWidth = 0;
      let isFirstLine = true;
      let lineStartTokenOffset = tokens[0]?.tokenOffset ?? 0;

      const flushLine = () => {
        // Trim trailing space
        while (lineRuns.length > 0 && lineRuns[lineRuns.length - 1].isSpace) {
          const popped = lineRuns.pop()!;
          lineWidth -= popped.width;
        }
        result.push({
          runs: lineRuns,
          width: lineWidth,
          isFirst: isFirstLine,
          tokenOffset: lineStartTokenOffset
        });
        lineRuns = [];
        lineWidth = 0;
        isFirstLine = false;
      };

      const pushWordPieces = (tok: AtomicToken, fontString: string) => {
        const displayText = tok.style.smallCaps ? tok.text.toUpperCase() : tok.text;
        const effectiveSize = tok.style.smallCaps ? Math.round(fontSize * 0.84) : fontSize;
        const effectiveFont = tok.style.smallCaps
          ? buildFontString(baseFamily, effectiveSize, tok.style)
          : fontString;
        const tokW = this.measure(displayText, effectiveFont);
        const avail = maxWidth - (isFirstLine ? firstLineIndent : 0);

        if (lineRuns.length === 0) {
          lineStartTokenOffset = tok.tokenOffset;
        }

        if (lineRuns.length > 0 && lineWidth + tokW > avail) {
          // Avoid starting a line with forbidden punctuation if possible
          if (displayText.length === 1 && NO_LINE_START_CHARS.has(displayText)) {
            lineRuns.push({
              text: displayText,
              x: 0,
              width: tokW,
              fontSize: effectiveSize,
              fontString: effectiveFont,
              style: tok.style,
              isSpace: false
            });
            lineWidth += tokW;
            return;
          }
          flushLine();
          lineStartTokenOffset = tok.tokenOffset;
        }

        const curAvail = maxWidth - (isFirstLine ? firstLineIndent : 0);
        if (tokW > curAvail && displayText.length > 1) {
          // Break overly long token by character (e.g., long Korean compound or URL)
          let chunk = '';
          let chunkW = 0;
          for (const ch of Array.from(displayText)) {
            const cw = this.measure(ch, effectiveFont);
            if (chunk && lineWidth + chunkW + cw > curAvail) {
              lineRuns.push({
                text: chunk,
                x: 0,
                width: chunkW,
                fontSize: effectiveSize,
                fontString: effectiveFont,
                style: tok.style,
                isSpace: false
              });
              lineWidth += chunkW;
              flushLine();
              lineStartTokenOffset = tok.tokenOffset;
              chunk = ch;
              chunkW = cw;
            } else {
              chunk += ch;
              chunkW += cw;
            }
          }
          if (chunk) {
            lineRuns.push({
              text: chunk,
              x: 0,
              width: chunkW,
              fontSize: effectiveSize,
              fontString: effectiveFont,
              style: tok.style,
              isSpace: false
            });
            lineWidth += chunkW;
          }
          return;
        }

        lineRuns.push({
          text: displayText,
          x: 0,
          width: tokW,
          fontSize: effectiveSize,
          fontString: effectiveFont,
          style: tok.style,
          isSpace: false
        });
        lineWidth += tokW;
      };

      const pushMath = (tok: AtomicToken, spec: MathSpec) => {
        const metrics = measureMath(spec, fontSize);
        // The drawn box has padding on every side; the formula itself advances the line.
        const inkWidth = Math.max(1, metrics.width - MATH_PAD * 2);
        const avail = maxWidth - (isFirstLine ? firstLineIndent : 0);
        if (lineRuns.length > 0 && lineWidth + inkWidth > avail) flushLine();
        if (lineRuns.length === 0) lineStartTokenOffset = tok.tokenOffset;
        const room = maxWidth - (isFirstLine ? firstLineIndent : 0);
        const scale = inkWidth > room ? Math.max(0.45, room / inkWidth) : 1;
        const width = inkWidth * scale;
        lineRuns.push({
          text: '',
          x: 0,
          width,
          fontSize,
          fontString: buildFontString(baseFamily, fontSize, tok.style),
          style: tok.style,
          isSpace: false,
          math: { spec, metrics, scale }
        });
        lineWidth += width;
      };

      for (const tok of tokens) {
        if (tok.isNewline) {
          flushLine();
          continue;
        }
        if (tok.math) {
          pushMath(tok, tok.math);
          continue;
        }
        const fontString = buildFontString(baseFamily, fontSize, tok.style);
        if (tok.isSpace) {
          if (lineRuns.length === 0) continue; // Never start a line with leading space
          const sw = this.measure(' ', fontString);
          lineRuns.push({
            text: ' ',
            x: 0,
            width: sw,
            fontSize,
            fontString,
            style: tok.style,
            isSpace: true
          });
          lineWidth += sw;
        } else {
          pushWordPieces(tok, fontString);
        }
      }

      if (lineRuns.length > 0) {
        flushLine();
      }
      void lineHeightPx;
      void spineIndex;
      void blockIndex;
      return result;
    };

    for (const chapter of chapters) {
      if (chapter.blocks.length === 0) continue;
      spineStartPage.set(chapter.spineIndex, pages.length);
      startNewPage(chapter.spineIndex, chapter.chapterTitle, true, 0, 0);

      let prevKind: SemanticBlock['kind'] | null = null;

      const closeBox = () => {
        if (!activeBox) return;
        cursorY += BOX_PAD_BOTTOM;
        activeBox.panel.height = Math.max(0, cursorY - activeBox.panel.y);
        activeBox = null;
        cursorY += BOX_GAP;
        boxClosedAt = cursorY;
      };
      // Two asides in a row (an equation and its explanation) are set as one unit, as books do.
      let boxClosedAt = -1;

      for (const block of chapter.blocks) {
        if (!currentPage) {
          startNewPage(chapter.spineIndex, chapter.chapterTitle, false, block.blockIndex, 0);
        }

        if (activeBox && activeBox.id !== block.box?.id) closeBox();
        if (block.box && !activeBox) {
          const pageHasContent = currentPage!.lines.length + currentPage!.images.length > 0;
          if (boxClosedAt === cursorY) cursorY -= BOX_GAP;
          else if (pageHasContent) cursorY += BOX_GAP;
          // Do not open a panel that has no room for a couple of lines.
          if (pageHasContent && cursorY + BOX_PAD_TOP + settings.fontSizePx * settings.lineHeight * 2.2 > contentBottom) {
            startNewPage(chapter.spineIndex, chapter.chapterTitle, false, block.blockIndex, 0);
          }
          const panel: LaidOutBox = { y: cursorY, height: 0, openTop: false, openBottom: false };
          currentPage!.boxes.push(panel);
          activeBox = { id: block.box.id, panel };
          cursorY += BOX_PAD_TOP;
          prevKind = null;
        }
        const boxInset = activeBox ? BOX_PAD_X : 0;

        if (block.kind === 'hr') {
          const hrSpace = 28;
          if (cursorY + hrSpace > contentBottom) {
            startNewPage(chapter.spineIndex, chapter.chapterTitle, false, block.blockIndex, 0);
          }
          currentPage!.rules.push({
            y: cursorY + hrSpace * 0.5,
            width: Math.min(140, contentWidth * 0.32)
          });
          cursorY += hrSpace;
          prevKind = 'hr';
          continue;
        }

        if (block.kind === 'image' && block.imagePath) {
          const maxBoxH = Math.min(340, (contentBottom - contentTop) * 0.46);
          const maxBoxW = contentWidth * 0.88;
          // Fit the image's own proportions; small images (ornaments, icons) keep their pixel size.
          const scale = block.imageWidth && block.imageHeight
            ? Math.min(maxBoxW / block.imageWidth, maxBoxH / block.imageHeight, 1)
            : 0;
          const imgBoxW = scale ? block.imageWidth! * scale : maxBoxW;
          const imgBoxH = scale ? block.imageHeight! * scale : maxBoxH;
          const captionH = block.caption ? 40 : 0; // room for the two caption lines the renderer draws
          const totalH = imgBoxH + captionH + (imgBoxH < 40 ? 12 : 24);
          if (cursorY + totalH > contentBottom && currentPage!.lines.length + currentPage!.images.length > 0) {
            startNewPage(chapter.spineIndex, chapter.chapterTitle, false, block.blockIndex, 0);
          }
          currentPage!.images.push({
            y: cursorY + (imgBoxH < 40 ? 4 : 8),
            height: imgBoxH,
            maxWidth: imgBoxW,
            imagePath: block.imagePath,
            caption: block.caption,
            anchor: {
              spineIndex: chapter.spineIndex,
              blockIndex: block.blockIndex,
              tokenOffset: 0
            }
          });
          cursorY += totalH;
          prevKind = 'image';
          continue;
        }

        // Text-bearing blocks
        let fontSize = settings.fontSizePx;
        let lineMult = settings.lineHeight;
        let spaceBefore = 0;
        let spaceAfter = Math.round(settings.fontSizePx * 0.34);
        let indentLeft = 0;
        let maxW = contentWidth;
        let firstLineIndent = 0;
        let align: LaidOutLine['align'] = block.align ?? settings.textAlign;

        if (block.kind === 'heading') {
          const lvl = block.level ?? 2;
          const scale = lvl === 1 ? 1.55 : lvl === 2 ? 1.24 : lvl === 3 ? 1.1 : 1.02;
          fontSize = Math.round(settings.fontSizePx * scale);
          lineMult = 1.32;
          spaceBefore = prevKind === null ? 6 : Math.round(fontSize * 0.85);
          spaceAfter = Math.round(fontSize * 0.58);
          align = block.align ?? (lvl <= 3 ? 'center' : 'left');
        } else if (block.kind === 'blockquote') {
          fontSize = Math.max(13, Math.round(settings.fontSizePx * 0.94));
          lineMult = settings.lineHeight * 0.96;
          indentLeft = 24;
          maxW = contentWidth - 40;
          spaceBefore = 10;
          spaceAfter = 12;
          align = 'left';
        } else if (block.kind === 'list-item') {
          const depthIndent = Math.min(block.listDepth ?? 0, 3) * 18;
          indentLeft = 24 + depthIndent;
          maxW = contentWidth - 28 - depthIndent;
          spaceAfter = 6;
          align = 'left';
        } else if (block.kind === 'code') {
          fontSize = Math.max(12, Math.round(settings.fontSizePx * 0.84));
          lineMult = 1.45;
          indentLeft = 16;
          maxW = contentWidth - 32;
          spaceBefore = 8;
          spaceAfter = 10;
          align = 'left';
        } else {
          // Regular paragraph
          const shouldIndent =
            !block.noIndent &&
            prevKind === 'paragraph' &&
            align !== 'center' &&
            align !== 'right';
          firstLineIndent = shouldIndent ? Math.round(settings.fontSizePx * 1.45) : 0;
          spaceAfter = shouldIndent ? Math.round(settings.fontSizePx * 0.16) : Math.round(settings.fontSizePx * 0.36);
        }

        indentLeft += boxInset;
        maxW -= boxInset * 2;

        const lineHeightPx = Math.round(fontSize * lineMult);
        const tokens = tokenizeRuns(block.runs);
        if (tokens.length === 0) continue;

        const wrapped = wrapTokens(
          tokens,
          maxW,
          firstLineIndent,
          fontSize,
          lineHeightPx,
          chapter.spineIndex,
          block.blockIndex
        );
        if (wrapped.length === 0) continue;

        // Widow/orphan protection for headings: keep heading + at least 2 body lines worth of room
        if (block.kind === 'heading') {
          const needed = spaceBefore + wrapped.length * lineHeightPx + spaceAfter + settings.fontSizePx * 3.2;
          if (cursorY + needed > contentBottom && currentPage!.lines.length + currentPage!.images.length > 0) {
            startNewPage(chapter.spineIndex, chapter.chapterTitle, false, block.blockIndex, 0);
            spaceBefore = 4;
          }
        }

        if (currentPage!.lines.length + currentPage!.images.length > 0) {
          cursorY += spaceBefore;
        }

        const baseBaseline = Math.round(fontSize * 0.85);
        for (let li = 0; li < wrapped.length; li++) {
          const wl = wrapped[li];
          // A line grows to hold formulas taller than the text (fractions, sums).
          let extraTop = 0;
          let extraBottom = 0;
          let onlyDisplayMath = wl.runs.length > 0;
          for (const r of wl.runs) {
            if (!r.math) {
              if (!r.isSpace) onlyDisplayMath = false;
              continue;
            }
            if (!r.math.spec.display) onlyDisplayMath = false;
            const ascent = (r.math.metrics.baseline - MATH_PAD) * r.math.scale;
            const descent = (r.math.metrics.height - r.math.metrics.baseline - MATH_PAD) * r.math.scale;
            extraTop = Math.max(extraTop, Math.ceil(ascent - baseBaseline));
            extraBottom = Math.max(extraBottom, Math.ceil(descent - (lineHeightPx - baseBaseline)));
          }
          if (onlyDisplayMath) {
            extraTop += 4;
            extraBottom += 4;
          }
          const thisLineHeight = lineHeightPx + extraTop + extraBottom;
          const lineAlign: LaidOutLine['align'] = onlyDisplayMath ? 'center' : align;
          if (cursorY + thisLineHeight > contentBottom && currentPage!.lines.length + currentPage!.images.length > 0) {
            startNewPage(
              chapter.spineIndex,
              chapter.chapterTitle,
              false,
              block.blockIndex,
              wl.tokenOffset
            );
          }

          const isLast = li === wrapped.length - 1;
          const lineIndent = indentLeft + (wl.isFirst ? firstLineIndent : 0);
          const lineMaxW = maxW - (wl.isFirst ? firstLineIndent : 0);

          // Position runs horizontally
          const runs = wl.runs;
          if (lineAlign === 'justify' && !isLast && runs.length > 2) {
            const spaceCount = runs.filter((r) => r.isSpace).length;
            const leftover = lineMaxW - wl.width;
            const maxExtraPerSpace = fontSize * 0.65;
            if (spaceCount > 0 && leftover > 0 && leftover / spaceCount <= maxExtraPerSpace) {
              const extra = leftover / spaceCount;
              let x = 0;
              for (const r of runs) {
                r.x = x;
                x += r.width + (r.isSpace ? extra : 0);
              }
            } else {
              let x = 0;
              for (const r of runs) {
                r.x = x;
                x += r.width;
              }
            }
          } else if (lineAlign === 'center') {
            // Centered on the full measure, also on an indented first line.
            let x = Math.max(0, (maxW - wl.width) * 0.5 - (lineIndent - indentLeft));
            for (const r of runs) {
              r.x = x;
              x += r.width;
            }
          } else if (lineAlign === 'right') {
            let x = Math.max(0, lineMaxW - wl.width);
            for (const r of runs) {
              r.x = x;
              x += r.width;
            }
          } else {
            let x = 0;
            for (const r of runs) {
              r.x = x;
              x += r.width;
            }
          }

          currentPage!.lines.push({
            y: cursorY,
            height: thisLineHeight,
            baselineOffset: baseBaseline + extraTop,
            runs,
            align: lineAlign,
            isLastInParagraph: isLast,
            maxWidth: lineMaxW,
            indentLeft: lineIndent,
            isQuote: block.kind === 'blockquote',
            isCode: block.kind === 'code',
            listMarker: li === 0 ? block.listMarker : undefined,
            anchor: {
              spineIndex: chapter.spineIndex,
              blockIndex: block.blockIndex,
              tokenOffset: wl.tokenOffset
            }
          });

          cursorY += thisLineHeight;
        }

        cursorY += spaceAfter;
        prevKind = block.kind;
      }
      closeBox();
    }

    // Ensure at least 2 pages so spreads work gracefully
    if (pages.length === 0) {
      startNewPage(0, '', true, 0, 0);
    }

    // Populate globalProgress on every page anchor
    const denom = Math.max(1, pages.length - 1);
    for (let i = 0; i < pages.length; i++) {
      pages[i].startAnchor.globalProgress = i / denom;
    }

    return { pages, spineStartPage };
  }
}

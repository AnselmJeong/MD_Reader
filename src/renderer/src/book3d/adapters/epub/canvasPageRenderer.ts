import { THEME_PALETTES, type MarginPreset, type ThemeMode } from '../../types/book';
import {
  getMargins,
  LOGICAL_PAGE_HEIGHT,
  LOGICAL_PAGE_WIDTH,
  type PaginatedPage
} from './epubPaginator';

/** A dotted underline under marked words, in logical page coordinates. */
export interface PageMarkRect {
  cardId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  baseline: number;
}

export interface PageImageResolver {
  getImageBitmap(path: string): Promise<ImageBitmap | null>;
}

export async function renderPaginatedPageToCanvas(
  page: PaginatedPage | null,
  bookTitle: string,
  pageNumberDisplay: number, // 1-based page number
  isLeftPage: boolean,
  marginPreset: MarginPreset,
  theme: ThemeMode,
  canvas: HTMLCanvasElement,
  pixelWidth: number,
  pixelHeight: number,
  imageResolver: PageImageResolver,
  marks?: { rects: PageMarkRect[]; color: string }
): Promise<void> {
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }

  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return;

  const palette = THEME_PALETTES[theme];
  const scaleX = pixelWidth / LOGICAL_PAGE_WIDTH;
  const scaleY = pixelHeight / LOGICAL_PAGE_HEIGHT;

  ctx.save();
  ctx.scale(scaleX, scaleY);

  // Crisp paper background
  ctx.fillStyle = palette.paperBg;
  ctx.fillRect(0, 0, LOGICAL_PAGE_WIDTH, LOGICAL_PAGE_HEIGHT);

  if (!page) {
    // Blank endpaper/verso page
    ctx.restore();
    return;
  }

  const margins = getMargins(marginPreset);
  // Left page has gutter on the RIGHT; right page has gutter on the LEFT!
  const leftMargin = isLeftPage ? margins.outer : margins.inner;
  const rightMargin = isLeftPage ? margins.inner : margins.outer;
  const contentWidth = LOGICAL_PAGE_WIDTH - leftMargin - rightMargin;

  // Running Header & Page Number (suppressed on chapter-opening pages for clean book typography)
  if (!page.isChapterStart) {
    const headerY = margins.top - 30;
    ctx.fillStyle = palette.mutedColor;
    ctx.textBaseline = 'alphabetic';

    // Page number on outer corner
    ctx.font = '400 12px "EB Garamond", "Noto Serif KR", Georgia, serif';
    const numStr = String(pageNumberDisplay);
    if (isLeftPage) {
      ctx.textAlign = 'left';
      ctx.fillText(numStr, leftMargin, headerY);
    } else {
      ctx.textAlign = 'right';
      ctx.fillText(numStr, LOGICAL_PAGE_WIDTH - rightMargin, headerY);
    }

    // Running title centered
    ctx.textAlign = 'center';
    const centerX = leftMargin + contentWidth * 0.5;
    if (isLeftPage) {
      ctx.font = '400 10.5px "EB Garamond", "Noto Serif KR", Georgia, serif';
      const upper = bookTitle.toUpperCase().slice(0, 46);
      drawTrackedText(ctx, upper, centerX, headerY, 1.8);
    } else {
      ctx.font = 'italic 400 12.5px "EB Garamond", "Noto Serif KR", Georgia, serif';
      const ch = (page.chapterTitle || bookTitle).slice(0, 52);
      ctx.fillText(ch, centerX, headerY);
    }
  } else {
    // Bottom-centered page number on chapter opening page
    ctx.fillStyle = palette.mutedColor;
    ctx.font = '400 12.5px "EB Garamond", "Noto Serif KR", Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(String(pageNumberDisplay), leftMargin + contentWidth * 0.5, LOGICAL_PAGE_HEIGHT - margins.bottom + 30);
  }

  // Ornamental horizontal rules
  if (page.rules.length > 0) {
    ctx.strokeStyle = palette.ruleColor;
    ctx.lineWidth = 1;
    for (const rule of page.rules) {
      const cx = leftMargin + contentWidth * 0.5;
      ctx.beginPath();
      ctx.moveTo(cx - rule.width * 0.5, rule.y);
      ctx.lineTo(cx + rule.width * 0.5, rule.y);
      ctx.stroke();
    }
  }

  // Render embedded images
  for (const imgBlock of page.images) {
    const bitmap = await imageResolver.getImageBitmap(imgBlock.imagePath);
    const boxLeft = leftMargin + (contentWidth - imgBlock.maxWidth) * 0.5;
    if (bitmap) {
      const ratio = Math.min(imgBlock.maxWidth / bitmap.width, imgBlock.height / bitmap.height);
      const drawW = bitmap.width * ratio;
      const drawH = bitmap.height * ratio;
      const drawX = leftMargin + (contentWidth - drawW) * 0.5;
      const drawY = imgBlock.y + (imgBlock.height - drawH) * 0.5;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, drawX, drawY, drawW, drawH);

      // Hairline frame around illustrations
      ctx.strokeStyle = palette.ruleColor;
      ctx.lineWidth = 0.75;
      ctx.strokeRect(drawX, drawY, drawW, drawH);
    } else {
      ctx.fillStyle = palette.quoteBg;
      ctx.fillRect(boxLeft, imgBlock.y, imgBlock.maxWidth, imgBlock.height);
    }

    if (imgBlock.caption) {
      ctx.fillStyle = palette.mutedColor;
      ctx.font = 'italic 400 12px "EB Garamond", "Noto Serif KR", Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const maxCapW = contentWidth * 0.92;
      const words = imgBlock.caption.split(/\s+/);
      const capLines: string[] = [];
      let curLine = '';
      for (const word of words) {
        const test = curLine ? `${curLine} ${word}` : word;
        if (ctx.measureText(test).width > maxCapW && curLine) {
          capLines.push(curLine);
          curLine = word;
          if (capLines.length >= 2) break;
        } else {
          curLine = test;
        }
      }
      if (curLine && capLines.length < 2) capLines.push(curLine);
      const cx = leftMargin + contentWidth * 0.5;
      capLines.forEach((ln, idx) => {
        ctx.fillText(ln, cx, imgBlock.y + imgBlock.height + 7 + idx * 15);
      });
    }
  }

  // Render text lines
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  for (const line of page.lines) {
    const baseX = leftMargin + line.indentLeft;
    const baseY = line.y + line.baselineOffset;

    if (line.isQuote) {
      ctx.fillStyle = palette.ruleColor;
      ctx.fillRect(leftMargin + 8, line.y + 1, 2, line.height - 2);
    }

    if (line.isCode) {
      ctx.fillStyle = palette.quoteBg;
      ctx.fillRect(leftMargin + 8, line.y, contentWidth - 16, line.height);
    }

    if (line.listMarker) {
      ctx.fillStyle = palette.mutedColor;
      ctx.font = line.runs[0]?.fontString ?? '400 16px serif';
      ctx.fillText(line.listMarker, leftMargin + 6, baseY);
    }

    for (const run of line.runs) {
      if (run.isSpace) continue;
      ctx.font = run.fontString;
      ctx.fillStyle = run.style.code ? palette.mutedColor : palette.inkColor;
      const yOffset = run.style.sup ? -run.fontSize * 0.42 : run.style.sub ? run.fontSize * 0.22 : 0;
      ctx.fillText(run.text, baseX + run.x, baseY + yOffset);
    }
  }

  if (marks && marks.rects.length > 0) {
    ctx.strokeStyle = marks.color;
    ctx.lineWidth = 1.7;
    ctx.lineCap = 'round';
    ctx.setLineDash([0.1, 3.6]);
    for (const mark of marks.rects) {
      const y = mark.baseline + 3.6;
      ctx.beginPath();
      ctx.moveTo(mark.x, y);
      ctx.lineTo(mark.x + mark.width, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  ctx.restore();
}

function drawTrackedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  y: number,
  tracking: number
): void {
  const chars = Array.from(text);
  if (chars.length === 0) return;
  let totalW = 0;
  const widths = chars.map((ch) => {
    const w = ctx.measureText(ch).width;
    totalW += w;
    return w;
  });
  totalW += tracking * Math.max(0, chars.length - 1);

  ctx.save();
  ctx.textAlign = 'left';
  let x = centerX - totalW * 0.5;
  for (let i = 0; i < chars.length; i++) {
    ctx.fillText(chars[i], x, y);
    x += widths[i] + tracking;
  }
  ctx.restore();
}

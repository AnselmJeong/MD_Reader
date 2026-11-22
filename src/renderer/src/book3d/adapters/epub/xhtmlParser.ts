import { resolveRelativePath } from './epubParser';

export interface InlineStyle {
  bold: boolean;
  italic: boolean;
  code: boolean;
  sup: boolean;
  sub: boolean;
  smallCaps: boolean;
}

export interface TextRun {
  text: string;
  style: InlineStyle;
}

export type BlockKind =
  | 'heading'
  | 'paragraph'
  | 'blockquote'
  | 'list-item'
  | 'code'
  | 'image'
  | 'hr'
  | 'chapter-break';

export interface SemanticBlock {
  kind: BlockKind;
  spineIndex: number;
  blockIndex: number;
  level?: number; // 1..6 for heading
  listMarker?: string;
  align?: 'left' | 'center' | 'right' | 'justify';
  runs: TextRun[];
  imagePath?: string;
  caption?: string;
  /** Natural pixel size, when the image header could be read (set by the adapter). */
  imageWidth?: number;
  imageHeight?: number;
  noIndent?: boolean;
}

const DEFAULT_STYLE: InlineStyle = {
  bold: false,
  italic: false,
  code: false,
  sup: false,
  sub: false,
  smallCaps: false
};

const SKIP_TAGS = new Set([
  'script',
  'style',
  'head',
  'meta',
  'link',
  'title',
  'noscript',
  'iframe',
  'audio',
  'video'
]);

const BLOCK_TAGS = new Set([
  'p',
  'div',
  'section',
  'article',
  'main',
  'header',
  'footer',
  'aside',
  'blockquote',
  'pre',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'figure',
  'figcaption',
  'hr',
  'table',
  'tr',
  'dt',
  'dd'
]);

/** Alt text worth printing as a caption: not empty, not a placeholder like "image" or a file name. */
function captionFromAlt(alt: string | null | undefined): string | undefined {
  const text = (alt ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  if (/^(image|img|picture|photo|figure|graphic|그림|이미지|사진|cover)$/i.test(text)) return undefined;
  if (/\.(jpe?g|png|gif|webp|svg)$/i.test(text)) return undefined;
  return text;
}

function dirname(filePath: string): string {
  const idx = filePath.lastIndexOf('/');
  return idx >= 0 ? filePath.slice(0, idx) : '';
}

function collapseWhitespace(str: string): string {
  return str.replace(/[\t\r\n\f]+/g, ' ').replace(/ {2,}/g, ' ');
}

function mergeStyle(base: InlineStyle, el: Element): InlineStyle {
  const tag = el.localName.toLowerCase();
  const cls = (el.getAttribute('class') ?? '').toLowerCase();
  const inlineCss = (el.getAttribute('style') ?? '').toLowerCase();

  let bold = base.bold || tag === 'strong' || tag === 'b';
  let italic = base.italic || tag === 'em' || tag === 'i' || tag === 'cite' || tag === 'dfn';
  let code = base.code || tag === 'code' || tag === 'kbd' || tag === 'samp' || tag === 'tt';
  const sup = base.sup || tag === 'sup';
  const sub = base.sub || tag === 'sub';
  let smallCaps = base.smallCaps || cls.includes('smallcaps') || inlineCss.includes('small-caps');

  if (cls.includes('italic') || inlineCss.includes('font-style: italic') || inlineCss.includes('font-style:italic')) {
    italic = true;
  }
  if (cls.includes('bold') || inlineCss.includes('font-weight: bold') || inlineCss.includes('font-weight:bold') || inlineCss.includes('font-weight: 700')) {
    bold = true;
  }
  return { bold, italic, code, sup, sub, smallCaps };
}

function detectAlign(el: Element): SemanticBlock['align'] | undefined {
  const alignAttr = (el.getAttribute('align') ?? '').toLowerCase();
  const style = (el.getAttribute('style') ?? '').toLowerCase();
  const cls = (el.getAttribute('class') ?? '').toLowerCase();
  if (alignAttr === 'center' || style.includes('text-align: center') || style.includes('text-align:center') || cls.includes('center')) {
    return 'center';
  }
  if (alignAttr === 'right' || style.includes('text-align: right') || style.includes('text-align:right') || cls.includes('right')) {
    return 'right';
  }
  return undefined;
}

function hasBlockChild(el: Element): boolean {
  for (const child of Array.from(el.children)) {
    const tag = child.localName.toLowerCase();
    if (BLOCK_TAGS.has(tag)) return true;
  }
  return false;
}

function trimRuns(runs: TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  for (const r of runs) {
    if (!r.text) continue;
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.style.bold === r.style.bold &&
      prev.style.italic === r.style.italic &&
      prev.style.code === r.style.code &&
      prev.style.sup === r.style.sup &&
      prev.style.sub === r.style.sub &&
      prev.style.smallCaps === r.style.smallCaps
    ) {
      prev.text += r.text;
    } else {
      out.push({ text: r.text, style: { ...r.style } });
    }
  }
  while (out.length > 0 && !out[0].text.trim()) {
    out.shift();
  }
  if (out.length > 0) {
    out[0].text = out[0].text.replace(/^ +/, '');
  }
  while (out.length > 0 && !out[out.length - 1].text.trim()) {
    out.pop();
  }
  if (out.length > 0) {
    out[out.length - 1].text = out[out.length - 1].text.replace(/ +$/, '');
  }
  return out;
}

export function parseXhtmlToBlocks(
  xhtml: string,
  fullPath: string,
  spineIndex: number
): { blocks: SemanticBlock[]; inferredTitle: string } {
  const parser = new DOMParser();
  let doc = parser.parseFromString(xhtml, 'application/xhtml+xml');
  if (doc.querySelector('parsererror') || !doc.body) {
    doc = parser.parseFromString(xhtml, 'text/html');
  }

  const baseDir = dirname(fullPath);
  const blocks: SemanticBlock[] = [];
  let inferredTitle = '';

  const titleEl = doc.querySelector('title');
  if (titleEl?.textContent?.trim()) {
    inferredTitle = titleEl.textContent.trim();
  }

  const pushBlock = (block: Omit<SemanticBlock, 'spineIndex' | 'blockIndex'>) => {
    blocks.push({
      ...block,
      spineIndex,
      blockIndex: blocks.length
    });
  };

  const collectInlineRuns = (
    node: Node,
    style: InlineStyle,
    runs: TextRun[],
    preserveSpace: boolean,
    allowImages = true
  ) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const raw = node.textContent ?? '';
      const text = preserveSpace ? raw : collapseWhitespace(raw);
      if (text) runs.push({ text, style });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const tag = el.localName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return;

    if (tag === 'br') {
      runs.push({ text: '\n', style });
      return;
    }

    if (tag === 'img' || tag === 'image') {
      // Images inside a heading are ornaments (rules around a chapter number): leave them out.
      if (!allowImages) return;
      const src =
        el.getAttribute('src') ??
        el.getAttribute('xlink:href') ??
        el.getAttribute('href') ??
        '';
      if (src) {
        const resolved = resolveRelativePath(baseDir, src);
        pushBlock({
          kind: 'image',
          runs: [],
          imagePath: resolved,
          caption: captionFromAlt(el.getAttribute('alt')),
          align: 'center'
        });
      }
      return;
    }

    const nextStyle = mergeStyle(style, el);
    for (const child of Array.from(el.childNodes)) {
      collectInlineRuns(child, nextStyle, runs, preserveSpace, allowImages);
    }
  };

  const walk = (node: Node, inBlockquote: boolean, listDepth: number) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = collapseWhitespace(node.textContent ?? '').trim();
      if (text) {
        pushBlock({
          kind: inBlockquote ? 'blockquote' : 'paragraph',
          runs: [{ text, style: { ...DEFAULT_STYLE } }]
        });
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const tag = el.localName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return;

    if (tag === 'hr') {
      pushBlock({ kind: 'hr', runs: [] });
      return;
    }

    if (tag === 'img') {
      const src = el.getAttribute('src') ?? '';
      if (src) {
        pushBlock({
          kind: 'image',
          runs: [],
          imagePath: resolveRelativePath(baseDir, src),
          caption: captionFromAlt(el.getAttribute('alt')),
          align: 'center'
        });
      }
      return;
    }

    if (tag === 'svg') {
      const imageEl = Array.from(el.getElementsByTagName('*')).find(
        (n) => n.localName.toLowerCase() === 'image'
      );
      if (imageEl) {
        const href = imageEl.getAttribute('xlink:href') ?? imageEl.getAttribute('href') ?? '';
        if (href) {
          pushBlock({
            kind: 'image',
            runs: [],
            imagePath: resolveRelativePath(baseDir, href),
            align: 'center'
          });
        }
      }
      return;
    }

    if (tag === 'figure') {
      const img = el.querySelector('img');
      const figcaption = el.querySelector('figcaption');
      const caption = figcaption?.textContent?.replace(/\s+/g, ' ').trim();
      if (img) {
        const src = img.getAttribute('src') ?? '';
        if (src) {
          pushBlock({
            kind: 'image',
            runs: [],
            imagePath: resolveRelativePath(baseDir, src),
            caption: caption || captionFromAlt(img.getAttribute('alt')),
            align: 'center'
          });
          return;
        }
      }
    }

    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag[1]);
      const runs: TextRun[] = [];
      collectInlineRuns(el, { ...DEFAULT_STYLE, bold: level <= 2 }, runs, false, false);
      const cleaned = trimRuns(runs);
      if (cleaned.length > 0) {
        const headingText = cleaned.map((r) => r.text).join('').trim();
        if (!inferredTitle && level <= 2) inferredTitle = headingText;
        pushBlock({
          kind: 'heading',
          level,
          align: detectAlign(el) ?? (level <= 3 ? 'center' : 'left'),
          runs: cleaned,
          noIndent: true
        });
      }
      return;
    }

    if (tag === 'pre') {
      const runs: TextRun[] = [];
      collectInlineRuns(el, { ...DEFAULT_STYLE, code: true }, runs, true);
      if (runs.length > 0) {
        pushBlock({
          kind: 'code',
          align: 'left',
          runs,
          noIndent: true
        });
      }
      return;
    }

    if (tag === 'blockquote') {
      if (hasBlockChild(el)) {
        for (const child of Array.from(el.childNodes)) {
          walk(child, true, listDepth);
        }
      } else {
        const runs: TextRun[] = [];
        collectInlineRuns(el, { ...DEFAULT_STYLE, italic: true }, runs, false);
        const cleaned = trimRuns(runs);
        if (cleaned.length > 0) {
          pushBlock({
            kind: 'blockquote',
            runs: cleaned,
            noIndent: true
          });
        }
      }
      return;
    }

    if (tag === 'ul' || tag === 'ol') {
      let itemNum = 1;
      for (const child of Array.from(el.children)) {
        if (child.localName.toLowerCase() === 'li') {
          const runs: TextRun[] = [];
          collectInlineRuns(child, { ...DEFAULT_STYLE }, runs, false);
          const cleaned = trimRuns(runs);
          if (cleaned.length > 0) {
            pushBlock({
              kind: 'list-item',
              listMarker: tag === 'ol' ? `${itemNum}.` : '•',
              runs: cleaned,
              noIndent: true
            });
          }
          itemNum++;
        }
      }
      return;
    }

    if (tag === 'tr') {
      const cells = Array.from(el.children)
        .filter((c) => c.localName.toLowerCase() === 'td' || c.localName.toLowerCase() === 'th')
        .map((c) => c.textContent?.replace(/\s+/g, ' ').trim() ?? '')
        .filter(Boolean);
      if (cells.length > 0) {
        const isHeader = Array.from(el.children).some((c) => c.localName.toLowerCase() === 'th');
        pushBlock({
          kind: 'paragraph',
          align: 'left',
          noIndent: true,
          runs: [
            {
              text: cells.join('   ·   '),
              style: { ...DEFAULT_STYLE, bold: isHeader }
            }
          ]
        });
      }
      return;
    }

    if (tag === 'p' || tag === 'figcaption' || tag === 'dt' || tag === 'dd') {
      const runs: TextRun[] = [];
      collectInlineRuns(el, { ...DEFAULT_STYLE }, runs, false);
      const cleaned = trimRuns(runs);
      if (cleaned.length > 0) {
        const cls = (el.getAttribute('class') ?? '').toLowerCase();
        pushBlock({
          kind: inBlockquote ? 'blockquote' : 'paragraph',
          align: detectAlign(el),
          runs: cleaned,
          noIndent:
            inBlockquote ||
            tag === 'figcaption' ||
            cls.includes('noindent') ||
            cls.includes('first')
        });
      }
      return;
    }

    // Generic containers (body, div, section, article, table, etc.)
    if (hasBlockChild(el) || tag === 'body' || tag === 'section' || tag === 'article' || tag === 'table' || tag === 'tbody' || tag === 'thead') {
      for (const child of Array.from(el.childNodes)) {
        walk(child, inBlockquote, listDepth);
      }
    } else {
      const runs: TextRun[] = [];
      collectInlineRuns(el, { ...DEFAULT_STYLE }, runs, false);
      const cleaned = trimRuns(runs);
      if (cleaned.length > 0) {
        pushBlock({
          kind: inBlockquote ? 'blockquote' : 'paragraph',
          align: detectAlign(el),
          runs: cleaned
        });
      }
    }
  };

  if (doc.body) {
    walk(doc.body, false, 0);
  }

  return { blocks, inferredTitle };
}

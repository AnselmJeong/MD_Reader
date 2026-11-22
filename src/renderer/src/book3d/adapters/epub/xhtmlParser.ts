import { resolveRelativePath } from './epubParser';
import { buildMathSpec, type MathSpec } from './mathLayout';

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
  /** A formula; `text` is empty and the run is laid out as one box. */
  math?: MathSpec;
}

/** A framed aside in the book (a note, an explanation box): its blocks are drawn on a tinted panel. */
export interface BlockBox {
  id: number;
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
  /** 0 for a top-level list item, 1 for an item of a list inside it, and so on. */
  listDepth?: number;
  align?: 'left' | 'center' | 'right' | 'justify';
  runs: TextRun[];
  imagePath?: string;
  caption?: string;
  /** Natural pixel size, when the image header could be read (set by the adapter). */
  imageWidth?: number;
  imageHeight?: number;
  noIndent?: boolean;
  box?: BlockBox;
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

const BOX_CLASS = /(^|[\s_-])(callout|admonition|note|notes|tip|warning|caution|important|sidebar|aside|box|boxed|panel|explain|explanation|explainer|commentary|formula-note|math-note|eq-note|haeseol|pullout|infobox|keypoint|summary-box)([\s_-]|$)/;
const BOX_EPUB_TYPES = /(^|\s)(sidebar|note|notice|tip|warning|help|learning-objective|practice|case-study)(\s|$)/;

const BOX_HOST_TAGS = new Set(['div', 'aside', 'section', 'article', 'figure', 'details', 'dl']);

/**
 * Class names the book's stylesheets paint as a panel: a rule that gives the class a background
 * or a frame. This is how a book says "this is a box", whatever it calls the class.
 */
export function collectBoxClasses(stylesheets: string[]): Set<string> {
  const classes = new Set<string>();
  const paints = (declarations: string): boolean => {
    for (const declaration of declarations.split(';')) {
      const colon = declaration.indexOf(':');
      if (colon < 0) continue;
      const property = declaration.slice(0, colon).trim().toLowerCase();
      const value = declaration.slice(colon + 1).trim().toLowerCase();
      if (!/^(background|background-color|border|border-left|border-inline-start)$/.test(property)) continue;
      if (!value || /^(none|transparent|inherit|initial|unset|0|0px)(\s*!important)?$/.test(value)) continue;
      return true;
    }
    return false;
  };
  for (const sheet of stylesheets) {
    const css = sheet.replace(/\/\*[\s\S]*?\*\//g, '');
    // Innermost rules only, so rules inside @media are read too.
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectors = match[1];
      if (selectors.trim().startsWith('@') || !paints(match[2])) continue;
      for (const selector of selectors.split(',')) {
        // The element the rule styles is the last compound of the selector.
        const subject = selector.trim().split(/[\s>+~]+/).pop() ?? '';
        if (/:{1,2}(before|after|hover|focus|active|first-line|first-letter|selection|marker)/i.test(subject)) continue;
        const tag = (/^[a-z][a-z0-9]*/i.exec(subject)?.[0] ?? '').toLowerCase();
        if (tag && !BOX_HOST_TAGS.has(tag)) continue;
        for (const cls of subject.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) classes.add(cls[1].toLowerCase());
      }
    }
  }
  return classes;
}

/** Whether the book frames this container as an aside (callout, explanation box, sidebar). */
function isBoxContainer(el: Element, boxClasses?: Set<string>): boolean {
  const tag = el.localName.toLowerCase();
  if (tag === 'body' || tag === 'table' || tag === 'tbody' || tag === 'thead') return false;
  if (tag === 'aside') return true;
  const cls = (el.getAttribute('class') ?? '').toLowerCase();
  if (cls && boxClasses && boxClasses.size > 0 && BOX_HOST_TAGS.has(tag)) {
    for (const name of cls.split(/\s+/)) if (name && boxClasses.has(name)) return true;
  }
  if (cls && BOX_CLASS.test(cls)) return true;
  const epubType = (el.getAttribute('epub:type') ?? el.getAttributeNS('http://www.idpf.org/2007/ops', 'type') ?? '').toLowerCase();
  if (epubType && BOX_EPUB_TYPES.test(epubType)) return true;
  const style = (el.getAttribute('style') ?? '').toLowerCase();
  return /(^|;)\s*(background|background-color|border|border-left)\s*:/.test(style);
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
    if (r.math) {
      out.push({ text: '', style: { ...r.style }, math: r.math });
      continue;
    }
    if (!r.text) continue;
    const prev = out[out.length - 1];
    if (
      prev &&
      !prev.math &&
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
  while (out.length > 0 && !out[0].math && !out[0].text.trim()) {
    out.shift();
  }
  if (out.length > 0) {
    out[0].text = out[0].text.replace(/^ +/, '');
  }
  while (out.length > 0 && !out[out.length - 1].math && !out[out.length - 1].text.trim()) {
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
  spineIndex: number,
  boxClasses?: Set<string>
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

  let currentBox: BlockBox | null = null;
  let boxCount = 0;

  const pushBlock = (block: Omit<SemanticBlock, 'spineIndex' | 'blockIndex'>) => {
    const next: SemanticBlock = {
      ...block,
      spineIndex,
      blockIndex: blocks.length
    };
    if (currentBox && !next.box) next.box = currentBox;
    // A paragraph that is one display formula is set centered, like the book's own layout.
    const inked = next.runs.filter((r) => r.math || r.text.trim());
    if (inked.length === 1 && inked[0].math?.display && next.kind !== 'heading') {
      next.align = 'center';
      next.noIndent = true;
    }
    blocks.push(next);
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

    if (tag === 'math') {
      const spec = buildMathSpec(el);
      if (spec) {
        // A display formula inside running text gets a line of its own.
        if (spec.display) runs.push({ text: '\n', style });
        runs.push({ text: '', style, math: spec });
        if (spec.display) runs.push({ text: '\n', style });
      }
      return;
    }
    // KaTeX and MathJax pages carry the formula twice (MathML for readers, spans for the eye):
    // keep the MathML and leave the visual copy out.
    const elClass = el.getAttribute('class') ?? '';
    if (/(^|\s)katex-html(\s|$)/.test(elClass)) return;
    if (tag === 'mjx-container') {
      const assistive = Array.from(el.getElementsByTagName('*')).find((n) => n.localName.toLowerCase() === 'math');
      if (assistive) collectInlineRuns(assistive, style, runs, preserveSpace, allowImages);
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
          // A list inside an item is laid out as its own, deeper items.
          const runs: TextRun[] = [];
          const nested: Element[] = [];
          for (const part of Array.from(child.childNodes)) {
            const partTag = part.nodeType === Node.ELEMENT_NODE ? (part as Element).localName.toLowerCase() : '';
            if (partTag === 'ul' || partTag === 'ol') nested.push(part as Element);
            else collectInlineRuns(part, { ...DEFAULT_STYLE }, runs, false);
          }
          const cleaned = trimRuns(runs);
          if (cleaned.length > 0) {
            pushBlock({
              kind: 'list-item',
              listMarker: tag === 'ol' ? `${itemNum}.` : listDepth > 0 ? '◦' : '•',
              listDepth,
              runs: cleaned,
              noIndent: true
            });
          }
          for (const list of nested) walk(list, inBlockquote, listDepth + 1);
          itemNum++;
        }
      }
      return;
    }

    if (tag === 'tr') {
      // A row is set as one line of cells; formulas in cells stay formulas.
      const cellEls = Array.from(el.children).filter(
        (c) => c.localName.toLowerCase() === 'td' || c.localName.toLowerCase() === 'th'
      );
      const isHeader = cellEls.some((c) => c.localName.toLowerCase() === 'th');
      const cellStyle = { ...DEFAULT_STYLE, bold: isHeader };
      const runs: TextRun[] = [];
      for (const cell of cellEls) {
        const cellRuns: TextRun[] = [];
        collectInlineRuns(cell, cellStyle, cellRuns, false, false);
        const cleaned = trimRuns(cellRuns).filter((r) => r.math || r.text !== '\n');
        if (cleaned.length === 0) continue;
        if (runs.length > 0) runs.push({ text: '   ·   ', style: cellStyle });
        runs.push(...cleaned);
      }
      if (runs.length > 0) {
        pushBlock({
          kind: 'paragraph',
          align: 'left',
          noIndent: true,
          runs
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
      const opensBox = !currentBox && isBoxContainer(el, boxClasses);
      if (opensBox) currentBox = { id: ++boxCount };
      for (const child of Array.from(el.childNodes)) {
        walk(child, inBlockquote, listDepth);
      }
      if (opensBox) currentBox = null;
    } else {
      const runs: TextRun[] = [];
      collectInlineRuns(el, { ...DEFAULT_STYLE }, runs, false);
      const cleaned = trimRuns(runs);
      if (cleaned.length > 0) {
        const ownBox = !currentBox && BLOCK_TAGS.has(tag) && isBoxContainer(el, boxClasses) ? { id: ++boxCount } : undefined;
        pushBlock({
          kind: inBlockquote ? 'blockquote' : 'paragraph',
          align: detectAlign(el),
          runs: cleaned,
          box: ownBox
        });
      }
    }
  };

  if (doc.body) {
    walk(doc.body, false, 0);
  }

  return { blocks, inferredTitle };
}

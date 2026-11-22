// Math in the 3D book. Pages are drawn on a canvas, which cannot lay out MathML, so each formula
// is measured in a hidden element and drawn through an SVG image of the same markup.

export interface MathSpec {
  /** Sanitized MathML (a single <math> element). */
  markup: string;
  /** The TeX source when the book carries it; used for the page's plain text. */
  tex: string;
  display: boolean;
}

export interface MathMetrics {
  /** Size of the box that is drawn (formula plus padding). */
  width: number;
  height: number;
  /** Distance from the top of the box to the text baseline. */
  baseline: number;
}

const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';
/** Room around a formula so italic overhang and tall glyphs are not clipped. */
export const MATH_PAD = 3;

// Only system fonts: an SVG image cannot load the reader's web fonts, and the measured size has
// to match what the image draws.
const MATH_FONT =
  '"STIX Two Math", "Latin Modern Math", "Cambria Math", "STIXGeneral", "Apple SD Gothic Neo", "AppleMyungjo", "Noto Serif CJK KR", math, serif';

const ALLOWED_TAGS = new Set([
  'math', 'mrow', 'mi', 'mn', 'mo', 'mtext', 'mspace', 'ms', 'mfrac', 'msqrt', 'mroot', 'mstyle',
  'merror', 'mpadded', 'mphantom', 'msub', 'msup', 'msubsup', 'munder', 'mover', 'munderover',
  'mmultiscripts', 'mprescripts', 'none', 'mtable', 'mtr', 'mtd', 'menclose'
]);

const ALLOWED_ATTRS = new Set([
  'mathvariant', 'displaystyle', 'scriptlevel', 'stretchy', 'fence', 'separator', 'lspace',
  'rspace', 'largeop', 'movablelimits', 'symmetric', 'minsize', 'maxsize', 'accent',
  'accentunder', 'columnalign', 'rowalign', 'columnspan', 'rowspan', 'linethickness', 'width',
  'height', 'depth', 'form', 'columnspacing', 'rowspacing', 'notation', 'dir'
]);

const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Rebuild a book's <math> element from an allowlist. The result is inserted into the app's own
 * document for measuring, so nothing but presentation MathML may pass (no scripts, links, HTML).
 */
function serializeMath(node: Node, isRoot: boolean, display: boolean): string {
  if (node.nodeType === Node.TEXT_NODE) return escapeXml(node.textContent ?? '');
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as Element;
  const tag = el.localName.toLowerCase();
  const children = () => Array.from(el.childNodes).map((child) => serializeMath(child, false, false)).join('');

  if (tag === 'annotation' || tag === 'annotation-xml') return '';
  if (tag === 'semantics') {
    // The first child is the formula; the rest are annotations.
    const first = Array.from(el.children).find((child) => !child.localName.toLowerCase().startsWith('annotation'));
    return first ? serializeMath(first, false, false) : '';
  }
  if (tag === 'mfenced') {
    // Not part of MathML Core: write the fences out.
    const open = el.getAttribute('open') ?? '(';
    const close = el.getAttribute('close') ?? ')';
    const separator = (el.getAttribute('separators') ?? ',').trim().charAt(0);
    const parts = Array.from(el.children).map((child) => serializeMath(child, false, false));
    const inner = parts.join(separator ? `<mo separator="true">${escapeXml(separator)}</mo>` : '');
    return `<mrow><mo fence="true">${escapeXml(open)}</mo>${inner}<mo fence="true">${escapeXml(close)}</mo></mrow>`;
  }
  if (!ALLOWED_TAGS.has(tag)) return children();

  let attrs = '';
  for (const attr of Array.from(el.attributes)) {
    const name = attr.localName.toLowerCase();
    if (!ALLOWED_ATTRS.has(name)) continue;
    if (isRoot && name === 'displaystyle') continue;
    attrs += ` ${name}="${escapeXml(attr.value)}"`;
  }
  if (isRoot) {
    // Display formulas keep their large layout but stay inline boxes, so they can be measured.
    attrs = ` xmlns="${MATHML_NS}"${display ? ' displaystyle="true"' : ''}${attrs}`;
  }
  return `<${tag}${attrs}>${children()}</${tag}>`;
}

export function buildMathSpec(mathEl: Element, forceDisplay = false): MathSpec | null {
  const display = forceDisplay || (mathEl.getAttribute('display') ?? '').toLowerCase() === 'block';
  const markup = serializeMath(mathEl, true, display);
  if (!/<m(i|n|o|text|s|space)\b/.test(markup)) return null;
  const annotation = Array.from(mathEl.getElementsByTagName('*')).find(
    (el) => el.localName.toLowerCase() === 'annotation' && /tex/i.test(el.getAttribute('encoding') ?? '')
  );
  const tex = (annotation?.textContent ?? '').replace(/\s+/g, ' ').trim();
  return { markup, tex, display };
}

/** Plain text for a formula: its TeX if known, else the characters of the formula. */
export function mathPlainText(spec: MathSpec): string {
  if (spec.tex) return spec.display ? `$$${spec.tex}$$` : `$${spec.tex}$`;
  return spec.markup.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

const hostStyle = (fontSize: number, color: string): string =>
  `display:inline-block;padding:${MATH_PAD}px;margin:0;white-space:nowrap;line-height:normal;` +
  `font:400 ${fontSize}px ${MATH_FONT.replace(/"/g, "'")};color:${color};`;

const hostInner = (spec: MathSpec): string =>
  `<span style="display:inline-block;width:0;height:0"></span>` +
  spec.markup.replace('<math ', `<math style="font-family:${MATH_FONT.replace(/"/g, "'")};font-size:inherit" `);

let measureHost: HTMLDivElement | null = null;
const metricsCache = new Map<string, MathMetrics>();

export function measureMath(spec: MathSpec, fontSize: number): MathMetrics {
  const key = `${fontSize}\u0000${spec.markup}`;
  const cached = metricsCache.get(key);
  if (cached) return cached;

  if (!measureHost || !measureHost.isConnected) {
    measureHost = document.createElement('div');
    measureHost.setAttribute('aria-hidden', 'true');
    measureHost.style.cssText =
      'position:absolute;left:-99999px;top:0;visibility:hidden;pointer-events:none;contain:layout style;';
    document.body.appendChild(measureHost);
  }
  measureHost.innerHTML = `<div style="${hostStyle(fontSize, '#000')}">${hostInner(spec)}</div>`;
  const box = measureHost.firstElementChild as HTMLElement;
  const strut = box.firstElementChild as HTMLElement;
  const boxRect = box.getBoundingClientRect();
  const strutRect = strut.getBoundingClientRect();
  const metrics: MathMetrics = {
    width: Math.ceil(boxRect.width),
    height: Math.ceil(boxRect.height),
    baseline: strutRect.bottom - boxRect.top
  };
  measureHost.innerHTML = '';
  if (metricsCache.size > 4000) metricsCache.clear();
  metricsCache.set(key, metrics);
  return metrics;
}

const imageCache = new Map<string, Promise<HTMLImageElement | null>>();

/**
 * The formula as an image, `pixelScale` device pixels per layout pixel. Drawn at
 * (x, baselineY - metrics.baseline) with size metrics.width x metrics.height.
 */
export function getMathImage(
  spec: MathSpec,
  fontSize: number,
  color: string,
  pixelScale: number
): Promise<HTMLImageElement | null> {
  const scale = Math.max(0.5, Math.round(pixelScale * 8) / 8);
  const key = `${fontSize}\u0000${color}\u0000${scale}\u0000${spec.markup}`;
  const cached = imageCache.get(key);
  if (cached) {
    // Most recently used last.
    imageCache.delete(key);
    imageCache.set(key, cached);
    return cached;
  }
  const metrics = measureMath(spec, fontSize);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(metrics.width * scale)}" height="${Math.ceil(metrics.height * scale)}" viewBox="0 0 ${metrics.width} ${metrics.height}">` +
    `<foreignObject x="0" y="0" width="${metrics.width}" height="${metrics.height}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="${hostStyle(fontSize, color)}">${hostInner(spec)}</div>` +
    `</foreignObject></svg>`;
  const promise = new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
  imageCache.set(key, promise);
  if (imageCache.size > 600) {
    const oldest = imageCache.keys().next().value;
    if (oldest !== undefined) imageCache.delete(oldest);
  }
  return promise;
}

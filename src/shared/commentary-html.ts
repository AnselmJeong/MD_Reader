import { parse, type DefaultTreeAdapterMap } from 'parse5'
import type { CommentaryHtml } from './commentary'

export const MAX_COMMENTARY_HTML_BYTES = 8 * 1024 * 1024
export function pastedHtmlDocument(text: string): CommentaryHtml | null {
  const content = text.trim().replace(/^```html?\s*\n([\s\S]*?)\n```\s*$/i, '$1').trim()
  if (!/^(?:<!doctype\s+html[^>]*>\s*)?<html(?:\s|>)/i.test(content) || !/<\/html>\s*$/i.test(content)) return null
  return { name: '붙여넣은 HTML.html', content }
}

export function resolveCommentaryContent(note: { markdown: string; html?: CommentaryHtml | null }) {
  const html = note.html ?? pastedHtmlDocument(note.markdown)
  return { html, markdown: !note.html && html ? '' : note.markdown }
}
export function validateCommentaryHtml(html: CommentaryHtml) {
  if (!html || typeof html.name !== 'string' || !html.name.trim() || html.name.length > 255
    || typeof html.content !== 'string' || !html.content.trim()
    || new TextEncoder().encode(html.content).length > MAX_COMMENTARY_HTML_BYTES
    || html.content.includes('\u0000')) throw new Error('HTML 파일은 비어 있지 않은 UTF-8 문서, 8 MB 이하로 추가해 주세요.')
}

export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!))
const allowed = new Set(('html head title body style main article section aside header footer nav div span p br hr h1 h2 h3 h4 h5 h6 strong em b i u s small sub sup mark blockquote pre code kbd samp var ul ol li dl dt dd figure figcaption table caption colgroup col thead tbody tfoot tr th td img a details summary ' +
  'svg g defs symbol use image path rect circle ellipse line polyline polygon text tspan textPath marker pattern clipPath mask linearGradient radialGradient stop filter feGaussianBlur feOffset feBlend feColorMatrix feComposite feFlood feMerge feMergeNode foreignObject ' +
  'math semantics annotation mrow mi mn mo mtext mspace ms mfrac msqrt mroot mstyle merror mpadded mphantom mfenced menclose msub msup msubsup munder mover munderover mmultiscripts mprescripts none mtable mtr mtd mlabeledtr').split(' '))
const voidTags = new Set(['br', 'hr', 'col', 'img'])
const policy = "default-src 'none'; script-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"

// CSP remains the network boundary. Remove ordinary external CSS references as
// well so the portable XHTML does not carry missing dependencies into an EPUB.
const offlineCss = (css: string) => css
  .replace(/@import\s+(?:[^;"']|"[^"]*"|'[^']*')*;?/gi, '')
  .replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi, (_match, double: string, single: string, bare: string) => {
    const url = (double ?? single ?? bare ?? '').trim()
    return /^(?:#[\w:.-]+|data:[^\s]+)$/i.test(url) ? `url("${url.replace(/"/g, '%22')}")` : 'none'
  })

// Parse as HTML before serializing a static, namespace-correct document. The raw
// attachment is retained separately; this output is used only inside a sandbox
// and as the static XHTML companion in exported EPUBs.
export function renderCommentaryHtml(html: CommentaryHtml): string {
  validateCommentaryHtml(html)
  const doc = parse(html.content)
  const render = (node: DefaultTreeAdapterMap['node'], namespace = '', depth = 0): string => {
    if (depth > 256) return ''
    if (node.nodeName === '#text') return escapeHtml((node as DefaultTreeAdapterMap['textNode']).value)
    if (!('tagName' in node)) return ''
    const tag = node.tagName
    if (!allowed.has(tag)) return ''
    const attrs = node.attrs.filter(attr => {
      const name = attr.name.toLowerCase()
      if (!/^[a-z_][a-z0-9_.-]*$/i.test(attr.name) || name.startsWith('on') || attr.prefix === 'xmlns'
        || ['xmlns', 'srcdoc', 'srcset', 'action', 'formaction', 'target', 'ping', 'download', 'autofocus', 'is', 'contenteditable', 'http-equiv'].includes(name)) return false
      if (['href', 'src', 'poster', 'background'].includes(name)) return /^#[\w:.-]+$/.test(attr.value)
        || (['img', 'image'].includes(tag) && /^data:image\/(?:png|jpeg|gif|webp|svg\+xml);/i.test(attr.value))
      return !attr.prefix || attr.prefix === 'xlink' || attr.prefix === 'xml'
    }).map(attr => ` ${attr.prefix ? `${attr.prefix}:` : ''}${attr.name}="${escapeHtml(/^(?:style|fill|stroke|filter|clip-path|mask|marker(?:-start|-mid|-end)?)$/.test(attr.name) ? offlineCss(attr.value) : attr.value)}"`).join('')
    if (tag === 'img' && !attrs.includes(' src="')) return '<span>[외부 그림 · HTML 파일 안에 이미지를 포함해 주세요.]</span>'
    const ns = node.namespaceURI !== namespace ? ` xmlns="${node.namespaceURI}"` : ''
    const xlink = node.attrs.some(attr => attr.prefix === 'xlink') ? ' xmlns:xlink="http://www.w3.org/1999/xlink"' : ''
    if (voidTags.has(tag)) return `<${tag}${ns}${xlink}${attrs} />`
    // CSS raw-text is shared by HTML and XML parsers; escapes keep both safe.
    const contents = tag === 'style'
      ? node.childNodes.map(child => child.nodeName === '#text' ? offlineCss((child as DefaultTreeAdapterMap['textNode']).value).replace(/[<&]/g, char => char === '<' ? '\\3c ' : '\\26 ') : '').join('')
      : node.childNodes.map(child => render(child, node.namespaceURI, depth + 1)).join('')
    const guard = tag === 'head' ? `${node.childNodes.some(child => 'tagName' in child && child.tagName === 'title') ? '' : `<title>${escapeHtml(html.name)}</title>`}<meta http-equiv="Content-Security-Policy" content="${escapeHtml(policy)}" /><meta charset="utf-8" /><style>html{color-scheme:light}body{margin:20px;background:#fff;color:#222;overflow-wrap:break-word}img,svg{max-width:100%;height:auto}</style>` : ''
    return `<${tag}${ns}${xlink}${attrs}>${guard}${contents}</${tag}>`
  }
  return '<!DOCTYPE html>' + doc.childNodes.map(node => render(node)).join('')
}

import type { Root } from 'mdast'

// Static Quarto syntax only: code cells remain source and are never evaluated.
interface Node {
  type: string
  value?: string
  children?: Node[]
  depth?: number
  lang?: string | null
  meta?: string | null
  url?: string
  alt?: string | null
  data?: { hName?: string; hProperties?: Record<string, unknown> }
}
interface Attributes { id?: string; classes: string[]; values: Record<string, string> }
interface Reference { label: string; number: string }

function attributes(source: string): Attributes {
  const result: Attributes = { classes: [], values: {} }
  const tokens = source.match(/(?:[^\s"']|"[^"]*"|'[^']*')+/g) ?? []
  for (const token of tokens) {
    if (token.startsWith('#')) result.id = token.slice(1)
    else if (token.startsWith('.')) result.classes.push(token.slice(1))
    else if (token === '-') result.classes.push('unnumbered')
    else {
      const match = token.match(/^([\w-]+)=(.*)$/)
      if (match) result.values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2')
    }
  }
  return result
}
function properties(attrs: Attributes): Record<string, unknown> {
  return { ...(attrs.id ? { id: attrs.id } : {}), ...(attrs.classes.length ? { className: attrs.classes } : {}) }
}
function text(node: Node): string {
  return node.value ?? node.alt ?? node.children?.map(text).join('') ?? ''
}
function element(tag: string, children: Node[], props: Record<string, unknown> = {}): Node {
  return { type: tag === 'span' || tag === 'figcaption' ? 'paragraph' : 'blockquote', data: { hName: tag, hProperties: props }, children }
}
function caption(children: Node[], label?: string): Node {
  return element('figcaption', [...(label ? [{ type: 'text', value: `${label}: ` }] : []), ...children])
}

// Separating div markers lets remark parse their content normally, including
// nested lists and tables. Fences and indented code remain byte-for-byte intact.
export function prepareQuartoSource(source: string): string {
  let fence: { char: string; size: number } | null = null
  return source.replace(/\r\n/g, '\n').split('\n').map(line => {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
    if (match) {
      if (!fence) fence = { char: match[1][0], size: match[1].length }
      else if (match[1][0] === fence.char && match[1].length >= fence.size && !match[2].trim()) fence = null
      return line
    }
    return !fence && /^ {0,3}:{3,}(?:\s*\{[^}]*\}|\s*[\w.-]+)?\s*$/.test(line) ? `\n${line}\n` : line
  }).join('\n')
}

export function remarkQuarto() {
  return (root: Root) => {
    const tree = root as unknown as Node
    const refs = new Map<string, Reference>()
    const counts = new Map<string, number>()
    const slugs = new Set<string>()
    const register = (id: string | undefined, title?: string): Reference | undefined => {
      if (!id) return
      if (refs.has(id)) return refs.get(id)
      const kind = id.split('-')[0]
      const prefix: Record<string, string> = { fig: 'Figure', tbl: 'Table', eq: 'Equation' }
      if (kind === 'sec') {
        const ref = { label: title || id, number: title || id }
        refs.set(id, ref)
        return ref
      }
      if (!prefix[kind]) return
      const number = (counts.get(kind) ?? 0) + 1
      counts.set(kind, number)
      const ref = { label: `${prefix[kind]} ${number}`, number: String(number) }
      refs.set(id, ref)
      return ref
    }
    const takeAttributes = (node: Node): Attributes | null => {
      const last = node.children?.at(-1)
      if (last?.type !== 'text') return null
      const match = last.value?.match(/\s*\{([^{}]*)\}\s*$/)
      if (!match) return null
      last.value = last.value!.slice(0, match.index)
      return attributes(match[1])
    }
    const marker = (node: Node) => node.type === 'paragraph' && node.children?.every(child => child.type === 'text')
      ? text(node).match(/^(:{3,})\s*(?:\{([^}]*)\}|([\w.-]+))?\s*$/) : null
    const groupDivs = (parent: Node) => {
      if (!parent.children) return
      const children = parent.children
      for (let i = 0; i < children.length; i++) {
        const opening = marker(children[i])
        if (!opening || !(opening[2] || opening[3])) continue
        let depth = 1
        let end = i + 1
        for (; end < children.length; end++) {
          const candidate = marker(children[end])
          if (!candidate) continue
          if (candidate[2] || candidate[3]) depth++
          else if (--depth === 0) break
        }
        if (end === children.length) continue // Preserve incomplete source.
        const attrs = attributes(opening[2] ?? `.${opening[3]}`)
        const callout = attrs.classes.find(value => /^callout-(note|warning|important|tip|caution)$/.test(value))
        if (callout) attrs.classes.unshift('callout')
        const div = element('div', children.slice(i + 1, end), properties(attrs))
        if (attrs.id?.match(/^(fig|tbl)-/)) div.data!.hName = 'figure'
        children.splice(i, end - i + 1, div)
      }
      for (const child of children) groupDivs(child)
    }
    groupDivs(tree)

    const targets = (parent: Node) => {
      if (!parent.children) return
      for (let i = 0; i < parent.children.length; i++) {
        let node = parent.children[i]
        if (node.type === 'heading') {
          const attrs = takeAttributes(node)
          const title = text(node)
          const base = title.toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, '').trim().replace(/\s+/g, '-') || 'section'
          let id = attrs?.id ?? base
          if (!attrs?.id) for (let n = 1; slugs.has(id); n++) id = `${base}-${n}`
          slugs.add(id)
          node.data = { hProperties: { ...properties(attrs ?? { classes: [], values: {} }), id } }
          register(id, title)
        }
        if (node.type === 'code' && node.lang?.startsWith('{')) {
          const info = `${node.lang} ${node.meta ?? ''}`.match(/^\{([\w+-]+)(?:[ ,][^}]*)?\}/)
          if (info) { node.lang = info[1]; node.meta = null }
        }
        if (node.type === 'paragraph') {
          // Consume attributes immediately after images, leaving prose intact.
          for (let j = 0; j < (node.children?.length ?? 0); j++) {
            const image = node.children![j]
            const following = node.children![j + 1]
            if (!['image', 'imageReference'].includes(image.type)) continue
            const match = following?.type === 'text' ? following.value?.match(/^\{([^{}]*)\}/) : null
            const visibleCaption = image.alt ?? ''
            const attrs = attributes(match?.[1] ?? '')
            if (match) following.value = following.value!.slice(match[0].length)
            image.data = { hProperties: properties(attrs) }
            if (attrs.values['fig-alt']) { image.alt = attrs.values['fig-alt']; image.data.hProperties!.alt = image.alt }
            const width = attrs.values.width
            const height = attrs.values.height
            if (width && /^\d+(?:\.\d+)?(?:%|px|em|rem|in|cm)?$/.test(width)) image.data.hProperties!.style = `width:${/^\d+$/.test(width) ? `${width}px` : width};max-width:100%`
            if (height && /^\d+$/.test(height)) image.data.hProperties!.height = height
            // A stand-alone labelled image is a figure. Inline images keep their ID.
            const standalone = node.children!.every(child => child === image || (child.type === 'text' && !child.value?.trim()))
            const ref = register(attrs.id)
            if (standalone && (attrs.id?.startsWith('fig-') || visibleCaption)) {
              delete image.data.hProperties!.id
              node = element('figure', [image, caption([{ type: 'text', value: visibleCaption }], ref?.label)], { ...properties(attrs), className: ['quarto-figure', ...attrs.classes] })
              parent.children[i] = node
              break
            }
          }
        }
        if (node.type === 'table') {
          const next = parent.children[i + 1]
          const previous = parent.children[i - 1]
          const isCaption = (candidate?: Node) => candidate?.type === 'paragraph' && /^(?::|Table:)\s+/.test(text(candidate))
          const cap = isCaption(next) ? next : isCaption(previous) ? previous : undefined
          if (cap) {
            const attrs = takeAttributes(cap)
            const first = cap.children?.[0]
            if (first?.type === 'text') first.value = first.value!.replace(/^(?::|Table:)\s+/, '')
            const ref = register(attrs?.id)
            const wrapper = element('figure', [caption(cap.children ?? [], ref?.label), node], { ...properties(attrs ?? { classes: [], values: {} }), className: ['quarto-table'] })
            if (cap === next) parent.children.splice(i, 2, wrapper)
            else { parent.children.splice(i - 1, 2, wrapper); i-- }
            // The table has no further Quarto block syntax to visit.
            continue
          }
        }
        if (node.data?.hName === 'figure' && !(node.data.hProperties?.className as string[] | undefined)?.some(name => name === 'quarto-figure' || name === 'quarto-table')) {
          const id = node.data.hProperties?.id as string | undefined
          const ref = register(id)
          const last = node.children?.at(-1)
          if (last?.type === 'paragraph') node.children![node.children!.length - 1] = caption(last.children ?? [], ref?.label)
          node.data.hProperties = { ...node.data.hProperties, className: [id?.startsWith('tbl-') ? 'quarto-table' : 'quarto-figure'] }
        }
        if (node.type === 'math') {
          const next = parent.children[i + 1]
          if (next?.type === 'paragraph' && /^\{#eq-[^}]+\}$/.test(text(next))) {
            const attrs = attributes(text(next).slice(1, -1))
            register(attrs.id)
            node.data = { hProperties: properties(attrs) }
            parent.children.splice(i + 1, 1)
          }
        }
        targets(node)
      }
    }
    targets(tree)

    const referenceIds = [...refs.keys()].sort((a, b) => b.length - a.length)
    const references = (parent: Node) => {
      if (!parent.children || ['link', 'linkReference'].includes(parent.type)) return
      parent.children = parent.children.flatMap(node => {
        if (node.type !== 'text') { references(node); return [node] }
        const parts: Node[] = []
        let offset = 0
        const pattern = /(?<![\p{L}\p{N}_@/\\])-?@((?:sec|fig|tbl|eq)-[\p{L}\p{N}_](?:[\p{L}\p{N}_.:-]*[\p{L}\p{N}_-])?)/gu
        for (const match of node.value!.matchAll(pattern)) {
          parts.push({ type: 'text', value: node.value!.slice(offset, match.index) })
          // Korean particles often directly follow a reference. Prefer an exact
          // Unicode ID, then a known ID followed only by Hangul prose.
          const id = refs.has(match[1]) ? match[1] : referenceIds.find(key => match[1].startsWith(key) && /^[가-힣]+$/.test(match[1].slice(key.length))) ?? match[1]
          const suffix = match[1].slice(id.length)
          const ref = refs.get(id)
          parts.push(ref ? {
            type: 'link', url: `#${id}`,
            children: [{ type: 'text', value: match[0].startsWith('-') ? ref.number : ref.label }],
            data: { hProperties: { className: ['quarto-crossref'] } }
          } : element('span', [{ type: 'text', value: match[0] }], { className: ['quarto-unresolved-ref'], dataQuartoReference: true, title: '참조 대상을 이 문서에서 찾을 수 없습니다.' }))
          if (suffix) parts.push({ type: 'text', value: suffix })
          offset = match.index! + match[0].length
        }
        if (!parts.length) return [node]
        parts.push({ type: 'text', value: node.value!.slice(offset) })
        return parts
      })
    }
    references(tree)

    // Work on parsed prose so highlight markers inside any code fence or
    // inline code stay literal, including Quarto's tilde-fenced cells.
    const highlights = (parent: Node) => {
      if (!parent.children) return
      parent.children = parent.children.flatMap(node => {
        if (node.type !== 'text') { highlights(node); return [node] }
        const parts: Node[] = []
        let offset = 0
        for (const match of node.value!.matchAll(/==(?=\S)(.+?\S)==/g)) {
          parts.push({ type: 'text', value: node.value!.slice(offset, match.index) })
          parts.push({ type: 'emphasis', data: { hName: 'mark' }, children: [{ type: 'text', value: match[1] }] })
          offset = match.index! + match[0].length
        }
        return parts.length ? [...parts, { type: 'text', value: node.value!.slice(offset) }] : [node]
      })
    }
    highlights(tree)
  }
}

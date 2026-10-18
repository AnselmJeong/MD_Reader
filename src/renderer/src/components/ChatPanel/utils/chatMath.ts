import type { Parent, Root, RootContent } from 'mdast'

// Convert alternate LaTeX delimiters without touching fenced/inline code.
export function normalizeMathDelimiters(content: string): string {
  return content.split(/(`{3,}[^\n]*\n[\s\S]*?`{3,}|~{3,}[^\n]*\n[\s\S]*?~{3,}|`+[^`]*`+)/g)
    .map(part => /^[`~]/.test(part) ? part : part
      .replace(/\\\[([\s\S]*?)\\\]/g, (_match, math: string) => `\n$$\n${math.trim()}\n$$\n`)
      .replace(/\\\(([^\n]*?)\\\)/g, (_match, math: string) => `$${math}$`))
    .join('')
}

function legacyLatex(value: string): string {
  return value.replace(/−/g, '-').replace(/Σ/g, '\\sum').replace(/∑/g, '\\sum')
    .replace(/([_^])([a-zA-Z0-9]+)/g, '$1{$2}')
    .replace(/\bsign\(/g, '\\operatorname{sign}(')
}

function mathNode(value: string, display = false): RootContent {
  const latex = legacyLatex(value)
  return {
    type: display ? 'math' : 'inlineMath', value: latex,
    data: { hName: 'code', hProperties: { className: ['language-math', display ? 'math-display' : 'math-inline'] },
      hChildren: [{ type: 'text', value: latex }] }
  }
}

// Older saved replies sometimes contain unmarked math. Only recognize explicit
// subscript notation and math-only equation paragraphs, never arbitrary prose.
export function remarkLegacyChatMath() {
  return (tree: Root) => {
    const visit = (parent: Parent) => {
      if (parent.type === 'link' || parent.type === 'linkReference') return
      if (parent.type === 'paragraph' && parent.children.length === 1 && parent.children[0].type === 'text') {
        const value = parent.children[0].value.trim()
        if (/[=<>]/.test(value) && /_|[Σ∑]/.test(value)
          && /^[A-Za-z0-9Σ∑α-ωΑ-Ω_{}()[\]^=<>+−*/.,\s-]+$/u.test(value)) {
          parent.children = [mathNode(value, true)]
          return
        }
      }
      parent.children = parent.children.flatMap((node): RootContent[] => {
        if ('children' in node) visit(node)
        if (node.type !== 'text') return [node]
        const atom = String.raw`(?:[A-Za-zΣ∑α-ωΑ-Ω]_(?:\{[A-Za-z0-9,]+\}|[A-Za-z0-9]+))`
        const expression = new RegExp(String.raw`(?<![\p{L}\p{N}_])(?:sign\([Σ∑A-Za-z0-9_{}+*/=\s-]+\)|${atom})(?:(?:\s*[=+−*/-]\s*(?:${atom}|\d+(?:\.\d+)?))|(?:\s+${atom}))*`, 'gu')
        const parts: RootContent[] = []
        let offset = 0
        for (const match of node.value.matchAll(expression)) {
          if (match.index > offset) parts.push({ type: 'text', value: node.value.slice(offset, match.index) })
          parts.push(mathNode(match[0]))
          offset = match.index + match[0].length
        }
        if (!parts.length) return [node]
        if (offset < node.value.length) parts.push({ type: 'text', value: node.value.slice(offset) })
        return parts
      })
    }
    visit(tree)
  }
}

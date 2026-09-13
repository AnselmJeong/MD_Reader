import type { Parent, Root, RootContent } from 'mdast'

const citationPattern = /(?<![\p{L}\p{N}_@/])-?@([\p{L}\p{N}_](?:[\p{L}\p{N}_:.#$%&+?<>~/-]*[\p{L}\p{N}_])?)/gu
const tokenPattern = new RegExp(`\\[[^\\[\\]]*\\]|${citationPattern.source}`, 'gu')

// Number references by first appearance in this document. Keep the original
// key on each target so bibliography changes still update the hover title.
export function remarkCitations() {
  return (tree: Root) => {
    const numbers = new Map<string, number>()
    const citation = (key: string, suffix = ''): RootContent => {
      const normalized = key.toLowerCase()
      let number = numbers.get(normalized)
      if (number === undefined) {
        number = numbers.size + 1
        numbers.set(normalized, number)
      }
      return {
        type: 'emphasis',
        data: { hName: 'span', hProperties: { className: ['citation'], dataCiteKey: key, tabIndex: 0 } },
        children: [{ type: 'text', value: `[${number}${suffix}]` }]
      }
    }

    const visit = (parent: Parent) => {
      if (parent.data?.hProperties?.dataQuartoReference) return
      if (parent.type === 'link' || parent.type === 'linkReference') return
      parent.children = parent.children.flatMap((node): RootContent[] => {
        if ('children' in node) visit(node)
        if (node.type !== 'text') return [node]

        const parts: RootContent[] = []
        let offset = 0
        for (const token of node.value.matchAll(tokenPattern)) {
          let replacement: RootContent[]
          if (token[0].startsWith('[')) {
            const items = token[0].slice(1, -1).split(';').map((text) => ({
              text: text.trim(), matches: [...text.trim().matchAll(citationPattern)]
            }))
            // Only consume citation groups; ordinary bracketed text remains literal.
            if (!items.every((item) => item.matches.length === 1)) continue
            replacement = items.flatMap(({ text, matches }, index): RootContent[] => {
              const match = matches[0]
              const prefix = text.slice(0, match.index)
              const suffix = text.slice(match.index + match[0].length).trimEnd()
              return [
                ...(index ? [{ type: 'text' as const, value: ', ' }] : []),
                ...(prefix ? [{ type: 'text' as const, value: prefix }] : []),
                citation(match[1], suffix)
              ]
            })
          } else {
            replacement = [citation(token[1])]
          }
          if (token.index > offset) parts.push({ type: 'text', value: node.value.slice(offset, token.index) })
          parts.push(...replacement)
          offset = token.index + token[0].length
        }
        if (!parts.length) return [node]
        if (offset < node.value.length) parts.push({ type: 'text', value: node.value.slice(offset) })
        return parts
      })
      if (parent.type === 'paragraph' && parent.children[0]?.data?.hProperties?.dataCiteKey) {
        parent.data = {
          ...parent.data,
          hProperties: { ...parent.data?.hProperties, dataCitationLeading: true }
        }
      }
    }
    visit(tree)
  }
}

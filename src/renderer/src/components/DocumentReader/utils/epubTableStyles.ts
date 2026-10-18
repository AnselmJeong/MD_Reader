// A block-level scroll container on the table itself avoids wrapping source nodes
// (which would invalidate EPUB CFI paths). Anonymous table layout keeps column alignment.
export const epubTableStyles = {
  table: {
    display: 'block !important', width: '100% !important', 'max-width': '100% !important',
    'min-width': '0 !important', 'table-layout': 'auto !important',
    'overflow-x': 'auto !important', 'overflow-y': 'auto !important',
    'max-height': '75vh', 'break-inside': 'avoid',
    'border-collapse': 'collapse', 'border-spacing': '0',
    'border-top': '2px solid currentColor !important', 'border-bottom': '2px solid currentColor !important',
    margin: '1em 0', 'overscroll-behavior': 'contain',
  },
  'th, td': {
    'min-width': '7em !important', 'max-width': '24em', padding: '.55em .75em !important',
    'vertical-align': 'top !important', 'word-break': 'normal !important',
    'overflow-wrap': 'normal !important', 'white-space': 'normal', 'line-height': '1.6',
  },
  'thead > tr:last-child > th, thead > tr:last-child > td, tr:first-child > th': {
    'border-bottom': '1px solid currentColor !important',
  },
  'td p, th p': { margin: '.25em 0', 'line-height': '1.6' },
  'td math, th math, td .katex, th .katex': { 'white-space': 'nowrap' },
}

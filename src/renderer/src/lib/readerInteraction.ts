/** Mounted readers must not react to global shortcuts while Home or a modal owns focus. */
export function isReaderInteractionBlocked(root: Element | null): boolean {
  return Boolean(root?.closest('[inert]') || document.querySelector('dialog[open], [role="dialog"][data-state="open"]'))
}

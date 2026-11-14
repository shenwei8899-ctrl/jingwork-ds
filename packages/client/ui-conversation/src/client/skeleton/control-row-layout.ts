/** Measure the composer's flex lines for a compact model selector when needed. */

/**
 * Collapse the model text only when one flex line overflows its available width.
 * Wrapped lines are measured independently, so an otherwise roomy model seat keeps
 * its name visible. Each notification is measured synchronously.
 * @param row - Composer control row with its leading and trailing groups.
 * @returns Disconnect the layout observers and font listener.
 */
export function observeControlRow(row: HTMLElement): () => void {
  const measure = (): void => {
    // Always measure expanded demand, including text changed while collapsed.
    row.removeAttribute('data-model-compact')
    const style = getComputedStyle(row)
    const available = row.getBoundingClientRect().width
      - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    const lines = new Map<number, number[]>()
    for (const child of Array.from(row.children)) {
      const { width, top } = child.getBoundingClientRect()
      if (width <= 0) continue
      const line = lines.get(top) ?? []
      line.push(width)
      lines.set(top, line)
    }
    const gap = parseFloat(style.columnGap)
    const exceedsLine = [...lines.values()].some(widths =>
      widths.reduce((sum, width) => sum + width, 0)
      + Math.max(0, widths.length - 1) * gap > available)
    row.toggleAttribute('data-model-compact', exceedsLine)
  }
  const resize = new ResizeObserver(measure)
  resize.observe(row)
  for (const child of row.children) resize.observe(child)
  const mutation = new MutationObserver(measure)
  mutation.observe(row, {
    subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['hidden'],
  })
  const fonts = document.fonts
  fonts.addEventListener('loadingdone', measure)
  measure()
  return () => {
    resize.disconnect()
    mutation.disconnect()
    fonts.removeEventListener('loadingdone', measure)
  }
}

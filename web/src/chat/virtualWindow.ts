export type VirtualWindowInput = {
  itemHeights: ReadonlyArray<number>
  scrollTop: number
  viewportHeight: number
  overscan: number
}

export type VirtualWindowResult = {
  // endIndex is -1 for empty lists so callers can iterate
  // `for (let i = startIndex; i <= endIndex; i++)` safely.
  startIndex: number
  endIndex: number
  paddingTop: number
  paddingBottom: number
}

export function computeVirtualWindow(input: VirtualWindowInput): VirtualWindowResult {
  const { itemHeights, scrollTop, viewportHeight, overscan } = input
  const total = itemHeights.length
  if (total === 0) {
    return { startIndex: 0, endIndex: -1, paddingTop: 0, paddingBottom: 0 }
  }

  // iOS rubber-band scrolling can momentarily report negative scrollTop;
  // clamping keeps the head visible during overscroll.
  const safeScrollTop = scrollTop < 0 ? 0 : scrollTop
  const viewportBottom = safeScrollTop + viewportHeight

  let cumulative = 0
  let firstVisible = total
  for (let i = 0; i < total; i++) {
    if (cumulative + itemHeights[i] > safeScrollTop) {
      firstVisible = i
      break
    }
    cumulative += itemHeights[i]
  }
  if (firstVisible === total) {
    // Scrolled past the end — show the last item.
    firstVisible = total - 1
    cumulative -= itemHeights[firstVisible]
  }
  // cumulative now equals the top edge of firstVisible.

  let lastVisible = firstVisible
  let runningBottom = cumulative + itemHeights[firstVisible]
  for (let i = firstVisible + 1; i < total; i++) {
    if (runningBottom >= viewportBottom) break
    runningBottom += itemHeights[i]
    lastVisible = i
  }

  const startIndex = Math.max(0, firstVisible - overscan)
  const endIndex = Math.min(total - 1, lastVisible + overscan)

  // paddingTop: derive from the already-known top of firstVisible, subtracting
  // the (≤ overscan) head items pulled into the rendered range.
  let paddingTop = cumulative
  for (let i = startIndex; i < firstVisible; i++) paddingTop -= itemHeights[i]

  let paddingBottom = 0
  for (let i = endIndex + 1; i < total; i++) paddingBottom += itemHeights[i]

  return { startIndex, endIndex, paddingTop, paddingBottom }
}

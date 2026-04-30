export type VirtualWindowInput = {
  itemHeights: ReadonlyArray<number>
  scrollTop: number
  viewportHeight: number
  // Items rendered beyond the visible window in each direction. A few extra
  // smooths fast scrolling: items already mounted before they cross the
  // viewport edge avoid a paint-blank flash. Caller-tunable; 4 is a good
  // default for chat.
  overscan: number
}

export type VirtualWindowResult = {
  // First and last item indexes to mount (inclusive). endIndex is -1 for
  // empty lists so callers can use `for (let i = startIndex; i <= endIndex; i++)`
  // safely.
  startIndex: number
  endIndex: number
  // Spacer heights for the unrendered head and tail. Sum with the rendered
  // items' heights and the result equals the total content height — the
  // outer scroll container reads the right scrollHeight.
  paddingTop: number
  paddingBottom: number
}

// Linear-scan windowing. O(N) per call; for N=10k this is still microseconds
// because the loop body is a single addition. A prefix-sum cache would amortize
// further but is not yet needed — chat threads at the 60fps target sit well
// under the budget without it.
export function computeVirtualWindow(input: VirtualWindowInput): VirtualWindowResult {
  const { itemHeights, scrollTop, viewportHeight, overscan } = input
  const total = itemHeights.length
  if (total === 0) {
    return { startIndex: 0, endIndex: -1, paddingTop: 0, paddingBottom: 0 }
  }

  const safeScrollTop = scrollTop < 0 ? 0 : scrollTop
  const viewportBottom = safeScrollTop + viewportHeight

  let cumulative = 0
  let firstVisible = total - 1
  for (let i = 0; i < total; i++) {
    const next = cumulative + itemHeights[i]
    if (next > safeScrollTop) {
      firstVisible = i
      break
    }
    cumulative = next
    firstVisible = i + 1
  }
  if (firstVisible >= total) firstVisible = total - 1

  let lastVisible = firstVisible
  let runningBottom = cumulative
  for (let i = firstVisible; i < total; i++) {
    runningBottom += itemHeights[i]
    lastVisible = i
    if (runningBottom >= viewportBottom) break
  }

  const startIndex = Math.max(0, firstVisible - overscan)
  const endIndex = Math.min(total - 1, lastVisible + overscan)

  let paddingTop = 0
  for (let i = 0; i < startIndex; i++) paddingTop += itemHeights[i]
  let paddingBottom = 0
  for (let i = endIndex + 1; i < total; i++) paddingBottom += itemHeights[i]

  return { startIndex, endIndex, paddingTop, paddingBottom }
}

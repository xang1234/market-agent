export type ScrollPosition = {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

// Pixels from the absolute bottom that still count as "at bottom" for the
// purposes of auto-tailing. Absorbs subpixel rounding (browsers) and tiny
// overscroll without breaking the tail.
export const DEFAULT_AT_BOTTOM_THRESHOLD = 50

export function isAtBottom(
  position: ScrollPosition,
  threshold: number = DEFAULT_AT_BOTTOM_THRESHOLD,
): boolean {
  const distanceFromBottom = position.scrollHeight - position.scrollTop - position.clientHeight
  return distanceFromBottom <= threshold
}

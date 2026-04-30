export type ScrollPosition = {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

export const DEFAULT_AT_BOTTOM_THRESHOLD = 50

export function isAtBottom(
  position: ScrollPosition,
  threshold: number = DEFAULT_AT_BOTTOM_THRESHOLD,
): boolean {
  const distanceFromBottom = position.scrollHeight - position.scrollTop - position.clientHeight
  return distanceFromBottom <= threshold
}

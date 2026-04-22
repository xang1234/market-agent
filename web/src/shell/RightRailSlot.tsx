import { useRightRail } from './useRightRail'
import { getRightRailState } from './rightRailState'

// Always mounted — main-canvas width stays stable across tab switches
// regardless of whether a surface has pushed content. When no content is
// pushed the rail renders as an empty labeled landmark; surfaces that want
// the wider canvas (e.g., Screener per spec §3.7) will opt out via a
// context flag when that surface ships.
export function RightRailSlot() {
  const { content } = useRightRail()
  const railState = getRightRailState(content)

  return (
    <aside
      aria-label="Activity rail"
      className="flex h-full w-80 shrink-0 flex-col border-l border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
    >
      {railState.mode === 'content' ? railState.content : <div className="flex-1" aria-hidden="true" />}
    </aside>
  )
}

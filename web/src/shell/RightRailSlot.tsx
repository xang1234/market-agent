import { useRightRail } from './useRightRail'
import { getRightRailState } from './rightRailState'

// Collapses when no surface has pushed content: the main canvas takes the full
// width instead of reserving an empty 320px column (the dead-space the symbol
// page used to show when a subject had no issuer context). Surfaces that want
// the rail push content via useRightRailContent; everything else gets the wide
// canvas for free.
export function RightRailSlot() {
  const { content } = useRightRail()
  const railState = getRightRailState(content)

  if (railState.mode !== 'content') return null

  return (
    <aside
      aria-label="Activity rail"
      className="flex h-full w-80 shrink-0 flex-col border-l border-line bg-surface"
    >
      {railState.content}
    </aside>
  )
}

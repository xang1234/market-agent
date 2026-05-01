import type { ReactElement } from 'react'

import { StreamingBlockView } from './StreamingBlockView.tsx'
import type { StreamState } from './streamReducer.ts'

type StreamingTurnViewProps = {
  state: StreamState
}

// Renders the in-progress turn — the visible counterpart of the streamReducer
// state. Surfaces error state as a small inline notice; turn.completed leaves
// rendering to the canonical message that the parent will append once the
// snapshot is sealed.
export function StreamingTurnView({ state }: StreamingTurnViewProps): ReactElement | null {
  if (state.turn_status === 'idle' || state.turn_status === 'completed') {
    return null
  }

  return (
    <div
      data-testid="streaming-turn"
      data-turn-status={state.turn_status}
      className="flex flex-col gap-2 px-4 py-3"
    >
      {state.block_order.map((block_id) => {
        const block = state.blocks_by_id.get(block_id)
        if (block === undefined) return null
        return <StreamingBlockView key={block_id} block={block} />
      })}
      {state.turn_status === 'error' ? (
        <p
          data-testid="streaming-turn-error"
          className="text-sm text-rose-700 dark:text-rose-300"
        >
          Stream error: {state.error ?? 'unknown'}
        </p>
      ) : null}
    </div>
  )
}

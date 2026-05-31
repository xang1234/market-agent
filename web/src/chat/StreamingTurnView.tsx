import type { ReactElement } from 'react'

import { StreamingBlockView } from './StreamingBlockView.tsx'
import type { StreamState } from './streamReducer.ts'
import { AssistantTurn } from './turnLayout.tsx'

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
    <AssistantTurn data-testid="streaming-turn" data-turn-status={state.turn_status}>
      {state.block_order.map((block_id) => {
        const block = state.blocks_by_id.get(block_id)
        if (block === undefined) return null
        return <StreamingBlockView key={block_id} block={block} />
      })}
      {state.turn_status === 'error' ? (
        <p data-testid="streaming-turn-error" className="text-sm text-negative">
          Stream error: {state.error ?? 'unknown'}
        </p>
      ) : null}
    </AssistantTurn>
  )
}

import type { ReactElement } from 'react'

import { BlockView } from '../blocks/BlockView.tsx'
import { AgentPlanPanel } from './AgentPlanPanel.tsx'
import { StreamingBlockView } from './StreamingBlockView.tsx'
import type { StreamState, UnverifiedTurn } from './streamReducer.ts'
import { AssistantTurn, BlockColumn } from './turnLayout.tsx'

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
  if (state.turn_status === 'unverified' && state.unverified) {
    return <UnverifiedTurnView state={state} unverified={state.unverified} />
  }

  return (
    <div
      data-testid="streaming-turn"
      data-turn-status={state.turn_status}
      aria-live="polite"
      className="flex w-full flex-col gap-3"
    >
      <AgentPlanPanel steps={state.plan_steps} />
      <AssistantTurn className="w-full">
        {state.block_order.map((block_id) => {
          const block = state.blocks_by_id.get(block_id)
          if (block === undefined) return null
          return (
            <BlockColumn key={block_id} kind={block.kind}>
              <StreamingBlockView block={block} />
            </BlockColumn>
          )
        })}
      </AssistantTurn>
      {state.turn_status === 'error' ? (
        <p data-testid="streaming-turn-error" className="text-sm text-negative">
          Stream error: {state.error ?? 'unknown'}
        </p>
      ) : null}
    </div>
  )
}

// Development only (CHAT_VERIFICATION_MODE=display_unverified): the answer failed
// verification and is shown so it can be debugged. Each block carries its own
// "Unverified" label; nothing here was saved, so it is gone after a reload.
function UnverifiedTurnView({ state, unverified }: { state: StreamState; unverified: UnverifiedTurn }): ReactElement {
  return (
    <div data-testid="streaming-turn" data-turn-status="unverified" className="flex w-full flex-col gap-3">
      <AgentPlanPanel steps={state.plan_steps} />
      <div className="rounded border border-negative/40 bg-negative-soft px-3 py-2 text-sm text-negative">
        <p>This answer failed verification and was not saved. It is shown because development mode displays unverified answers.</p>
        <details data-testid="unverified-reasons" className="mt-1">
          <summary className="cursor-pointer text-xs font-medium">Why unverified</summary>
          <ul className="mt-1 list-disc pl-5 font-mono text-xs">
            {unverified.failures.map((failure, index) => (
              <li key={index}>
                {String(failure.reason_code ?? 'unknown')}
                {failure.details ? ` ${JSON.stringify(failure.details)}` : ''}
              </li>
            ))}
          </ul>
        </details>
      </div>
      <AssistantTurn className="w-full">
        {unverified.blocks.map((block) => (
          <BlockColumn key={block.id} kind={block.kind}>
            <BlockView block={block} verification="unverified" />
          </BlockColumn>
        ))}
      </AssistantTurn>
    </div>
  )
}

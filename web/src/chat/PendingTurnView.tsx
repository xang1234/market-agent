import type { ReactElement, ReactNode } from 'react'

import { BlockView } from '../blocks/BlockView.tsx'
import { AgentPlanPanel } from './AgentPlanPanel.tsx'
import { AssistantBlocks } from './MessageItem.tsx'
import type { StreamLink, TurnState } from './chatSession.ts'
import type { ChatMessage } from './messageTypes.ts'
import { StreamingBlockView } from './StreamingBlockView.tsx'
import type { StreamState, UnverifiedTurn } from './streamReducer.ts'
import { AssistantTurn, BlockColumn, USER_BUBBLE_CLASS } from './turnLayout.tsx'

type PendingTurnViewProps = {
  turn: TurnState
  // The thread's messages, which may already hold the answer the turn shows.
  messages: ReadonlyArray<ChatMessage>
  onRetry: () => void
  onReconnect: () => void
  onReload: () => void
  onAsk: (text: string) => boolean
}

const ACTION_BUTTON_CLASS = 'rounded-md border border-negative px-3 py-1.5 text-xs font-medium text-negative'

// The turn that is not yet in the thread's history. Streaming and failed
// render through one tree, so React keeps the answer's DOM nodes until the
// completion commit replaces them with the sealed MessageItem.
export function PendingTurnView({ turn, messages, onRetry, onReconnect, onReload, onAsk }: PendingTurnViewProps): ReactElement | null {
  switch (turn.phase) {
    case 'idle':
      return null
    case 'persisting':
      return (
        <div data-testid="pending-turn" className="flex flex-col gap-2 py-2">
          <OptimisticUserBubble text={turn.turn.text} askedRun={turn.turn.runId} />
          <p className="text-sm text-muted">Starting…</p>
        </div>
      )
    case 'not_sent':
      return (
        <div data-testid="pending-turn" className="flex flex-col gap-2 py-2">
          <OptimisticUserBubble text={turn.text} />
          <div className="flex items-center gap-3 text-sm">
            <p className="text-negative">Message save failed: {turn.error}</p>
            <button type="button" onClick={() => onAsk(turn.text)} className={ACTION_BUTTON_CLASS}>
              Send again
            </button>
          </div>
        </div>
      )
    case 'unverified':
      return turn.stream.unverified ? <UnverifiedTurnView state={turn.stream} unverified={turn.stream.unverified} /> : null
    case 'streaming':
      return (
        <StreamedTurn phase={turn.phase} stream={turn.stream} blocks={turn.origin.kind === 'own'} messages={messages}>
          <LinkNotice link={turn.link} onReconnect={onReconnect} />
        </StreamedTurn>
      )
    case 'failed':
      return (
        <StreamedTurn phase={turn.phase} stream={turn.stream} blocks={turn.origin.kind === 'own'} messages={messages}>
          {turn.recovery === 'none'
            ? <p className="text-sm text-negative">{turn.error}</p>
            : (
              <TurnNotice
                message={turn.error}
                action={turn.recovery === 'reload_thread' ? 'Reload thread' : 'Retry'}
                onAction={turn.recovery === 'reload_thread' ? onReload : onRetry}
              />
            )}
        </StreamedTurn>
      )
  }
}

function LinkNotice({ link, onReconnect }: { link: StreamLink; onReconnect: () => void }): ReactElement | null {
  switch (link.kind) {
    case 'open':
      if (link.attach) return <p className="text-sm text-muted">The analyst is still answering this question.</p>
      return link.drops > 0 ? <p className="text-sm text-muted">Reconnecting to the analyst…</p> : null
    case 'reconnecting':
      return <p className="text-sm text-muted">Reconnecting to the analyst…</p>
    case 'offline':
      return <TurnNotice message="Lost the connection to the analyst." action="Reconnect" onAction={onReconnect} />
  }
}

function StreamedTurn({ phase, stream, blocks, messages, children }: { phase: TurnState['phase']; stream: StreamState; blocks: boolean; messages: ReadonlyArray<ChatMessage>; children?: ReactNode }): ReactElement {
  const { shown } = stream
  // A sealed answer, shown while the judge reads its inferences: it renders as
  // the saved message it becomes, in MessageItem's own wrapper and with no plan
  // above it, so the hand-off changes only the lines the judge resolves. Any
  // reader of the run may see it: it holds only what the seal verified. An
  // engine answer is saved before its commentary is written, so a load in that
  // window holds it, and history shows it instead.
  if (shown && !messages.some((message) => message.message_id === shown.message_id)) {
    return (
      <div data-testid="streaming-turn" data-turn-status={phase} aria-live="polite" className="flex flex-col items-start py-2">
        <AssistantBlocks blocks={shown.blocks} proofs={shown.block_proofs} />
        {children}
      </div>
    )
  }
  return (
    <div
      data-testid="streaming-turn"
      data-turn-status={phase}
      aria-live="polite"
      className="flex w-full flex-col gap-3 py-2"
    >
      <AgentPlanPanel steps={stream.plan_steps} />
      {/* The server may read the question before it starts the turn (#398). */}
      {phase === 'streaming' && stream.turn_status === 'idle' ? <p className="text-sm text-muted">Starting…</p> : null}
      <AssistantTurn className="w-full">
        {blocks && stream.block_order.map((block_id) => {
          const block = stream.blocks_by_id.get(block_id)
          if (block === undefined) return null
          return (
            <BlockColumn key={block_id} kind={block.kind}>
              <StreamingBlockView block={block} snapshotId={stream.snapshot_id} />
            </BlockColumn>
          )
        })}
      </AssistantTurn>
      {children}
    </div>
  )
}

function TurnNotice({ message, action, onAction }: { message: string; action: string; onAction: () => void }): ReactElement {
  return (
    <div className="flex items-center gap-3 text-sm">
      <p className="text-negative">{message}</p>
      <button type="button" onClick={onAction} className={ACTION_BUTTON_CLASS}>
        {action}
      </button>
    </div>
  )
}

// `askedRun` marks a question being sent now, each send its own run, so the
// thread can pin it to the top; a question that failed to send has none.
function OptimisticUserBubble({ text, askedRun }: { text: string; askedRun?: string }): ReactElement {
  return (
    <div data-role="pending-user" data-asked-run={askedRun} className="flex flex-col items-end">
      <div className={USER_BUBBLE_CLASS}>
        <p className="whitespace-pre-wrap text-sm">{text}</p>
      </div>
    </div>
  )
}

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

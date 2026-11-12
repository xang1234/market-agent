import { memo, useLayoutEffect, useRef, useState, type ReactElement } from 'react'

import { MemoizedBlockView } from '../blocks/MemoizedBlockView.tsx'
import { CopyButton } from '../blocks/CopyButton.tsx'
import { answerCopy } from '../blocks/answerText.ts'
import { UNPROVEN, type BlockProof } from '../blocks/blockProof.ts'
import type { Block } from '../blocks/types.ts'
import type { ChatMessage } from './messageTypes.ts'
import { messageTime } from './messageTime.ts'
import { AssistantTurn, BlockColumn, USER_BUBBLE_CLASS } from './turnLayout.tsx'

type MessageItemProps = {
  message: ChatMessage
  onMeasure: (messageId: string, height: number) => void
}

function MessageItemInner({ message, onMeasure }: MessageItemProps): ReactElement {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    // The whole box, padding included: the virtual window stacks these heights.
    const measure = () => onMeasure(message.message_id, el.getBoundingClientRect().height)
    // Now, in the commit that mounts it: a list that windows on its estimate
    // instead can move the view, unmount it unmeasured, and never settle.
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [message.message_id, onMeasure])

  const isUser = message.role === 'user'
  return (
    <div
      ref={ref}
      data-testid={`chat-message-${message.message_id}`}
      data-message-id={message.message_id}
      data-role={message.role}
      className={`flex flex-col py-2 ${isUser ? 'items-end' : 'items-start'}`}
    >
      {isUser ? (
        <>
          <div className={USER_BUBBLE_CLASS}>
            {message.blocks.map((block) => (
              <MemoizedBlockView key={block.id} block={block} />
            ))}
          </div>
          <MessageTime createdAt={message.created_at} className="mt-1" />
        </>
      ) : (
        <>
          <AssistantBlocks blocks={message.blocks} proofs={message.block_proofs} />
          <div className="mt-1 flex items-center gap-1">
            <CopyButton iconOnly label="Copy answer" what="this answer" purpose="as text" text={() => answerCopy(message)} />
            <MessageTime createdAt={message.created_at} />
          </div>
        </>
      )}
    </div>
  )
}

function MessageTime({ createdAt, className = '' }: { createdAt: string; className?: string }): ReactElement | null {
  const [now] = useState(() => new Date())
  const time = messageTime(createdAt, now)
  if (time === null) return null
  return (
    <time dateTime={createdAt} title={time.full} className={`px-1 text-xs text-faint tabular-nums ${className}`}>
      {time.short}
    </time>
  )
}

// An assistant answer's blocks, each with its proof: a saved message, and the
// sealed answer shown before its turn completes (PendingTurnView), through one
// tree, so the hand-off from one to the other moves nothing.
export function AssistantBlocks({ blocks, proofs }: { blocks: ReadonlyArray<Block>; proofs: Readonly<Record<string, BlockProof>> | undefined }): ReactElement {
  return (
    <AssistantTurn className="w-full">
      {blocks.map((block) => (
        <BlockColumn key={block.id} kind={block.kind}>
          <MemoizedBlockView block={block} proof={proofFor(proofs, block.id)} />
        </BlockColumn>
      ))}
    </AssistantTurn>
  )
}

// A message the server assessed carries a proof for every block it can claim
// anything about; a block it has none for is unproven, never unassessed (which
// would let a certified-looking answer keep its default label).
function proofFor(proofs: Readonly<Record<string, BlockProof>> | undefined, blockId: string): BlockProof | undefined {
  if (proofs === undefined) return undefined
  return Object.hasOwn(proofs, blockId) ? proofs[blockId] : UNPROVEN
}

export const MessageItem = memo(
  MessageItemInner,
  (prev, next) => prev.message === next.message && prev.onMeasure === next.onMeasure,
)

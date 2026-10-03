import { memo, useLayoutEffect, useRef, type ReactElement } from 'react'

import { MemoizedBlockView } from '../blocks/MemoizedBlockView.tsx'
import type { BlockProof } from '../blocks/blockProof.ts'
import type { ChatMessage } from './messageTypes.ts'
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
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry === undefined) return
      onMeasure(message.message_id, entry.contentRect.height)
    })
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
        <div className={USER_BUBBLE_CLASS}>
          {message.blocks.map((block) => (
            <MemoizedBlockView key={block.id} block={block} />
          ))}
        </div>
      ) : (
        <AssistantTurn className="w-full">
          {message.blocks.map((block) => (
            <BlockColumn key={block.id} kind={block.kind}>
              <MemoizedBlockView block={block} proof={proofFor(message, block.id)} />
            </BlockColumn>
          ))}
        </AssistantTurn>
      )}
    </div>
  )
}

// A message the server assessed carries a proof for every block it can claim
// anything about; a block it has none for is unproven, never unassessed (which
// would let a certified-looking answer keep its default label).
function proofFor(message: ChatMessage, blockId: string): BlockProof | undefined {
  if (message.block_proofs === undefined) return undefined
  return Object.hasOwn(message.block_proofs, blockId) ? message.block_proofs[blockId] : UNPROVEN
}

const UNPROVEN: BlockProof = { evidence: 'unknown', calculation: 'not_verified', public_by_cutoff: 'unknown' }

export const MessageItem = memo(
  MessageItemInner,
  (prev, next) => prev.message === next.message && prev.onMeasure === next.onMeasure,
)

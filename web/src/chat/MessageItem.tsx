import { memo, useLayoutEffect, useRef, type ReactElement } from 'react'

import { MemoizedBlockView } from '../blocks/MemoizedBlockView.tsx'
import type { ChatMessage } from './messageTypes.ts'
import { AssistantTurn, USER_BUBBLE_CLASS } from './turnLayout.tsx'

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
  const blocks = message.blocks.map((block) => (
    <MemoizedBlockView key={block.id} block={block} />
  ))
  return (
    <div
      ref={ref}
      data-testid={`chat-message-${message.message_id}`}
      data-message-id={message.message_id}
      data-role={message.role}
      className={`flex flex-col py-2 ${isUser ? 'items-end' : 'items-stretch'}`}
    >
      {isUser ? (
        <div className={USER_BUBBLE_CLASS}>{blocks}</div>
      ) : (
        <AssistantTurn>{blocks}</AssistantTurn>
      )}
    </div>
  )
}

export const MessageItem = memo(
  MessageItemInner,
  (prev, next) => prev.message === next.message && prev.onMeasure === next.onMeasure,
)

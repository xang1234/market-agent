import { memo, useLayoutEffect, useRef, type ReactElement } from 'react'

import { MemoizedBlockView } from '../blocks/MemoizedBlockView.tsx'
import type { ChatMessage } from './messageTypes.ts'

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
      className={`flex flex-col py-2 ${isUser ? 'items-end' : 'items-stretch'}`}
    >
      <div className={isUser ? USER_BUBBLE_CLASS : ASSISTANT_CARD_CLASS}>
        {message.blocks.map((block) => (
          <MemoizedBlockView key={block.id} block={block} />
        ))}
      </div>
    </div>
  )
}

// User turns stay a compact right-aligned bubble; assistant turns get the full
// answer canvas (redesign hierarchy). The bubble gradient is theme-independent
// by design so it reads as a "sent message" in both light and dark.
const USER_BUBBLE_CLASS =
  'max-w-[80%] rounded-2xl rounded-br-md border border-[#244a6e] bg-gradient-to-b from-[#1d3a59] to-[#16314c] px-3.5 py-2.5 text-[#dcebff] shadow-md'
const ASSISTANT_CARD_CLASS =
  'flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 shadow-md'

export const MessageItem = memo(
  MessageItemInner,
  (prev, next) => prev.message === next.message && prev.onMeasure === next.onMeasure,
)

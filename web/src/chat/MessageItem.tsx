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
    // ResizeObserver fires on initial observe with the current size, so we
    // get the first measurement without a separate read. Subsequent fires
    // come on layout-affecting changes (font load, image decode, content
    // streaming).
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry === undefined) return
      onMeasure(message.message_id, entry.contentRect.height)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [message.message_id, onMeasure])

  return (
    <div
      ref={ref}
      data-testid={`chat-message-${message.message_id}`}
      data-message-id={message.message_id}
      data-role={message.role}
      className="flex flex-col gap-2 px-4 py-3"
    >
      {message.blocks.map((block) => (
        <MemoizedBlockView key={block.id} block={block} />
      ))}
    </div>
  )
}

// Bails out when both the message reference and the onMeasure callback are
// stable. The parent uses content_hash as the React key, so a message-content
// change unmounts/remounts this component instead of relying on memo bailout
// for content equality.
export const MessageItem = memo(
  MessageItemInner,
  (prev, next) => prev.message === next.message && prev.onMeasure === next.onMeasure,
)

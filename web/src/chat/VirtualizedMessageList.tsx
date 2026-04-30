import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react'

import { JumpToLatestButton } from './JumpToLatestButton.tsx'
import { MessageItem } from './MessageItem.tsx'
import type { ChatMessage } from './messageTypes.ts'
import { isAtBottom } from './scrollTailing.ts'
import { computeVirtualWindow } from './virtualWindow.ts'

const DEFAULT_ESTIMATED_ITEM_HEIGHT = 200
const DEFAULT_OVERSCAN = 4

export type VirtualizedMessageListProps = {
  messages: ReadonlyArray<ChatMessage>
  estimatedItemHeight?: number
  overscan?: number
}

export function VirtualizedMessageList({
  messages,
  estimatedItemHeight = DEFAULT_ESTIMATED_ITEM_HEIGHT,
  overscan = DEFAULT_OVERSCAN,
}: VirtualizedMessageListProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollRafRef = useRef<number | null>(null)
  // Captured at the last observed scroll position — read pre-update by the
  // auto-tail effect because by effect-time el.scrollHeight already includes
  // the new message and a fresh isAtBottom() would lie.
  const wasAtBottomRef = useRef(true)
  const lastMessageIdRef = useRef<string | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [measuredHeights, setMeasuredHeights] = useState<ReadonlyMap<string, number>>(
    () => new Map(),
  )
  const [showJumpButton, setShowJumpButton] = useState(false)

  const itemHeights = useMemo(
    () => messages.map((m) => measuredHeights.get(m.message_id) ?? estimatedItemHeight),
    [messages, measuredHeights, estimatedItemHeight],
  )

  const view = useMemo(
    () => computeVirtualWindow({ itemHeights, scrollTop, viewportHeight, overscan }),
    [itemHeights, scrollTop, viewportHeight, overscan],
  )

  useLayoutEffect(() => {
    const el = containerRef.current
    if (el === null) return
    const observer = new ResizeObserver(() => {
      setViewportHeight(el.clientHeight)
    })
    observer.observe(el)
    setViewportHeight(el.clientHeight)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    return () => {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current)
      }
    }
  }, [])

  const handleScroll = useCallback(() => {
    if (scrollRafRef.current !== null) return
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null
      const el = containerRef.current
      if (el === null) return
      setScrollTop(el.scrollTop)
      const atBottom = isAtBottom({
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      })
      wasAtBottomRef.current = atBottom
      setShowJumpButton(!atBottom)
    })
  }, [])

  const handleItemMeasure = useCallback((messageId: string, height: number) => {
    setMeasuredHeights((prev) => {
      if (prev.get(messageId) === height) return prev
      const next = new Map(prev)
      next.set(messageId, height)
      return next
    })
  }, [])

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current
    if (el !== null) el.scrollTop = el.scrollHeight
  }, [])

  // Pre-paint so the tail snap is invisible.
  useLayoutEffect(() => {
    const lastId = messages.length > 0 ? messages[messages.length - 1].message_id : null
    const lastChanged = lastId !== null && lastId !== lastMessageIdRef.current
    lastMessageIdRef.current = lastId
    if (!lastChanged || !wasAtBottomRef.current) return
    scrollToBottom()
  }, [messages, scrollToBottom])

  const visibleMessages = messages.slice(view.startIndex, view.endIndex + 1)

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        data-testid="virtualized-message-list"
        className="flex-1 overflow-auto"
      >
        <div
          style={{ paddingTop: view.paddingTop, paddingBottom: view.paddingBottom }}
          data-testid="virtualized-message-list-content"
        >
          {visibleMessages.map((message) => (
            <MessageItem
              key={message.content_hash}
              message={message}
              onMeasure={handleItemMeasure}
            />
          ))}
        </div>
      </div>
      {showJumpButton ? <JumpToLatestButton onClick={scrollToBottom} /> : null}
    </div>
  )
}

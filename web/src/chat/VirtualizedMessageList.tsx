import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react'

import { MessageItem } from './MessageItem.tsx'
import type { ChatMessage } from './messageTypes.ts'
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
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [measuredHeights, setMeasuredHeights] = useState<ReadonlyMap<string, number>>(
    () => new Map(),
  )

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

  // Cancel any pending scroll-rAF on unmount: a fired callback would call
  // setScrollTop on an unmounted component, which React warns about and is a
  // (small) leak.
  useEffect(() => {
    return () => {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current)
      }
    }
  }, [])

  const handleScroll = useCallback(() => {
    // Coalesce scroll events into one state update per animation frame.
    if (scrollRafRef.current !== null) return
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null
      const el = containerRef.current
      if (el === null) return
      setScrollTop(el.scrollTop)
    })
  }, [])

  const handleItemMeasure = useCallback((messageId: string, height: number) => {
    setMeasuredHeights((prev) => {
      // Same-reference no-op guard so React's setState bails out when
      // ResizeObserver fires with an unchanged height.
      if (prev.get(messageId) === height) return prev
      const next = new Map(prev)
      next.set(messageId, height)
      return next
    })
  }, [])

  const visibleMessages = messages.slice(view.startIndex, view.endIndex + 1)

  return (
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
  )
}

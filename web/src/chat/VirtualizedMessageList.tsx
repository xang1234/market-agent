import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'

import { JumpToLatestButton } from './JumpToLatestButton.tsx'
import { MessageItem } from './MessageItem.tsx'
import { THREAD_COLUMN_CLASS } from './turnLayout.tsx'
import type { ChatMessage } from './messageTypes.ts'
import { isAtBottom } from './scrollTailing.ts'
import { computeVirtualWindow } from './virtualWindow.ts'

const DEFAULT_ESTIMATED_ITEM_HEIGHT = 200
const DEFAULT_OVERSCAN = 4
// Space kept above a question pinned to the top of the view.
const ANCHOR_MARGIN = 16
const QUESTION_SELECTOR = '[data-role="user"], [data-role="pending-user"]'

// What the view holds still while messages render and grow:
// bottom: the newest content (a thread opening, or the reader asking to follow).
// question: the question the reader just asked, at the top, its answer filling in below.
// null: wherever the reader scrolled; nothing moves on its own.
type Pin = 'bottom' | 'question' | null

export type VirtualizedMessageListProps = {
  messages: ReadonlyArray<ChatMessage>
  estimatedItemHeight?: number
  overscan?: number
  // Rendered after the messages in the same scroller and column, so a pending
  // turn sits exactly where its sealed message will appear.
  tail?: ReactNode
}

export function VirtualizedMessageList({
  messages,
  estimatedItemHeight = DEFAULT_ESTIMATED_ITEM_HEIGHT,
  overscan = DEFAULT_OVERSCAN,
  tail,
}: VirtualizedMessageListProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const tailRef = useRef<HTMLDivElement>(null)
  const spacerRef = useRef<HTMLDivElement>(null)
  const scrollRafRef = useRef<number | null>(null)
  const pinRef = useRef<Pin>('bottom')
  // Room below the newest question, kept from the moment it is pinned until the
  // reader follows the bottom again, so the answer never shifts under them.
  const questionRoomRef = useRef(false)
  const hadPendingQuestionRef = useRef(false)
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

  // Sizes the room below the newest question, then moves the view to the pin.
  const holdPin = useCallback(() => {
    const el = containerRef.current
    const spacer = spacerRef.current
    if (el === null || spacer === null) return
    const questions = el.querySelectorAll<HTMLElement>(QUESTION_SELECTOR)
    const question = questions[questions.length - 1]
    if (!questionRoomRef.current || question === undefined) {
      spacer.style.height = '0px'
    } else {
      const questionTop = question.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop
      const contentHeight = el.scrollHeight - spacer.offsetHeight
      spacer.style.height = `${Math.max(0, el.clientHeight - ANCHOR_MARGIN - (contentHeight - questionTop))}px`
      if (pinRef.current === 'question') el.scrollTop = questionTop - ANCHOR_MARGIN
    }
    if (pinRef.current === 'bottom') el.scrollTop = el.scrollHeight
  }, [])

  const followLatest = useCallback(() => {
    pinRef.current = 'bottom'
    questionRoomRef.current = false
    holdPin()
  }, [holdPin])

  useLayoutEffect(() => {
    const el = containerRef.current
    if (el === null) return
    const observer = new ResizeObserver(() => {
      setViewportHeight(el.clientHeight)
      holdPin()
    })
    observer.observe(el)
    setViewportHeight(el.clientHeight)
    return () => observer.disconnect()
  }, [holdPin])

  // Measured heights replace estimates and answers stream in; each change
  // re-applies the pin.
  useLayoutEffect(() => {
    const observer = new ResizeObserver(() => holdPin())
    for (const el of [contentRef.current, tailRef.current]) if (el !== null) observer.observe(el)
    return () => observer.disconnect()
  }, [holdPin])

  // A question the reader just asked appears in the tail before it is saved;
  // that moment pins it to the top.
  useLayoutEffect(() => {
    const pending = tailRef.current?.querySelector('[data-role="pending-user"]') ?? null
    if (pending !== null && !hadPendingQuestionRef.current) {
      pinRef.current = 'question'
      questionRoomRef.current = true
    }
    hadPendingQuestionRef.current = pending !== null
    holdPin()
  })

  // Scrolling by hand, by wheel, touch, keys, or the scrollbar, lets go of the pin.
  useEffect(() => {
    const el = containerRef.current
    if (el === null) return
    const release = () => {
      pinRef.current = null
    }
    const events = ['wheel', 'touchmove', 'keydown', 'pointerdown'] as const
    for (const event of events) el.addEventListener(event, release, { passive: true })
    return () => {
      for (const event of events) el.removeEventListener(event, release)
    }
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
      // A reader who scrolls back to the end by hand follows it again.
      if (atBottom && pinRef.current === null && !questionRoomRef.current) pinRef.current = 'bottom'
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
          ref={contentRef}
          style={{ paddingTop: view.paddingTop, paddingBottom: view.paddingBottom }}
          data-testid="virtualized-message-list-content"
          className={THREAD_COLUMN_CLASS}
        >
          {visibleMessages.map((message) => (
            <MessageItem
              key={message.message_id}
              message={message}
              onMeasure={handleItemMeasure}
            />
          ))}
        </div>
        <div ref={tailRef} data-testid="virtualized-message-list-tail" className={THREAD_COLUMN_CLASS}>
          {tail}
        </div>
        <div ref={spacerRef} aria-hidden="true" data-testid="virtualized-message-list-spacer" />
      </div>
      {showJumpButton ? <JumpToLatestButton onClick={followLatest} /> : null}
    </div>
  )
}

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
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

// The view sits somewhere this code did not put it: the reader moved it, by
// wheel, keys, focus, find in page, or a screen reader, and the pin lets go. A
// view the browser lowered because the content above shrank is not their doing.
function letGoIfReaderMoved(el: HTMLElement, pin: RefObject<Pin>, placedTop: RefObject<number | null>): void {
  const placed = placedTop.current
  if (pin.current === null || placed === null || Math.abs(el.scrollTop - placed) <= 1) return
  const lowestTop = el.scrollHeight - el.clientHeight
  if (placed > lowestTop && Math.abs(el.scrollTop - lowestTop) <= 1) return
  pin.current = null
  keepAnchoring(el, null)
}

// While pinned, the pin is the list's scroll anchoring, and the browser's would
// move the view by itself and read as the reader scrolling. Unpinned, the
// browser keeps what the reader is looking at still as messages above them
// swap estimated heights for measured ones.
function keepAnchoring(el: HTMLElement, pin: Pin): void {
  el.style.overflowAnchor = pin === null ? 'auto' : 'none'
}

export type VirtualizedMessageListProps = {
  messages: ReadonlyArray<ChatMessage>
  estimatedItemHeight?: number
  overscan?: number
  // Rendered after the messages in the same scroller and column, so a pending
  // turn sits exactly where its sealed message will appear.
  tail?: ReactNode
  // The run of a question the reader is sending now; each new one pins that
  // question to the top, a resend included.
  askedRun?: string | null
}

export function VirtualizedMessageList({
  messages,
  estimatedItemHeight = DEFAULT_ESTIMATED_ITEM_HEIGHT,
  overscan = DEFAULT_OVERSCAN,
  tail,
  askedRun = null,
}: VirtualizedMessageListProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const tailRef = useRef<HTMLDivElement>(null)
  const spacerRef = useRef<HTMLDivElement>(null)
  const scrollRafRef = useRef<number | null>(null)
  const pinRef = useRef<Pin>('bottom')
  // Where this code last put the view; any other position is the reader's doing.
  const placedTopRef = useRef<number | null>(null)
  // Room below the newest question, kept from the moment it is pinned until the
  // reader follows the bottom again, so the answer never shifts under them.
  const questionRoomRef = useRef(false)
  const pinnedRunRef = useRef<string | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  // The window's scroll position, readable from holdPin without re-running it.
  const windowTopRef = useRef(0)
  useLayoutEffect(() => {
    windowTopRef.current = scrollTop
  }, [scrollTop])
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
    // A move the reader made before this pass is theirs to keep.
    letGoIfReaderMoved(el, pinRef, placedTopRef)
    if (!questionRoomRef.current) {
      if (spacer.style.height !== '0px') spacer.style.height = '0px'
    } else {
      const questions = el.querySelectorAll<HTMLElement>(QUESTION_SELECTOR)
      const question = questions[questions.length - 1]
      if (question !== undefined) {
        const viewTop = el.getBoundingClientRect().top - el.scrollTop
        const questionTop = question.getBoundingClientRect().top - viewTop
        // Where the thread really ends: scrollHeight never drops below the
        // viewport, so it overstates a thread shorter than the view.
        const contentHeight = spacer.getBoundingClientRect().top - viewTop
        spacer.style.height = `${Math.max(0, el.clientHeight - ANCHOR_MARGIN - (contentHeight - questionTop))}px`
        if (pinRef.current === 'question') el.scrollTop = Math.max(0, questionTop - ANCHOR_MARGIN)
      }
    }
    if (pinRef.current === 'bottom') el.scrollTop = el.scrollHeight
    keepAnchoring(el, pinRef.current)
    if (pinRef.current !== null) {
      placedTopRef.current = el.scrollTop
      // The virtual window follows the view in this same commit, so a moved
      // view never paints a frame of the window it left.
      // Only a real change: an update on every layout pass would never settle.
      if (windowTopRef.current !== el.scrollTop) {
        windowTopRef.current = el.scrollTop
        setScrollTop(el.scrollTop)
      }
    }
  }, [])

  const followLatest = useCallback(() => {
    pinRef.current = 'bottom'
    // A new pin starts fresh: where the view sat before is not the reader moving it.
    placedTopRef.current = null
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

  useLayoutEffect(() => {
    if (askedRun !== null && askedRun !== pinnedRunRef.current) {
      pinnedRunRef.current = askedRun
      pinRef.current = 'question'
      placedTopRef.current = null
      questionRoomRef.current = true
    }
    holdPin()
  })

  useEffect(() => {
    return () => {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current)
      }
    }
  }, [])

  const handleScroll = useCallback(() => {
    // Now, not on the next frame: a streaming render in between would put the
    // view back and erase the reader's move.
    if (containerRef.current !== null) letGoIfReaderMoved(containerRef.current, pinRef, placedTopRef)
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
      // A reader who scrolls to the end by hand follows it again, from a pinned
      // question too: its room below goes, and new content stays in view.
      if (atBottom && pinRef.current === null) {
        pinRef.current = 'bottom'
        questionRoomRef.current = false
        placedTopRef.current = null
        holdPin()
      }
      setShowJumpButton(!atBottom)
    })
  }, [holdPin])

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
        className="flex-1 overflow-auto [overflow-anchor:none]"
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

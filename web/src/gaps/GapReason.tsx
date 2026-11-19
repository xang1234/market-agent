import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react'

// Room for about four lines of text-xs below a trigger.
const TIP_ROOM = 80

const TIP = 'fixed z-50 max-w-xs font-sans rounded border border-line-strong bg-surface px-2 py-1 text-xs font-normal normal-case tracking-normal text-fg shadow-md'

type Placement = { left: number; top?: number; bottom?: number }

function place(box: DOMRect): Placement {
  // max-w-xs is 320px; keep the tip on screen near the right edge, and open it
  // above the trigger when a few lines would not fit below.
  const left = Math.max(8, Math.min(box.left, window.innerWidth - 328))
  return window.innerHeight - box.bottom < TIP_ROOM ? { left, bottom: window.innerHeight - box.top } : { left, top: box.bottom }
}

// The page scrolls at the document; a pane or a wide table scrolls at its element.
function inView(box: DOMRect, scroller: EventTarget | null): boolean {
  const frame = scroller === document || !scroller ? { top: 0, left: 0, bottom: window.innerHeight, right: window.innerWidth } : (scroller as Element).getBoundingClientRect()
  return box.bottom > frame.top && box.top < frame.bottom && box.right > frame.left && box.left < frame.right
}

/**
 * A blank value and why it is blank. The trigger is named for the figure it
 * stands in for, and the reason, shown on hover or keyboard focus, is its
 * description. Fixed positioning keeps the reason clear of the
 * overflow-clipping tables and grids it sits in.
 */
export function GapReason({ label, reason, children }: { label: string; reason: string; children: ReactNode }): ReactElement {
  const id = useId()
  const trigger = useRef<HTMLSpanElement>(null)
  const [at, setAt] = useState<Placement | null>(null)
  const open = at !== null
  const show = () => { if (trigger.current) setAt(place(trigger.current.getBoundingClientRect())) }
  const hide = () => setAt(null)
  useEffect(() => {
    if (!open) return
    // Focus scrolls an off-screen trigger into view, so the tip follows its
    // trigger through a scroll and closes only once the trigger is out of view.
    const follow = (event: Event) => {
      const box = trigger.current?.getBoundingClientRect()
      setAt(box && inView(box, event.target) ? place(box) : null)
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setAt(null) }
    window.addEventListener('scroll', follow, { capture: true })
    document.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('scroll', follow, { capture: true })
      document.removeEventListener('keydown', escape)
    }
  }, [open])
  return (
    <span
      ref={trigger}
      tabIndex={0}
      role="img"
      aria-label={`${label}: not available`}
      aria-describedby={id}
      className="cursor-help rounded underline decoration-dotted underline-offset-2 focus-visible:outline-2 focus-visible:outline-accent"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <span aria-hidden="true">{children}</span>
      <span id={id} role="tooltip" className={open ? TIP : 'sr-only'} style={at ?? undefined}>
        {reason}
      </span>
    </span>
  )
}

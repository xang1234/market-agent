import { useEffect, useId, useState, type ReactElement, type ReactNode, type SyntheticEvent } from 'react'

const TIP = 'fixed z-50 max-w-xs font-sans rounded border border-line-strong bg-surface px-2 py-1 text-xs font-normal normal-case tracking-normal text-fg shadow-md'

/**
 * A blank value and why it is blank. The reason shows on hover or keyboard
 * focus and is the trigger's accessible description. Fixed positioning keeps
 * it clear of the overflow-clipping tables and grids it sits in.
 */
export function GapReason({ reason, children }: { reason: string; children: ReactNode }): ReactElement {
  const id = useId()
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  const show = (event: SyntheticEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    // max-w-xs is 320px; keep the tip on screen near the right edge.
    setAt({ left: Math.max(8, Math.min(box.left, window.innerWidth - 328)), top: box.bottom })
  }
  const hide = () => setAt(null)
  // A fixed tip would float away from its trigger once anything scrolls.
  useEffect(() => {
    if (!at) return
    const close = () => setAt(null)
    window.addEventListener('scroll', close, { capture: true, once: true })
    return () => window.removeEventListener('scroll', close, { capture: true })
  }, [at])
  return (
    <span
      tabIndex={0}
      aria-describedby={id}
      className="cursor-help rounded underline decoration-dotted underline-offset-2 focus-visible:outline-2 focus-visible:outline-accent"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onKeyDown={(event) => { if (event.key === 'Escape') hide() }}
    >
      <span aria-hidden="true">{children}</span>
      <span id={id} role="tooltip" className={at ? TIP : 'sr-only'} style={at ?? undefined}>
        {reason}
      </span>
    </span>
  )
}

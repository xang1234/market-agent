import { useRef, type KeyboardEvent } from 'react'

type SegmentedToggleProps<T extends string> = {
  options: ReadonlyArray<{ value: T; label: string }>
  value: T
  onChange: (next: T) => void
  ariaLabel: string
  testIdPrefix: string
}

// Implements the ARIA APG radiogroup pattern: arrow keys move focus + select
// the new option (with wrap-around), Space/Enter selects the focused option,
// and only the checked radio is in the tab sequence (roving tabindex) so
// keyboard users land on the active option in one Tab.
export function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  testIdPrefix,
}: SegmentedToggleProps<T>) {
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([])

  function focusAndSelect(index: number) {
    const next = options[index]
    if (!next) return
    onChange(next.value)
    buttonsRef.current[index]?.focus()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault()
        focusAndSelect((currentIndex + 1) % options.length)
        return
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault()
        focusAndSelect((currentIndex - 1 + options.length) % options.length)
        return
      case ' ':
      case 'Enter':
        event.preventDefault()
        onChange(options[currentIndex].value)
        return
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex overflow-hidden rounded-md border border-line"
    >
      {options.map((opt, index) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            ref={(el) => { buttonsRef.current[index] = el }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            data-testid={`${testIdPrefix}-${opt.value}`}
            onClick={() => onChange(opt.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={
              active
                ? 'bg-accent-soft px-3 py-1 text-xs font-medium text-accent'
                : 'px-3 py-1 text-xs font-medium text-muted hover:text-fg'
            }
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

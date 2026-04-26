type SegmentedToggleProps<T extends string> = {
  options: ReadonlyArray<{ value: T; label: string }>
  value: T
  onChange: (next: T) => void
  ariaLabel: string
  testIdPrefix: string
}

export function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  testIdPrefix,
}: SegmentedToggleProps<T>) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex rounded-md border border-neutral-200 dark:border-neutral-700">
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            data-testid={`${testIdPrefix}-${opt.value}`}
            onClick={() => onChange(opt.value)}
            className={
              active
                ? 'bg-neutral-900 px-3 py-1 text-xs font-medium text-white dark:bg-neutral-100 dark:text-neutral-900'
                : 'px-3 py-1 text-xs font-medium text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100'
            }
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

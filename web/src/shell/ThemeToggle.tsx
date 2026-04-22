import { useTheme } from './useTheme'
import type { ThemeMode } from './themeTypes'

const OPTIONS: ReadonlyArray<{ mode: ThemeMode; label: string }> = [
  { mode: 'light', label: 'Light' },
  { mode: 'dark', label: 'Dark' },
  { mode: 'system', label: 'Auto' },
]

// Segmented theme control. Shows the user's selected mode (which may be
// `system`) — not the resolved color — because that's what the setting
// actually persists. A user on `system` seeing "Auto" highlighted makes the
// "follow my OS" state legible, which a two-state sun/moon toggle hides.
export function ThemeToggle() {
  const { mode, setMode } = useTheme()
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      data-testid="theme-toggle"
      className="flex items-center rounded-md border border-neutral-200 bg-white p-0.5 text-[11px] dark:border-neutral-800 dark:bg-neutral-900"
    >
      {OPTIONS.map(({ mode: m, label }) => {
        const active = mode === m
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setMode(m)}
            className={[
              'flex-1 rounded px-2 py-1 transition-colors',
              active
                ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800',
            ].join(' ')}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

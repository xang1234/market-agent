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
      className="flex items-center rounded-md border border-line bg-surface p-0.5 text-[11px]"
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
                ? 'bg-accent-soft text-accent'
                : 'text-muted hover:bg-surface-hover',
            ].join(' ')}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react'
import { useTheme } from './useTheme'
import type { ThemeMode } from './themeTypes'

const OPTIONS: ReadonlyArray<{ mode: ThemeMode; label: string; icon: LucideIcon }> = [
  { mode: 'light', label: 'Light', icon: Sun },
  { mode: 'dark', label: 'Dark', icon: Moon },
  { mode: 'system', label: 'Auto', icon: Monitor },
]

// Segmented theme control. Shows the user's selected mode (which may be
// `system`) — not the resolved color — because that's what the setting
// actually persists. A user on `system` seeing "Auto" highlighted makes the
// "follow my OS" state legible, which a two-state sun/moon toggle hides.
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { mode, setMode } = useTheme()
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      data-testid="theme-toggle"
      className={`flex items-center rounded-md border border-line bg-surface p-0.5 text-[11px] ${compact ? 'flex-col' : ''}`}
    >
      {OPTIONS.map(({ mode: m, label, icon: Icon }) => {
        const active = mode === m
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setMode(m)}
            aria-label={compact ? label : undefined}
            title={compact ? label : undefined}
            className={[
              compact ? 'grid h-6 w-6 place-items-center rounded transition-colors' : 'flex-1 rounded px-2 py-1 transition-colors',
              active
                ? 'bg-accent-soft text-accent'
                : 'text-muted hover:bg-surface-hover',
            ].join(' ')}
          >
            {compact ? <Icon aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.8} /> : label}
          </button>
        )
      })}
    </div>
  )
}

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ThemeContext,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemeContextValue,
  type ThemeMode,
} from './themeTypes'

const DARK_QUERY = '(prefers-color-scheme: dark)'

function readStoredMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system'
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (raw === 'light' || raw === 'dark') return raw
  } catch {
    // ignore — private mode, SSR, etc. Fall through to system.
  }
  return 'system'
}

function readSystemPrefersDark(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia(DARK_QUERY).matches
}

// Owns the class-toggle on <html>. The inline script in index.html applies
// the initial class before paint; this provider keeps it in sync across
// (a) user selection and (b) OS preference changes while `mode` is `system`.
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode)
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(readSystemPrefersDark)

  // Subscribe to OS preference once. Always subscribed — the subscription is
  // cheap, and keeping it simple avoids the "unsubscribe when user picks an
  // explicit mode, resubscribe when they go back to system" complexity.
  useEffect(() => {
    const mql = window.matchMedia(DARK_QUERY)
    const apply = () => setSystemPrefersDark(mql.matches)
    mql.addEventListener('change', apply)
    return () => mql.removeEventListener('change', apply)
  }, [])

  const resolved: ResolvedTheme =
    mode === 'system' ? (systemPrefersDark ? 'dark' : 'light') : mode

  // Apply class to <html>. Runs on every resolved change; idempotent.
  useEffect(() => {
    const root = document.documentElement
    if (resolved === 'dark') root.classList.add('dark')
    else root.classList.remove('dark')
  }, [resolved])

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next)
    try {
      if (next === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY)
      else window.localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // ignore — localStorage may be unavailable.
    }
  }, [])

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, resolved, setMode }),
    [mode, resolved, setMode],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

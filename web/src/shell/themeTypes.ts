import { createContext } from 'react'

// Three-state theme. `system` defers to the OS preference via matchMedia;
// `light` / `dark` are explicit user overrides. The override (or its
// absence) is what gets persisted, not the currently-rendered color — so a
// user who picks `system` keeps following the OS across sessions.
export type ThemeMode = 'light' | 'dark' | 'system'

// The actually-applied color, after `system` has been resolved against the
// OS preference. Consumers who just want "am I currently dark?" read this.
export type ResolvedTheme = 'light' | 'dark'

export type ThemeContextValue = {
  mode: ThemeMode
  resolved: ResolvedTheme
  setMode: (mode: ThemeMode) => void
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)

// localStorage key — kept in one place so the pre-React script in index.html
// (which cannot import this file) and the ThemeProvider can't drift apart.
// If you change this value, update index.html too.
export const THEME_STORAGE_KEY = 'theme'

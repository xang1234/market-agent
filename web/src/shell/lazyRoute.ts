import type { ComponentType } from 'react'

const RELOAD_KEY = 'chunk-reload'
const RELOAD_WINDOW_MS = 60_000

// A tab left open across a deploy asks for page chunks the new build deleted.
// Loading the destination fresh fetches the new build. A second failure for the
// same destination within the window is a real fault, so it reaches the route's
// error screen instead of reloading forever.
export function reloadOnce(destination: string, error: unknown): Promise<never> {
  const href = new URL(destination, window.location.href).href
  if (!claimReload(href)) return Promise.reject(error)
  window.location.assign(href)
  // Never settles: the current page stays on screen until the new document loads.
  return new Promise<never>(() => {})
}

// False when this destination already reloaded within the window, or when
// storage cannot remember the attempt (a reload could then repeat forever).
function claimReload(href: string): boolean {
  try {
    const last: { href?: string; at?: number } | null = JSON.parse(sessionStorage.getItem(RELOAD_KEY) ?? 'null')
    if (last?.href === href && Date.now() - (last.at ?? 0) < RELOAD_WINDOW_MS) return false
    sessionStorage.setItem(RELOAD_KEY, JSON.stringify({ href, at: Date.now() }))
    return true
  } catch {
    return false
  }
}

export function lazyRoute<M extends Record<K, ComponentType>, K extends keyof M & string>(
  load: () => Promise<M>,
  name: K,
  destination: () => string,
) {
  return async () => {
    try {
      return { Component: (await load())[name] }
    } catch (error) {
      return reloadOnce(destination(), error)
    }
  }
}

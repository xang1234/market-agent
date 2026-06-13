import { useEffect } from 'react'

import { isTypingTarget } from './isTypingTarget.ts'

// Global hotkey to focus the top-bar symbol search: ⌘K / Ctrl+K anywhere, or a
// bare "/" when focus is not already in a text field. The search input opts in
// by carrying `data-search-input="topbar"` so this stays decoupled from
// SymbolSearch's internals.
export function useSearchHotkey() {
  useEffect(() => {
    function focusSearch() {
      const el = document.querySelector<HTMLInputElement>('[data-search-input="topbar"]')
      if (el) {
        el.focus()
        el.select()
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        focusSearch()
      } else if (event.key === '/' && !isTypingTarget(event.target)) {
        event.preventDefault()
        focusSearch()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])
}

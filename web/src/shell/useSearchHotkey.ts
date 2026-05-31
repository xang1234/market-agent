import { useEffect } from 'react'

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
    function isTypingTarget(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false
      const tag = target.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
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

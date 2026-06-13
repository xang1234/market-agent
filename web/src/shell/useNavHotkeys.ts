import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

import { isTypingTarget } from './isTypingTarget.ts'
import { navPathForKey } from './navHotkeys.ts'

// Single-key workspace switching (H/A/C/S/G). Only when no modifier is held
// and focus is not in a text field, so typing stays safe everywhere.
export function useNavHotkeys() {
  const navigate = useNavigate()
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isTypingTarget(event.target)) return
      const path = navPathForKey(event.key.toLowerCase())
      if (path === null) return
      event.preventDefault()
      navigate(path)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [navigate])
}

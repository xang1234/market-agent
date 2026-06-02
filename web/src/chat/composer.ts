// Composer keyboard-event handler — no React component exports.
// Extracted from ChatPage.tsx so that file satisfies react-refresh/only-export-components.

import type React from 'react'

export function handleComposerKeyDownEvent(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }
}

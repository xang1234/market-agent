// Chat layout outlet context — no React component exports.
// Extracted from ChatPage.tsx so that file satisfies react-refresh/only-export-components.

import React from 'react'
import { useOutletContext } from 'react-router-dom'

export type ChatLayoutContext = {
  collapsed: boolean
  setCollapsed: React.Dispatch<React.SetStateAction<boolean>>
}

export function useChatLayoutContext(): ChatLayoutContext {
  return useOutletContext<ChatLayoutContext>()
}

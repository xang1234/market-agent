import { useEffect, useReducer } from 'react'

import { INITIAL_STREAM_STATE, applyChatStreamEvent, type StreamState } from './streamReducer.ts'
import type { ChatSseEvent } from './sseEventTypes.ts'

export type ChatStreamSubscribe = (onEvent: (event: ChatSseEvent) => void) => () => void

// IMPORTANT: `subscribe` MUST be stable (wrap in useCallback or define at
// module scope). On every identity change we tear down and re-create the
// underlying transport (EventSource etc.) — any in-flight events between
// the disconnect and reconnect are dropped, which surfaces as "skeleton
// stuck" UI with no visible failure.
export function useChatStream(subscribe: ChatStreamSubscribe): StreamState {
  const [state, dispatch] = useReducer(applyChatStreamEvent, INITIAL_STREAM_STATE)

  useEffect(() => {
    return subscribe(dispatch)
  }, [subscribe])

  return state
}

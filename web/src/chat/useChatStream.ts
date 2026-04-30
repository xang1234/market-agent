import { useEffect, useReducer } from 'react'

import { INITIAL_STREAM_STATE, applyChatStreamEvent, type StreamState } from './streamReducer.ts'
import type { ChatSseEvent } from './sseEventTypes.ts'

// Subscribe-style transport adapter: caller hands in a function that wires
// up the event delivery (EventSource, in-memory iterable for tests, etc.)
// and returns an unsubscribe. Keeps the reducer transport-agnostic.
export type ChatStreamSubscribe = (onEvent: (event: ChatSseEvent) => void) => () => void

export function useChatStream(subscribe: ChatStreamSubscribe): StreamState {
  const [state, dispatch] = useReducer(applyChatStreamEvent, INITIAL_STREAM_STATE)

  useEffect(() => {
    return subscribe(dispatch)
  }, [subscribe])

  return state
}

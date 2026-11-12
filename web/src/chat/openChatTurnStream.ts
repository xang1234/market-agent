import { CHAT_SSE_EVENT_TYPES, type ChatSseEvent } from './sseEventTypes.ts'

type ChatTurnStreamCallbacks = {
  onEvent(event: ChatSseEvent): void
  // The server answered, so the turn exists: closing now can't cancel its start.
  onOpen?(): void
  onCompleted?(): void
  onError(): void
}

export function openChatTurnStream(
  input: {
    threadId: string
    runId: string
    turnId?: string
    userId: string
  } & (
    // Starts the turn when the server has none with these ids.
    | { userIntent: string; attach?: never }
    // Follows a turn the server already has; never starts one.
    | { attach: true; userIntent?: never }
  ),
  callbacks: ChatTurnStreamCallbacks,
  EventSourceCtor: typeof EventSource = EventSource,
): EventSource {
  const params = new URLSearchParams({
    run_id: input.runId,
    turn_id: input.turnId ?? input.runId,
    ...(input.attach ? {} : { user_intent: input.userIntent }),
    user_id: input.userId,
    ...(input.attach ? { attach: '1' } : {}),
  })
  const source = new EventSourceCtor(`/v1/chat/threads/${encodeURIComponent(input.threadId)}/stream?${params}`)
  source.onopen = () => callbacks.onOpen?.()
  source.onmessage = (event) => {
    callbacks.onEvent(JSON.parse(event.data) as ChatSseEvent)
  }
  // Every kind the server sends: the list is drift-tested against the backend's.
  for (const type of CHAT_SSE_EVENT_TYPES) {
    source.addEventListener(type, (event) => {
      callbacks.onEvent(JSON.parse((event as MessageEvent).data) as ChatSseEvent)
      if (type === 'turn.completed') {
        callbacks.onCompleted?.()
        source.close()
      }
      // The turn ended: the event said how, and nothing reopens it.
      if (type === 'turn.error' || type === 'turn.stopped') source.close()
    })
  }
  source.onerror = () => {
    callbacks.onError()
    source.close()
  }
  return source
}

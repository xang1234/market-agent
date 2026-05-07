import type { ChatSseEvent } from './sseEventTypes.ts'

type ChatTurnStreamCallbacks = {
  onEvent(event: ChatSseEvent): void
  onCompleted(): void
  onError(): void
}

export function openChatTurnStream(
  input: {
    threadId: string
    runId: string
    turnId?: string
    userIntent: string
    userId: string
  },
  callbacks: ChatTurnStreamCallbacks,
  EventSourceCtor: typeof EventSource = EventSource,
): EventSource {
  const params = new URLSearchParams({
    run_id: input.runId,
    turn_id: input.turnId ?? input.runId,
    user_intent: input.userIntent,
    user_id: input.userId,
  })
  const source = new EventSourceCtor(`/v1/chat/threads/${encodeURIComponent(input.threadId)}/stream?${params}`)
  source.onmessage = (event) => {
    callbacks.onEvent(JSON.parse(event.data) as ChatSseEvent)
  }
  for (const type of [
    'turn.started',
    'tool.started',
    'tool.completed',
    'snapshot.staged',
    'snapshot.sealed',
    'block.began',
    'block.delta',
    'block.completed',
    'turn.completed',
    'turn.error',
  ] as const) {
    source.addEventListener(type, (event) => {
      callbacks.onEvent(JSON.parse((event as MessageEvent).data) as ChatSseEvent)
      if (type === 'turn.completed') {
        callbacks.onCompleted()
        source.close()
      }
      if (type === 'turn.error') source.close()
    })
  }
  source.onerror = () => {
    callbacks.onError()
    source.close()
  }
  return source
}

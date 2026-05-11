import { authenticatedJson } from '../http/authFetch.ts'
import type { ChatMessage } from './messageTypes.ts'

export async function persistUserChatTurn(input: {
  threadId: string
  userId: string
  messageId: string
  snapshotId: string
  content: string
}): Promise<ChatMessage> {
  const body = await authenticatedJson<{ message?: ChatMessage }>(`/v1/chat/threads/${encodeURIComponent(input.threadId)}/messages`, {
    userId: input.userId,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      message_id: input.messageId,
      snapshot_id: input.snapshotId,
      content: input.content,
    }),
  })
  if (!body.message) throw new Error('message missing from response')
  return body.message
}

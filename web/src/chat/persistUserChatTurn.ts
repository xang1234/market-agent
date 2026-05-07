import type { ChatMessage } from './messageTypes.ts'

export async function persistUserChatTurn(input: {
  threadId: string
  userId: string
  messageId: string
  snapshotId: string
  content: string
}): Promise<ChatMessage> {
  const response = await fetch(`/v1/chat/threads/${encodeURIComponent(input.threadId)}/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-user-id': input.userId,
    },
    body: JSON.stringify({
      message_id: input.messageId,
      snapshot_id: input.snapshotId,
      content: input.content,
    }),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const body = (await response.json()) as { message?: ChatMessage }
  if (!body.message) throw new Error('message missing from response')
  return body.message
}

// Thread-level CRUD actions — no React component exports.
// Extracted from ChatPage.tsx so that file satisfies react-refresh/only-export-components.

import { authenticatedFetch, authenticatedJson } from '../http/authFetch.ts'

type ChatThread = {
  thread_id: string
  title: string | null
  updated_at: string
}

export async function createThreadAndOpen(
  userId: string,
  navigate: (to: string) => void,
  title: string | null = null,
): Promise<void> {
  const thread = await authenticatedJson<ChatThread>('/v1/chat/threads', {
    userId,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  navigate(`/chat/${thread.thread_id}`)
}

export async function deleteThread(userId: string, threadId: string): Promise<void> {
  const res = await authenticatedFetch(`/v1/chat/threads/${encodeURIComponent(threadId)}`, {
    userId,
    method: 'DELETE',
  })
  if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`)
}

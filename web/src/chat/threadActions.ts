// Thread-level CRUD actions — no React component exports.
// Extracted from ChatPage.tsx so that file satisfies react-refresh/only-export-components.

import { authenticatedFetch, authenticatedJson } from '../http/authFetch.ts'

export type ChatThread = {
  thread_id: string
  title: string | null
  updated_at: string
}

export async function createThread(userId: string): Promise<ChatThread> {
  return authenticatedJson<ChatThread>('/v1/chat/threads', {
    userId,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: null }),
  })
}

export async function deleteThread(userId: string, threadId: string, signal?: AbortSignal): Promise<void> {
  const res = await authenticatedFetch(`/v1/chat/threads/${encodeURIComponent(threadId)}`, {
    userId,
    method: 'DELETE',
    signal,
  })
  if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`)
}

export async function renameThread(userId: string, threadId: string, title: string): Promise<void> {
  const res = await authenticatedFetch(`/v1/chat/threads/${encodeURIComponent(threadId)}`, {
    userId,
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

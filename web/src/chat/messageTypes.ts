import type { Block } from '../blocks/types.ts'

export const CHAT_ROLES = ['user', 'assistant', 'tool'] as const
export type ChatRole = (typeof CHAT_ROLES)[number]

// Frontend mirror of services/chat/src/messages.ts ChatMessageRow. The
// backend computes `content_hash` over the message contents during snapshot
// sealing (see persistChatMessageAfterSnapshotSeal); reuse it as the React
// key so a re-render that produces an identical message preserves component
// instance identity across diffs.
export type ChatMessage = {
  message_id: string
  thread_id: string
  role: ChatRole
  snapshot_id: string
  blocks: ReadonlyArray<Block>
  content_hash: string
  created_at: string
}

import type { BlockProof } from '../blocks/blockProof.ts'
import type { Block } from '../blocks/types.ts'

export const CHAT_ROLES = ['user', 'assistant', 'tool'] as const
export type ChatRole = (typeof CHAT_ROLES)[number]

// Frontend mirror of services/chat/src/messages.ts ChatMessageRow. Reuse the
// backend-supplied content_hash as the React key so identical message diffs
// preserve component identity.
export type ChatMessage = {
  message_id: string
  thread_id: string
  role: ChatRole
  snapshot_id: string
  blocks: ReadonlyArray<Block>
  content_hash: string
  created_at: string
  // Each block's evidence, calculation, and public-time claims, derived by the
  // server on read (#193). Absent on messages that were not read back.
  block_proofs?: Readonly<Record<string, BlockProof>>
}

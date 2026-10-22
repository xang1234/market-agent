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

export type SealedChatMessage = ChatMessage & {
  role: 'assistant'
  block_proofs: Readonly<Record<string, BlockProof>>
}

const PROOF_VALUES: { readonly [K in keyof BlockProof]: ReadonlyArray<BlockProof[K]> } = {
  evidence: ['linked', 'unknown'],
  calculation: ['verified', 'not_verified'],
  public_by_cutoff: ['proven', 'unknown'],
}

// Checks the envelope at the stream boundary: the ids the event names, the
// row's string fields, a block id and kind per block, and every proof value.
// Block bodies are left to BlockView, as on the history path.
export function parseSealedMessage(value: unknown, expected: { threadId: string; messageId: unknown }): SealedChatMessage | null {
  if (!isRecord(value)) return null
  const { message_id, thread_id, role, content_hash, created_at } = value
  if (message_id !== expected.messageId || thread_id !== expected.threadId || role !== 'assistant') return null
  if (![content_hash, created_at].every((field) => typeof field === 'string' && field !== '')) return null
  return parseShownAnswer(value) === null ? null : value as SealedChatMessage
}

// A sealed answer shown before its turn completes (answer.shown). On the
// analyst path it is not saved yet: its analyst inferences are with the judge,
// a line in each one's place. On the engine lane it is saved first, and its
// analyst commentary is appended after. Either way the saved message arrives
// with turn.completed.
export type ShownAnswer = Pick<SealedChatMessage, 'message_id' | 'snapshot_id' | 'blocks' | 'block_proofs'>

export function parseShownAnswer(value: Record<string, unknown>): ShownAnswer | null {
  const { message_id, snapshot_id, blocks, block_proofs } = value
  if (typeof message_id !== 'string' || message_id === '' || typeof snapshot_id !== 'string' || snapshot_id === '') return null
  if (!Array.isArray(blocks) || !blocks.every((block) => isRecord(block) && typeof block.id === 'string' && typeof block.kind === 'string')) return null
  if (!isRecord(block_proofs) || !Object.values(block_proofs).every(isBlockProof)) return null
  return { message_id, snapshot_id, blocks: blocks as Block[], block_proofs: block_proofs as Record<string, BlockProof> }
}

// A turn on the server, named the way its stream route keys it.
export type RunRef = Readonly<{ runId: string; turnId: string }>

// Where a run the server still retains stands. messageId is the saved answer
// its turn.completed named, when it named one.
export type RunStatus =
  | Readonly<{ run: RunRef; status: 'in_flight' }>
  | Readonly<{ run: RunRef; status: 'completed'; messageId: string | null }>
  | Readonly<{ run: RunRef; status: 'failed' }>

export type ThreadRead = { messages: ReadonlyArray<ChatMessage>; activeRun: RunRef | null; runs: ReadonlyArray<RunStatus> }

// The messages GET body. A body without active_run or runs, or with malformed
// ones, reports no run, so this client works against a chat service that
// predates them. A malformed runs entry is dropped alone.
export function parseThreadMessages(body: unknown): ThreadRead {
  const record = isRecord(body) ? body : {}
  const messages = Array.isArray(record.messages) ? (record.messages as ChatMessage[]) : []
  const runs = Array.isArray(record.runs) ? record.runs.flatMap((entry) => {
    const status = parseRunStatus(entry)
    return status ? [status] : []
  }) : []
  return { messages, activeRun: parseRunRef(record.active_run), runs }
}

function parseRunRef(value: unknown): RunRef | null {
  return isRecord(value) && typeof value.run_id === 'string' && value.run_id !== '' && typeof value.turn_id === 'string' && value.turn_id !== ''
    ? { runId: value.run_id, turnId: value.turn_id }
    : null
}

function parseRunStatus(value: unknown): RunStatus | null {
  const run = parseRunRef(value)
  if (run === null || !isRecord(value)) return null
  switch (value.status) {
    case 'in_flight':
    case 'failed':
      return { run, status: value.status }
    case 'completed':
      return { run, status: 'completed', messageId: typeof value.message_id === 'string' && value.message_id !== '' ? value.message_id : null }
    default:
      return null
  }
}

function isBlockProof(value: unknown): value is BlockProof {
  return isRecord(value) && (Object.keys(PROOF_VALUES) as Array<keyof BlockProof>)
    .every((claim) => (PROOF_VALUES[claim] as ReadonlyArray<unknown>).includes(value[claim]))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

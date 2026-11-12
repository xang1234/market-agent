import type { RichTextBlock } from '../blocks/types.ts'
import type { ChatMessage } from './messageTypes.ts'

// The server's "take every option" path reads this reply (financial-runtime.ts TAKES_EVERY_CHOICE).
export const ALL_OF_THE_ABOVE = 'All of the above'

// The options the thread's open clarification offered, read from the saved
// field (#626). A clarification followed by any later message was answered.
export function offeredChoices(messages: ReadonlyArray<ChatMessage>): ReadonlyArray<string> {
  const last = messages.at(-1)
  if (last?.role !== 'assistant') return []
  const first = last.blocks[0]
  return first?.kind === 'rich_text' ? (first as RichTextBlock).clarification_choices ?? [] : []
}

export type { ChatMessage, ChatRole } from './messageTypes.ts'
export { CHAT_ROLES } from './messageTypes.ts'

export { computeVirtualWindow } from './virtualWindow.ts'
export type { VirtualWindowInput, VirtualWindowResult } from './virtualWindow.ts'

export { DEFAULT_AT_BOTTOM_THRESHOLD, isAtBottom } from './scrollTailing.ts'
export type { ScrollPosition } from './scrollTailing.ts'

export { VirtualizedMessageList } from './VirtualizedMessageList.tsx'
export type { VirtualizedMessageListProps } from './VirtualizedMessageList.tsx'

export { MessageItem } from './MessageItem.tsx'
export { JumpToLatestButton } from './JumpToLatestButton.tsx'

export { CHAT_SSE_EVENT_TYPES } from './sseEventTypes.ts'
export type { ChatSseEvent, ChatSseEventType } from './sseEventTypes.ts'

export {
  INITIAL_STREAM_STATE,
  applyChatStreamEvent,
  isStreamingRichText,
} from './streamReducer.ts'
export type {
  StreamState,
  StreamingBlock,
  StreamingBlockStatus,
  StreamingOpaqueBlock,
  StreamingRichTextBlock,
  StreamingTurnStatus,
} from './streamReducer.ts'

export { useChatStream } from './useChatStream.ts'
export type { ChatStreamSubscribe } from './useChatStream.ts'

export { BlockSkeleton } from './BlockSkeleton.tsx'
export { StreamingBlockView } from './StreamingBlockView.tsx'
export { StreamingTurnView } from './StreamingTurnView.tsx'

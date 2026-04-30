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

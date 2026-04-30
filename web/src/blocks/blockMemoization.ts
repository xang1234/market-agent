import type { Block } from './types.ts'

// Reference-equality comparator for BlockView memoization. Snapshot blocks
// are immutable (the snapshot pipeline freezes them), so callers that update
// a message's block list using the standard immutable-update pattern keep
// stable references for unchanged blocks. Hashing on every render would
// defeat the 60fps target — message-level memoization (via content_hash on
// the React key) covers the cross-snapshot identity case.
export function blockPropsAreEqual(
  prev: { block: Block },
  next: { block: Block },
): boolean {
  return prev.block === next.block
}

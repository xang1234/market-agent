import type { Block } from './types.ts'

// Reference equality is sufficient: snapshot blocks are frozen by the
// snapshot pipeline, so unchanged blocks keep stable references.
export function blockPropsAreEqual(
  prev: { block: Block },
  next: { block: Block },
): boolean {
  return prev.block === next.block
}

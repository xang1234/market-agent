import type { BlockProof } from './blockProof.ts'
import type { Block } from './types.ts'

// Reference equality is sufficient: snapshot blocks are frozen by the
// snapshot pipeline, so unchanged blocks keep stable references (and a
// message's proofs arrive with it).
export function blockPropsAreEqual(
  prev: { block: Block; proof?: BlockProof },
  next: { block: Block; proof?: BlockProof },
): boolean {
  return prev.block === next.block && prev.proof === next.proof
}

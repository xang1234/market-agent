import { memo } from 'react'

import { BlockView } from './BlockView.tsx'
import { blockPropsAreEqual } from './blockMemoization.ts'

// React.memo wrapper around BlockView. Bails out of re-render when the block
// reference is unchanged — sufficient when callers source blocks from the
// snapshot store (immutable, stable references for unchanged blocks).
export const MemoizedBlockView = memo(BlockView, blockPropsAreEqual)

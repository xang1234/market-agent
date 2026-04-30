import { memo } from 'react'

import { BlockView } from './BlockView.tsx'
import { blockPropsAreEqual } from './blockMemoization.ts'

export const MemoizedBlockView = memo(BlockView, blockPropsAreEqual)

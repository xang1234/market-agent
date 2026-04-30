import type { ReactElement } from 'react'

import { DEFAULT_SKELETON_HEIGHT, SKELETON_HEIGHT_BY_KIND } from './blockSkeletonHeights.ts'

type BlockSkeletonProps = {
  blockId: string
  kind: string
}

export function BlockSkeleton({ blockId, kind }: BlockSkeletonProps): ReactElement {
  const heightClass = SKELETON_HEIGHT_BY_KIND[kind] ?? DEFAULT_SKELETON_HEIGHT
  return (
    <div
      data-testid={`block-skeleton-${blockId}`}
      data-block-kind={kind}
      data-block-status="pending"
      role="status"
      aria-busy="true"
      aria-label={`Loading ${kind} block`}
      className={`${heightClass} animate-pulse rounded-md bg-neutral-100 dark:bg-neutral-800`}
    />
  )
}

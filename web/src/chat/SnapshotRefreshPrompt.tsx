import type { ReactElement } from 'react'

import type { SnapshotRefreshRequiredReason } from './blockSnapshotTransform.ts'
import { snapshotRefreshPromptCopy } from './snapshotRefreshPromptCopy.ts'

type SnapshotRefreshPromptProps = {
  blockId: string
  reason: SnapshotRefreshRequiredReason
  onRefresh?: () => void
}

export function SnapshotRefreshPrompt({
  blockId,
  reason,
  onRefresh,
}: SnapshotRefreshPromptProps): ReactElement {
  return (
    <div
      data-testid={`snapshot-refresh-prompt-${blockId}`}
      data-reason={reason}
      role="status"
      aria-live="polite"
      className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
    >
      <p>{snapshotRefreshPromptCopy(reason)}</p>
      {onRefresh === undefined ? null : (
        <button
          type="button"
          onClick={onRefresh}
          className="self-start rounded-md border border-amber-400 bg-white px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 dark:bg-amber-900 dark:text-amber-50 dark:hover:bg-amber-800"
        >
          Refresh
        </button>
      )}
    </div>
  )
}

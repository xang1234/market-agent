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
      className="flex flex-col gap-2 rounded-md border border-warning bg-warning-soft p-3 text-sm text-warning"
    >
      <p>{snapshotRefreshPromptCopy(reason)}</p>
      {onRefresh === undefined ? null : (
        <button
          type="button"
          onClick={onRefresh}
          className="self-start rounded-md border border-warning bg-surface px-3 py-1 text-xs font-medium text-warning hover:bg-warning-soft"
        >
          Refresh
        </button>
      )}
    </div>
  )
}

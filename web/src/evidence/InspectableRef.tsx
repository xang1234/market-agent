import type { ReactElement, ReactNode } from 'react'

import { useEvidenceInspector } from './useEvidenceInspector.ts'
import type { EvidenceInspectionRef } from './inspectionTypes.ts'

type DataAttrs = { [K in `data-${string}`]?: string }

type InspectableRefProps = {
  snapshotId: string
  inspectionRef: EvidenceInspectionRef
  children: ReactNode
  className?: string
  testId?: string
  dataAttrs?: DataAttrs
}

const DEFAULT_CLASS = 'text-left underline decoration-dotted underline-offset-2'

export function InspectableRef({
  snapshotId,
  inspectionRef,
  children,
  className,
  testId,
  dataAttrs,
}: InspectableRefProps): ReactElement {
  const inspector = useEvidenceInspector()
  const sharedAttrs = {
    'data-testid': testId,
    'data-inspection-kind': inspectionRef.kind,
    'data-inspection-id': inspectionRef.id,
    ...dataAttrs,
  }
  const controlClassName = className ?? DEFAULT_CLASS

  if (inspector === null) {
    return (
      <span
        {...sharedAttrs}
        data-inspection-disabled="true"
        className={controlClassName}
      >
        {children}
      </span>
    )
  }

  return (
    <button
      type="button"
      {...sharedAttrs}
      onClick={() => inspector.openInspection({ snapshotId, ref: inspectionRef })}
      className={`border-0 bg-transparent p-0 ${controlClassName}`}
    >
      {children}
    </button>
  )
}

import type { ReactElement } from 'react'

import { VERIFICATION_TEXT, type VerificationKind } from './verification.ts'

const CLASSES: Readonly<Record<VerificationKind, string>> = {
  verified: 'border-positive/40 bg-positive-soft text-positive',
  partial: 'border-line-strong bg-surface-2 text-fg-soft',
  narrative: 'border-line bg-surface text-muted',
  legacy: 'border-line bg-surface text-muted',
}

export function VerificationLabel({ kind }: { kind: VerificationKind }): ReactElement {
  return (
    <span data-verification={kind} className={`inline-block rounded border px-1.5 py-0.5 text-[11px] font-medium ${CLASSES[kind]}`}>
      {VERIFICATION_TEXT[kind]}
    </span>
  )
}

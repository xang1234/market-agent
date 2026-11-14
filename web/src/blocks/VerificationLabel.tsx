import type { ReactElement } from 'react'

import { PILL_CLASS, VERIFICATION_CLASSES, VERIFICATION_TEXT, type VerificationKind } from './verification.ts'

export function VerificationLabel({ kind }: { kind: VerificationKind }): ReactElement {
  return (
    <span data-verification={kind} className={`${PILL_CLASS} ${VERIFICATION_CLASSES[kind]}`}>
      {VERIFICATION_TEXT[kind]}
    </span>
  )
}

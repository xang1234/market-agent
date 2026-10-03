import { createContext } from 'react'

import type { VerificationKind } from './verification.ts'

// Mirror of services/snapshot/src/block-proof.ts: three independent claims the
// server derives for each block on every read (#193). The client only displays
// them; nothing it sends, and nothing the model writes, can set one.
export type BlockProof = {
  evidence: 'linked' | 'unknown'
  calculation: 'verified' | 'not_verified'
  public_by_cutoff: 'proven' | 'unknown'
}

// Kinds that make no claim about values (notices, source lists, containers) or
// that label themselves (certified financial answers): no outer proof label.
const NO_CLAIM_KINDS: ReadonlySet<string> = new Set(['disclosure', 'sources', 'section', 'financial_answer'])

// The labels a block's proof earns. Arithmetic and public-time claims come only
// with a certified result; source linkage alone is labelled as just that.
// Commentary that cites nothing makes no claim, so it gets no label.
export function proofLabels(proof: BlockProof, kind: string): VerificationKind[] {
  if (NO_CLAIM_KINDS.has(kind)) return []
  if (proof.calculation === 'verified') return proof.public_by_cutoff === 'proven' ? ['verified', 'public_by_cutoff'] : ['verified']
  if (proof.evidence === 'linked') return [kind === 'rich_text' ? 'narrative' : 'source_linked']
  return kind === 'rich_text' ? [] : ['not_verified']
}

// What each claim means, for the inspector. Without a proof (a view the server
// did not assess), every claim reads as unknown or not verified.
export function proofRows(proof: BlockProof | undefined): Array<{ label: string; value: string }> {
  return [
    {
      label: 'Evidence binding',
      value: proof?.evidence === 'linked'
        ? 'Source-linked: every value shown binds to evidence sealed in this snapshot.'
        : 'Unknown: no sealed evidence binding is established for this view.',
    },
    {
      label: 'Calculation',
      value: proof?.calculation === 'verified'
        ? 'Verified: the server independently recomputed this result from its recorded inputs.'
        : 'Not verified: values are shown as sourced or derived, not independently recomputed.',
    },
    {
      label: 'Public by cutoff',
      value: proof?.public_by_cutoff === 'proven'
        ? 'Proven: each source version was publicly available by the knowledge cutoff.'
        : 'Unknown: being stored by the cutoff does not prove the source was public then.',
    },
  ]
}

// The proof for the block being rendered, for kinds that label themselves
// (certified financial answers). Absent outside a server-assessed view.
export const BlockProofContext = createContext<BlockProof | null>(null)

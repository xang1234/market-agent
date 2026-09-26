// The four verification states every surface uses. A label belongs to one
// result, cell, criterion, or block — never to a whole answer — so model
// commentary next to a certified value never inherits its badge.
export type VerificationKind = 'verified' | 'partial' | 'narrative' | 'legacy'

export const VERIFICATION_TEXT: Readonly<Record<VerificationKind, string>> = {
  verified: 'Verified calculation',
  partial: 'Partial coverage',
  narrative: 'Source-linked narrative',
  legacy: 'Legacy output',
}

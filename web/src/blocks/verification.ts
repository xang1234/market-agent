// The verification states every surface uses. A label belongs to one
// result, cell, criterion, or block — never to a whole answer — so model
// commentary next to a certified value never inherits its badge.
// 'unverified' appears only in development (CHAT_VERIFICATION_MODE=display_unverified):
// the block failed verification and was shown anyway, unsaved.
export type VerificationKind = 'verified' | 'partial' | 'narrative' | 'legacy' | 'unverified'

export const VERIFICATION_TEXT: Readonly<Record<VerificationKind, string>> = {
  verified: 'Verified calculation',
  partial: 'Partial coverage',
  narrative: 'Source-linked narrative',
  legacy: 'Legacy output',
  unverified: 'Unverified',
}

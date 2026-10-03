// The verification states every surface uses. A label belongs to one
// result, cell, criterion, or block — never to a whole answer — so model
// commentary next to a certified value never inherits its badge.
// 'unverified' appears only in development (CHAT_VERIFICATION_MODE=display_unverified):
// the block failed verification and was shown anyway, unsaved.
// 'source_linked', 'public_by_cutoff' and 'not_verified' come from the
// server-derived block proof (blockProof.ts).
export type VerificationKind =
  | 'verified'
  | 'public_by_cutoff'
  | 'source_linked'
  | 'partial'
  | 'narrative'
  | 'legacy'
  | 'not_verified'
  | 'unverified'

export const VERIFICATION_TEXT: Readonly<Record<VerificationKind, string>> = {
  verified: 'Verified calculation',
  public_by_cutoff: 'Public by cutoff',
  source_linked: 'Source-linked',
  partial: 'Partial coverage',
  narrative: 'Source-linked narrative',
  legacy: 'Legacy output',
  not_verified: 'Not verified',
  unverified: 'Unverified',
}

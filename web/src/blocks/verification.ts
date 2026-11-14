// The verification states every surface uses. A label belongs to one
// result, cell, criterion, or block — never to a whole answer — so model
// commentary next to a certified value never inherits its badge.
// 'unverified' appears only in development (CHAT_VERIFICATION_MODE=display_unverified):
// the block failed verification and was shown anyway, unsaved.
// 'source_linked', 'public_by_cutoff' and 'not_verified' come from the
// server-derived block proof (blockProof.ts). 'user_supplied' marks an input
// the user typed, such as a scenario's P/E (#201): never reported data.
// 'conditional_comparison' marks a scenario value set against a price (#224):
// conditional on that P/E, never an expected return.
export type VerificationKind =
  | 'verified'
  | 'public_by_cutoff'
  | 'source_linked'
  | 'partial'
  | 'narrative'
  | 'legacy'
  | 'not_verified'
  | 'unverified'
  | 'user_supplied'
  | 'conditional_comparison'

export const VERIFICATION_TEXT: Readonly<Record<VerificationKind, string>> = {
  verified: 'Verified calculation',
  public_by_cutoff: 'Public by cutoff',
  source_linked: 'Source-linked',
  partial: 'Partial coverage',
  narrative: 'Source-linked narrative',
  legacy: 'Legacy output',
  not_verified: 'Not verified',
  unverified: 'Unverified',
  user_supplied: 'Your assumption',
  conditional_comparison: 'Conditional scenario comparison',
}

export const VERIFICATION_CLASSES: Readonly<Record<VerificationKind, string>> = {
  verified: 'border-positive/40 bg-positive-soft text-positive',
  public_by_cutoff: 'border-positive/40 bg-positive-soft text-positive',
  source_linked: 'border-line bg-surface text-muted',
  not_verified: 'border-line bg-surface text-muted',
  partial: 'border-line-strong bg-surface-2 text-fg-soft',
  narrative: 'border-line bg-surface text-muted',
  legacy: 'border-line bg-surface text-muted',
  unverified: 'border-negative/40 bg-negative-soft text-negative',
  user_supplied: 'border-line-strong bg-surface-2 text-fg-soft',
  conditional_comparison: 'border-line-strong bg-surface-2 text-fg-soft',
}

export const PILL_CLASS = 'inline-block rounded border px-1.5 py-0.5 text-[11px] font-medium'

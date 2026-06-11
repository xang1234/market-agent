// The seal-input core moved to services/snapshot/src/seal-input.ts (it speaks
// entirely in snapshot-layer types and is consumed by analyst-grids too).
// Re-exported here so analyze's builders keep their import path.
export {
  buildClaimBackedSealInput,
  buildFactBackedSealInput,
  toSealFactRow,
  withRequiredDisclosures,
  type ClaimSealClaim,
  type ClaimSealDocument,
  type FactRow,
  type SealableBlock,
  type SealToolCallRef,
} from "../../snapshot/src/seal-input.ts";

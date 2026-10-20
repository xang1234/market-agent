// The frozen golden dataset's issuers (services/chat/test/golden/dataset.ts):
// illustrative figures on real CIKs, which live SEC ingestion must not repair.
export const GOLDEN_ISSUER_IDS = Object.freeze({
  NVDA: "60000000-0000-4000-8000-000000000001",
  AMD: "60000000-0000-4000-8000-000000000002",
  AAPL: "60000000-0000-4000-8000-000000000003",
} as const);

// Compatibility facade. The implementation lives in the shared financial core;
// only the legacy threshold-write contract is re-exported here so existing
// callers (thesis, Discovery, web) keep their stricter accepted input forms.
export {
  EXACT_DECIMAL_STRING_PATTERN,
  MAX_DECIMAL_DIGITS,
  MAX_DECIMAL_SCALE,
  compareExactDecimals,
  exactDecimalNumericToken,
  isExactThresholdInput,
  multiplyExactDecimals,
  normalizeLegacyExactThreshold,
  parseExactDecimal,
  type DecimalInput,
  type ExactDecimal,
} from "../../financial-core/src/exact-decimal.ts";

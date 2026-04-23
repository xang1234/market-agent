export type IdentifierHint =
  | { kind: "cik"; value: string }
  | { kind: "isin"; value: string }
  | { kind: "lei"; value: string };

export type NormalizedQuery = {
  raw_input: string;
  trimmed: string;
  // Present iff `trimmed` contains no whitespace. Preserves every
  // distinguishing character of the input (case-folded only) so GOOG and
  // GOOGL, BRK.A and BRK.B, never collapse. Feeds `listings.ticker` lookups.
  ticker_candidate?: string;
  // Lowercase, punctuation stripped, whitespace collapsed. Preserves letters
  // and digits so distinct short symbols ("goog" vs "googl") stay distinct
  // at this axis too. Feeds issuer name / alias lookups.
  name_candidate: string;
  // Pattern-level classification only; this module does not query the DB.
  // 3.3 uses the hint to route to `issuers.cik`, `instruments.isin`, or
  // `issuers.lei` respectively.
  identifier_hint?: IdentifierHint;
};

export function normalize(input: string): NormalizedQuery {
  const trimmed = input.trim();

  const ticker_candidate =
    trimmed.length > 0 && !/\s/.test(trimmed) ? trimmed.toUpperCase() : undefined;

  const name_candidate = trimmed
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  const identifier_hint = detectIdentifier(trimmed);

  return {
    raw_input: input,
    trimmed,
    name_candidate,
    ...(ticker_candidate !== undefined ? { ticker_candidate } : {}),
    ...(identifier_hint ? { identifier_hint } : {}),
  };
}

// Strip leading zeros so "320193" and "0000320193" resolve to the same
// issuer. All-zeros collapses to "0"; empty input stays empty (the
// fallback is for "0000" → "0", not "" → "0"). Shared between normalize's
// hint classifier and the CIK resolver so both read/write sides agree.
export function normalizeCik(value: string): string {
  if (value.length === 0) return "";
  const stripped = value.replace(/^0+/, "");
  return stripped.length === 0 ? "0" : stripped;
}

// The three patterns below are disjoint by charset and length (CIK is pure
// digits, ISIN requires two leading letters, LEI is 20 chars), so the check
// order is not semantic — changing it cannot produce a different classification.
function detectIdentifier(trimmed: string): IdentifierHint | undefined {
  if (/^\d{1,10}$/.test(trimmed)) {
    return { kind: "cik", value: normalizeCik(trimmed) };
  }

  const upper = trimmed.toUpperCase();

  // ISIN: 2-letter country code + 9 alphanumeric + 1 check digit.
  if (/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(upper)) {
    return { kind: "isin", value: upper };
  }

  // LEI: 20 alphanumeric characters (ISO 17442).
  if (/^[A-Z0-9]{20}$/.test(upper)) {
    return { kind: "lei", value: upper };
  }

  return undefined;
}

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

function detectIdentifier(trimmed: string): IdentifierHint | undefined {
  if (/^\d{1,10}$/.test(trimmed)) {
    // Strip leading zeros so "0000320193" and "320193" resolve to the same
    // issuer. "0" collapses to "0" rather than the empty string.
    const value = trimmed.replace(/^0+/, "") || "0";
    return { kind: "cik", value };
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

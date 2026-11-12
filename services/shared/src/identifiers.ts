// Canonical identifier normalization shared by services that read or write
// issuer identity fields.

export function normalizeCik(value: string): string {
  if (value.length === 0) return "";
  const stripped = value.replace(/^0+/, "");
  return stripped.length === 0 ? "0" : stripped;
}

// The US exchanges SEC filers list on. A ticker SEC assigns a CIK names a
// listing on one of these, never a same-symbol listing abroad.
export const US_EQUITY_MICS: readonly string[] = Object.freeze(["ARCX", "BATS", "IEXG", "XASE", "XNAS", "XNYS"]);

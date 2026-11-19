// Canonical identifier normalization shared by services that read or write
// issuer identity fields.

export function normalizeCik(value: string): string {
  if (value.length === 0) return "";
  const stripped = value.replace(/^0+/, "");
  return stripped.length === 0 ? "0" : stripped;
}

/**
 * Whether the issuer still holds `cik`, share-locking its row until the
 * caller's transaction ends. A SEC writer calls it before storing what it
 * downloaded by the CIK, so the CIK fill cannot move the CIK between this
 * check and the commit, and waits to see the stored rows (#685).
 */
export async function issuerHoldsCik(
  db: { query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }> },
  issuerId: string,
  cik: number,
): Promise<boolean> {
  const { rows } = await db.query(`select 1 from issuers where issuer_id = $1 and ltrim(cik, '0') = $2 for share`, [issuerId, String(cik)]);
  return rows.length > 0;
}

// The US exchanges SEC filers list on. A ticker SEC assigns a CIK names a
// listing on one of these, never a same-symbol listing abroad.
export const US_EQUITY_MICS: readonly string[] = Object.freeze(["ARCX", "BATS", "IEXG", "XASE", "XNAS", "XNYS"]);

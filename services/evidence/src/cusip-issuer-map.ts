import type { QueryExecutor } from "./types.ts";

// Resolve a 13F holding's CUSIP to a tracked issuer. Matches an explicit
// instruments.cusip, or derives the CUSIP from a US ISIN (US + 9-char CUSIP +
// check digit). Returns null when no tracked instrument carries the identifier —
// the 13F handler then skips + logs the holding (Q8). Coverage grows as OpenFIGI
// enrichment (fra-ajvd.7) populates instrument identifiers.
export async function resolveIssuerByCusip(db: QueryExecutor, cusip: string): Promise<string | null> {
  const normalized = cusip.trim().toUpperCase();
  // A CUSIP is exactly 9 characters; anything else can't match (and avoids a
  // substr() false-positive against an unrelated ISIN).
  if (normalized.length !== 9) return null;

  // Resolve in deterministic phases — an explicit cusip first, then a US-ISIN
  // derivation. Within a phase, >1 distinct issuer is ambiguous → return null
  // rather than pick an arbitrary row (which could misattribute holdings).
  const direct = await matchIssuers(
    db,
    `select distinct issuer_id::text as issuer_id from instruments where upper(cusip) = $1 limit 2`,
    normalized,
  );
  if (direct.length > 1) return null; // ambiguous direct match → don't guess
  if (direct.length === 1) return direct[0]!;

  const derived = await matchIssuers(
    db,
    `select distinct issuer_id::text as issuer_id
       from instruments
      where isin like 'US%' and upper(substr(isin, 3, 9)) = $1
      limit 2`,
    normalized,
  );
  return derived.length === 1 ? derived[0]! : null; // none, or ambiguous → null
}

async function matchIssuers(db: QueryExecutor, sql: string, cusip: string): Promise<string[]> {
  const { rows } = await db.query<{ issuer_id: string }>(sql, [cusip]);
  return rows.map((r) => r.issuer_id);
}

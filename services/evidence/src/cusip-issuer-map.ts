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
  const { rows } = await db.query<{ issuer_id: string }>(
    `select issuer_id::text as issuer_id
       from instruments
      where cusip = $1
         or (isin like 'US%' and upper(substr(isin, 3, 9)) = $1)
      limit 1`,
    [normalized],
  );
  return rows[0]?.issuer_id ?? null;
}

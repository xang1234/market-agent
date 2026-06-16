import type { QueryExecutor } from "./types.ts";

// Map an SEC CIK to a tracked issuer_id, matching either the zero-padded or bare
// form (issuers.cik is stored as text). Returns null when the issuer is not
// tracked (tracked-scope, Q9) — callers skip + log. Shared by the Form 4 and
// 8-K ingest handlers/backfills.
export async function resolveIssuerIdByCik(db: QueryExecutor, cik: number): Promise<string | null> {
  const { rows } = await db.query<{ issuer_id: string }>(
    `select issuer_id::text as issuer_id from issuers where cik = $1 or cik = $2 limit 1`,
    [String(cik).padStart(10, "0"), String(cik)],
  );
  return rows[0]?.issuer_id ?? null;
}

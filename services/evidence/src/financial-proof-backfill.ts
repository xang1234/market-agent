// Dry-run-first backfill of precision proofs for existing facts.
//
// Legacy numerics are never promoted by assumption: a fact is revalidated only
// when retained, authorized source bytes yield a token that equals the stored
// value exactly. Missing bytes, mismatched values, and malformed tokens are
// reported and recorded as legacy_unverified (an explicit precision gap). A
// mismatch is not auto-corrected: correcting it means a reviewed superseding
// fact, which never mutates values already cited by snapshots. Reruns are
// idempotent. No bulk run happens during deployment.

import { checkTokenAgainstStoredValue, recordFactPrecisionAttestation } from "./financial-attestations.ts";
import type { QueryExecutor } from "./types.ts";
import { assertNonEmptyString } from "./validators.ts";

export type BackfillFact = Readonly<{
  fact_id: string;
  source_id: string;
  metric_key: string;
  period_end: string | null;
  fiscal_year: number | null;
  fiscal_period: string | null;
  value_text: string;
}>;

/** Re-reads authorized retained source bytes for a fact; null when none are retained. */
export type RetainedSourceReader = (fact: BackfillFact) => Promise<
  Readonly<{ raw_token: string; token_proof_hash: string; source_locator: string }> | null
>;

export type ProofBackfillOutcome = Readonly<{
  fact_id: string;
  outcome: "revalidated" | "missing_source_bytes" | "value_mismatch" | "invalid_token";
}>;

export type ProofBackfillReport = Readonly<{
  dry_run: boolean;
  examined: number;
  revalidated: number;
  gaps: Readonly<{ missing_source_bytes: number; value_mismatch: number; invalid_token: number }>;
  outcomes: ReadonlyArray<ProofBackfillOutcome>;
}>;

export async function backfillFactPrecisionProofs(
  db: QueryExecutor,
  options: { dry_run: boolean; limit: number; reader: RetainedSourceReader; validation_method: string },
): Promise<ProofBackfillReport> {
  assertNonEmptyString(options.validation_method, "validation_method");
  if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 10_000) {
    throw new RangeError("limit must be an integer from 1 to 10000");
  }
  // Candidates: reported/extracted facts with no proof yet, or whose latest
  // proof is legacy_unverified (retained bytes may have become available).
  const facts = (await db.query<BackfillFact & { has_proof: boolean }>(
    `select f.fact_id::text, f.source_id::text, m.metric_key, f.period_end::text, f.fiscal_year, f.fiscal_period,
            f.value_num::text as value_text, latest.precision_attestation_id is not null as has_proof
       from facts f
       join metrics m on m.metric_id = f.metric_id
       left join lateral (
         select a.precision_attestation_id, a.precision_class
           from fact_precision_attestations a
          where a.fact_id = f.fact_id
            and not exists (select 1 from fact_precision_attestations newer where newer.supersedes = a.precision_attestation_id)
       ) latest on true
      where f.method in ('reported', 'extracted')
        and f.value_num is not null
        and (latest.precision_attestation_id is null or latest.precision_class = 'legacy_unverified')
      order by f.fact_id
      limit $1`,
    [options.limit],
  )).rows;

  const outcomes: ProofBackfillOutcome[] = [];
  for (const fact of facts) {
    const retained = await options.reader(fact);
    const check = retained === null ? "missing_source_bytes" : checkTokenAgainstStoredValue(retained.raw_token, fact.value_text);
    const outcome = check === "match" ? "revalidated" : check;
    outcomes.push({ fact_id: fact.fact_id, outcome });
    if (options.dry_run) continue;
    if (outcome === "revalidated" && retained !== null) {
      await recordFactPrecisionAttestation(db, {
        fact_id: fact.fact_id,
        precision_class: "revalidated_against_source",
        raw_token: retained.raw_token,
        token_proof_hash: retained.token_proof_hash,
        source_locator: retained.source_locator,
        validation_method: options.validation_method,
      });
    } else if (!fact.has_proof) {
      await recordFactPrecisionAttestation(db, {
        fact_id: fact.fact_id,
        precision_class: "legacy_unverified",
        validation_method: `${options.validation_method}:${outcome}`,
      });
    }
  }

  const count = (outcome: ProofBackfillOutcome["outcome"]) => outcomes.filter((entry) => entry.outcome === outcome).length;
  return {
    dry_run: options.dry_run,
    examined: outcomes.length,
    revalidated: count("revalidated"),
    gaps: { missing_source_bytes: count("missing_source_bytes"), value_mismatch: count("value_mismatch"), invalid_token: count("invalid_token") },
    outcomes,
  };
}

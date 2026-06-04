// Mints the vendor facts an analyst_consensus block binds: analyst_count plus
// one count per rating bucket. The values arrive in an AnalystConsensusEnvelope
// (not the facts table), so each is a fresh method='vendor', point-in-time fact
// via the canonical createFact path. createFact returns the row, so the emitter
// seals straight from these rows with no load query.

import { createFact, type FactInput } from "../../evidence/src/fact-repo.ts";
import type { QueryExecutor } from "../../evidence/src/types.ts";
import { toSealFactRow, type FactRow } from "./block-seal-input.ts";
import {
  ANALYST_RATINGS,
  type AnalystConsensusEnvelope,
  type AnalystRating,
} from "../../fundamentals/src/analyst-consensus.ts";
import type { IssuerSubjectRef, UUID } from "../../fundamentals/src/subject-ref.ts";

const ANALYST_COUNT_METRIC_KEY = "analyst_count";
const RATING_METRIC_KEY: Readonly<Record<AnalystRating, string>> = {
  strong_buy: "analyst_rating_strong_buy",
  buy: "analyst_rating_buy",
  hold: "analyst_rating_hold",
  sell: "analyst_rating_sell",
  strong_sell: "analyst_rating_strong_sell",
};
const RATING_LABEL: Readonly<Record<AnalystRating, string>> = {
  strong_buy: "Strong Buy",
  buy: "Buy",
  hold: "Hold",
  sell: "Sell",
  strong_sell: "Strong Sell",
};
const VENDOR_VERIFICATION_STATUS = "authoritative" as const;
// Point-in-time, source-reported standing (same as peer_table's minted facts).
// NOT 'eod' — that tier triggers a market-price EOD disclosure, which is wrong
// for analyst rating counts (they aren't market prices).
const VENDOR_FRESHNESS_CLASS = "filing_time" as const;

export type MaterializedConsensusBucket = {
  rating: AnalystRating;
  bucket: string;
  count: number;
  count_ref: UUID;
};

export type MaterializedConsensus = {
  analyst_count_ref: UUID;
  analyst_count: number;
  buckets: ReadonlyArray<MaterializedConsensusBucket>;
  factRows: ReadonlyArray<FactRow>;
};

export async function materializeConsensusFacts(
  db: QueryExecutor,
  input: { issuer: IssuerSubjectRef; envelope: AnalystConsensusEnvelope; clock?: () => Date },
): Promise<MaterializedConsensus | null> {
  const dist = input.envelope.rating_distribution;
  if (dist === null) return null;
  const clock = input.clock ?? (() => new Date());
  const observedAt = clock().toISOString();
  const asOf = dist.as_of;
  const periodEnd = asOf.slice(0, 10);

  const metricIds = await resolveMetricIds(db, [
    ANALYST_COUNT_METRIC_KEY,
    ...ANALYST_RATINGS.map((rating) => RATING_METRIC_KEY[rating]),
  ]);

  // Mint the fact, then project to the lean seal-row shape via toSealFactRow
  // (which drops freshness_class so no freshness disclosure is demanded).
  const mint = async (metricKey: string, value: number): Promise<FactRow> => {
    const metricId = metricIds.get(metricKey);
    if (metricId === undefined) {
      throw new Error(`analyst-consensus-materializer: no metric_id registered for "${metricKey}"`);
    }
    const fact = await createFact(db, {
      subject_kind: "issuer",
      subject_id: input.issuer.id,
      metric_id: metricId,
      period_kind: "point",
      period_end: periodEnd,
      value_num: value,
      unit: "count",
      as_of: asOf,
      observed_at: observedAt,
      source_id: dist.source_id,
      method: "vendor",
      verification_status: VENDOR_VERIFICATION_STATUS,
      freshness_class: VENDOR_FRESHNESS_CLASS,
      coverage_level: "full",
      confidence: 1,
    } satisfies FactInput);
    return toSealFactRow(fact);
  };

  const factRows: FactRow[] = [];
  const analystCountFact = await mint(ANALYST_COUNT_METRIC_KEY, input.envelope.analyst_count);
  factRows.push(analystCountFact);

  const buckets: MaterializedConsensusBucket[] = [];
  for (const rating of ANALYST_RATINGS) {
    const fact = await mint(RATING_METRIC_KEY[rating], dist.counts[rating]);
    factRows.push(fact);
    buckets.push({ rating, bucket: RATING_LABEL[rating], count: dist.counts[rating], count_ref: fact.fact_id });
  }

  return {
    analyst_count_ref: analystCountFact.fact_id,
    analyst_count: input.envelope.analyst_count,
    buckets,
    factRows,
  };
}

async function resolveMetricIds(
  db: QueryExecutor,
  keys: ReadonlyArray<string>,
): Promise<ReadonlyMap<string, UUID>> {
  const { rows } = await db.query<{ metric_key: string; metric_id: string }>(
    `select metric_key, metric_id::text as metric_id
       from metrics
      where metric_key = any($1::text[])`,
    [[...keys]],
  );
  const map = new Map<string, UUID>();
  for (const row of rows) map.set(row.metric_key, row.metric_id);
  return map;
}

// Mints the 3 issuer vendor facts a price_target_range block binds (low/mean/high)
// from the consensus envelope's price_target. Returned LEAN (via toSealFactRow):
// analyst targets are opinion, not a market price, so they surface no freshness
// disclosure (the current-price fact does that).

import { createFact, type FactInput } from "../../evidence/src/fact-repo.ts";
import { resolveMetricIds } from "../../evidence/src/metric-repo.ts";
import type { QueryExecutor } from "../../evidence/src/types.ts";
import type { PriceTarget } from "../../fundamentals/src/analyst-consensus.ts";
import type { IssuerSubjectRef } from "../../fundamentals/src/subject-ref.ts";
import { toSealFactRow, type FactRow } from "./block-seal-input.ts";

const LOW_KEY = "price_target_low";
const MEAN_KEY = "price_target_mean";
const HIGH_KEY = "price_target_high";
const VENDOR_VERIFICATION_STATUS = "authoritative" as const;
const VENDOR_FRESHNESS_CLASS = "eod" as const;

export type MaterializedPriceTargets = {
  low: { ref: string; value: number };
  mean: { ref: string; value: number };
  high: { ref: string; value: number };
  currency: string;
  factRows: ReadonlyArray<FactRow>;
};

export async function materializePriceTargetFacts(
  db: QueryExecutor,
  input: { issuer: IssuerSubjectRef; priceTarget: PriceTarget; clock?: () => Date },
): Promise<MaterializedPriceTargets> {
  const clock = input.clock ?? (() => new Date());
  const observedAt = clock().toISOString();
  const pt = input.priceTarget;
  const periodEnd = pt.as_of.slice(0, 10);
  const metricIds = await resolveMetricIds(db, [LOW_KEY, MEAN_KEY, HIGH_KEY]);
  const factRows: FactRow[] = [];

  const mint = async (metricKey: string, value: number): Promise<string> => {
    const metricId = metricIds.get(metricKey);
    if (metricId === undefined) {
      throw new Error(`price-target-materializer: no metric_id registered for "${metricKey}"`);
    }
    const fact = await createFact(db, {
      subject_kind: "issuer",
      subject_id: input.issuer.id,
      metric_id: metricId,
      period_kind: "point",
      period_end: periodEnd,
      value_num: value,
      unit: "currency",
      currency: pt.currency,
      as_of: pt.as_of,
      observed_at: observedAt,
      source_id: pt.source_id,
      method: "vendor",
      verification_status: VENDOR_VERIFICATION_STATUS,
      freshness_class: VENDOR_FRESHNESS_CLASS,
      coverage_level: "full",
      confidence: 1,
    } satisfies FactInput);
    const lean = toSealFactRow(fact);
    factRows.push(lean);
    return lean.fact_id;
  };

  const lowRef = await mint(LOW_KEY, pt.low);
  const meanRef = await mint(MEAN_KEY, pt.mean);
  const highRef = await mint(HIGH_KEY, pt.high);

  return {
    low: { ref: lowRef, value: pt.low },
    mean: { ref: meanRef, value: pt.mean },
    high: { ref: highRef, value: pt.high },
    currency: pt.currency,
    factRows,
  };
}

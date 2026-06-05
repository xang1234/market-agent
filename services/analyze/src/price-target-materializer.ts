// Mints the 3 issuer vendor facts a price_target_range block binds (low/mean/high)
// from the consensus envelope's price_target. Returned LEAN (via toSealFactRow):
// analyst targets are opinion, not a market price, so they surface no freshness
// disclosure (the current-price fact does that).

import { resolveMetricIds } from "../../evidence/src/metric-repo.ts";
import type { QueryExecutor } from "../../evidence/src/types.ts";
import type { PriceTarget } from "../../fundamentals/src/analyst-consensus.ts";
import type { IssuerSubjectRef } from "../../fundamentals/src/subject-ref.ts";
import { toSealFactRow, type FactRow } from "./block-seal-input.ts";
import { mintVendorPointFact } from "./vendor-fact.ts";

const LOW_KEY = "price_target_low";
const MEAN_KEY = "price_target_mean";
const HIGH_KEY = "price_target_high";
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
  const metricIds = await resolveMetricIds(db, [LOW_KEY, MEAN_KEY, HIGH_KEY]);
  const factRows: FactRow[] = [];

  const mint = async (metricKey: string, value: number): Promise<string> => {
    const metricId = metricIds.get(metricKey);
    if (metricId === undefined) {
      throw new Error(`price-target-materializer: no metric_id registered for "${metricKey}"`);
    }
    const fact = await mintVendorPointFact(db, {
      subject: input.issuer,
      metricId,
      value,
      unit: "currency",
      currency: pt.currency,
      asOf: pt.as_of,
      sourceId: pt.source_id,
      freshnessClass: VENDOR_FRESHNESS_CLASS,
      observedAt,
    });
    const lean = toSealFactRow(fact); // analyst opinion → no freshness disclosure
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

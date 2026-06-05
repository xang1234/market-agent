// Mints a current-price fact from a market quote: a subject_kind='listing',
// method='vendor', point-in-time fact via the canonical createFact path. Unlike
// the analyst-consensus materializer (which strips freshness so no disclosure is
// demanded), this returns the FULL fact row with freshness_class intact — a
// market price's freshness is material, so the consumer's seal will correctly
// require an eod/delayed pricing disclosure.

import { type FactRow, type FreshnessClass } from "../../evidence/src/fact-repo.ts";
import { resolveMetricIds } from "../../evidence/src/metric-repo.ts";
import type { QueryExecutor } from "../../evidence/src/types.ts";
import type { DelayClass, NormalizedQuote } from "../../market/src/quote.ts";
import { mintVendorPointFact } from "./vendor-fact.ts";

const PRICE_METRIC_KEY = "price";

export function mapDelayClassToFreshness(delay: DelayClass): FreshnessClass {
  switch (delay) {
    case "real_time":
      return "real_time";
    case "delayed_15m":
      return "delayed_15m";
    case "eod":
      return "eod";
    case "unknown":
      return "stale";
  }
}

export async function materializePriceFact(
  db: QueryExecutor,
  input: { quote: NormalizedQuote; clock?: () => Date },
): Promise<FactRow> {
  const clock = input.clock ?? (() => new Date());
  const metricId = await resolvePriceMetricId(db);
  const { quote } = input;
  // Returns the FULL row (freshness_class intact) so the consumer's seal
  // correctly requires an eod/delayed pricing disclosure — unlike the lean
  // analyst/price-target facts.
  return mintVendorPointFact(db, {
    subject: quote.listing,
    metricId,
    value: quote.price,
    unit: "currency",
    currency: quote.currency,
    asOf: quote.as_of,
    sourceId: quote.source_id,
    freshnessClass: mapDelayClassToFreshness(quote.delay_class),
    observedAt: clock().toISOString(),
  });
}

async function resolvePriceMetricId(db: QueryExecutor): Promise<string> {
  const id = (await resolveMetricIds(db, [PRICE_METRIC_KEY])).get(PRICE_METRIC_KEY);
  if (id === undefined) {
    throw new Error(`price-fact-materializer: no metric_id registered for "${PRICE_METRIC_KEY}"`);
  }
  return id;
}

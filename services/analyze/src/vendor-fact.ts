// Mints a method='vendor', point-in-time fact via createFact — the shared shape
// the analyze materializers all use (analyst counts, price targets, current
// price): authoritative, full coverage, confidence 1, period_end derived from
// as_of. Returns the full fact row; callers project to a lean seal row with
// toSealFactRow when they don't want the freshness surfaced as a disclosure.

import { createFact, type FactRow, type FactSubjectKind, type FreshnessClass } from "../../evidence/src/fact-repo.ts";
import type { QueryExecutor } from "../../evidence/src/types.ts";

export function mintVendorPointFact(
  db: QueryExecutor,
  input: {
    subject: { kind: FactSubjectKind; id: string };
    metricId: string;
    value: number;
    unit: string;
    currency?: string;
    asOf: string;
    sourceId: string;
    freshnessClass: FreshnessClass;
    observedAt: string;
  },
): Promise<FactRow> {
  return createFact(db, {
    subject_kind: input.subject.kind,
    subject_id: input.subject.id,
    metric_id: input.metricId,
    period_kind: "point",
    period_end: input.asOf.slice(0, 10),
    value_num: input.value,
    unit: input.unit,
    ...(input.currency === undefined ? {} : { currency: input.currency }),
    as_of: input.asOf,
    observed_at: input.observedAt,
    source_id: input.sourceId,
    method: "vendor",
    verification_status: "authoritative",
    freshness_class: input.freshnessClass,
    coverage_level: "full",
    confidence: 1,
  });
}

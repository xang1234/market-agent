// Charts and tables for a chat answer, built from issuer facts with no model
// involvement: every value on screen is a reported fact, cited by id
// (value_ref), bound with the verifier's own metadata (data_ref.params.
// fact_bindings), and attributed to its source. The model only writes the
// narrative around them.
//
// Block choice is a fixed rule, not a model-driven tool loop: for one company,
// the latest quarter as a metric_row plus revenue over the last 8 quarters.

import { formatCompactCurrency } from "../../analyze/src/block-format.ts";
import { buildRevenueBarsBlock } from "../../analyze/src/revenue-bars-block-builder.ts";
import { loadVerifierFactsForRefs } from "../../evidence/src/local-runtime-evidence.ts";
import {
  loadRecentIssuerFundamentals,
  type IssuerFundamentalFact,
} from "../../fundamentals/src/issuer-fundamentals-reader.ts";
import type { IssuerSubjectRef } from "../../fundamentals/src/subject-ref.ts";
import type { VerifierFact } from "../../snapshot/src/snapshot-verifier.ts";
import { stableUuid } from "./chat-ids.ts";

const QUARTERS_SHOWN = 8;
const LATEST_QUARTER_METRICS = [
  ["revenue", "Revenue"],
  ["gross_profit", "Gross profit"],
  ["operating_income", "Operating income"],
  ["net_income", "Net income"],
] as const;
const METRIC_KEYS = LATEST_QUARTER_METRICS.map(([key]) => key);
const QUARTER_ORDER: Readonly<Record<string, number>> = { Q1: 1, Q2: 2, Q3: 3, Q4: 4 };

type QueryExecutor = Parameters<typeof loadRecentIssuerFundamentals>[0] &
  Parameters<typeof loadVerifierFactsForRefs>[0];
type Block = Record<string, unknown>;

// Loads the issuer's quarterly facts through the shared eligibility rule and
// builds the blocks. Empty on failure: a chart must never cost the user the
// answer, so a failed read degrades to narrative only.
export async function loadIssuerFactBlocks(
  db: QueryExecutor,
  input: { issuer: IssuerSubjectRef | null; snapshotId: string; asOf: string },
): Promise<ReadonlyArray<Block>> {
  if (input.issuer === null) return [];
  try {
    const facts = await loadRecentIssuerFundamentals(db, input.issuer, {
      channel: "app",
      periodKind: "fiscal_q",
      metricKeys: METRIC_KEYS,
    });
    const verifierFacts = await loadVerifierFactsForRefs(db, { fact_refs: facts.map((fact) => fact.fact_id) });
    return buildIssuerFactBlocks({ facts, verifierFacts, snapshotId: input.snapshotId, asOf: input.asOf });
  } catch (reason) {
    console.warn("[chat] fact blocks unavailable; answering with narrative only", reason);
    return [];
  }
}

export function buildIssuerFactBlocks(input: {
  facts: ReadonlyArray<IssuerFundamentalFact>;
  verifierFacts: ReadonlyArray<VerifierFact>;
  snapshotId: string;
  asOf: string;
}): ReadonlyArray<Block> {
  // Only facts the seal can load and bind may render.
  const loadable = new Map(input.verifierFacts.map((fact) => [fact.fact_id, fact]));
  // The reader returns newest first, so the first fact per metric and quarter wins.
  const byQuarter = new Map<string, IssuerFundamentalFact>();
  for (const fact of input.facts) {
    if (fact.value_num === null || fact.fiscal_year === null || !fact.fiscal_period) continue;
    if (!loadable.has(fact.fact_id)) continue;
    const key = quarterKey(fact.metric_key, fact.fiscal_year, fact.fiscal_period);
    if (!byQuarter.has(key)) byQuarter.set(key, fact);
  }

  const revenue = [...byQuarter.values()]
    .filter((fact) => fact.metric_key === "revenue")
    .sort(byFiscalQuarter)
    .slice(-QUARTERS_SHOWN);
  const latest = revenue.at(-1);
  if (latest === undefined) return [];

  const latestFacts = LATEST_QUARTER_METRICS.flatMap(([key, label]) => {
    const fact = byQuarter.get(quarterKey(key, latest.fiscal_year!, latest.fiscal_period!));
    return fact ? [{ fact, label }] : [];
  });
  const period = quarterLabel(latest);

  const metricRow: Block = {
    ...blockBase("metric_row", input, latestFacts.map(({ fact }) => fact), loadable),
    title: `Latest quarter (${period})`,
    items: latestFacts.map(({ fact, label }) => ({
      label,
      value_ref: fact.fact_id,
      format: formatCompactCurrency(nativeValue(fact), fact.currency ?? "USD"),
    })),
  };

  const bars = buildRevenueBarsBlock({
    facts: revenue.map((fact) => ({
      fact_id: fact.fact_id,
      fiscal_year: fact.fiscal_year,
      fiscal_period: fact.fiscal_period,
      value_num: fact.value_num!,
      scale: fact.scale,
      currency: fact.currency,
    })),
    base: {
      id: blockId("revenue_bars", input.snapshotId),
      snapshot_id: input.snapshotId,
      as_of: input.asOf,
      source_refs: [],
      title: "Quarterly revenue",
    },
  });
  const revenueBars: Block = { ...bars, ...blockBase("revenue_bars", input, revenue, loadable) };

  return Object.freeze([metricRow, revenueBars]);
}

function blockBase(
  kind: string,
  input: { snapshotId: string; asOf: string },
  facts: ReadonlyArray<IssuerFundamentalFact>,
  loadable: ReadonlyMap<string, VerifierFact>,
): Block {
  const id = blockId(kind, input.snapshotId);
  return {
    id,
    kind,
    snapshot_id: input.snapshotId,
    data_ref: {
      kind,
      id,
      params: { fact_bindings: facts.map((fact) => bindingFor(loadable.get(fact.fact_id)!)) },
    },
    source_refs: [...new Set(facts.map((fact) => fact.source_id))],
    as_of: input.asOf,
    // Promoted to manifest.fact_refs when the answer is sealed.
    provenance_fact_refs: facts.map((fact) => fact.fact_id),
  };
}

// The binding is the verifier's view of the fact minus its source, so it
// matches the row the seal re-loads by construction.
function bindingFor(fact: VerifierFact): Record<string, unknown> {
  const { source_id: _sourceId, ...binding } = fact;
  return binding;
}

function blockId(kind: string, snapshotId: string): string {
  return stableUuid(`block:${snapshotId}:${kind}`);
}

function quarterKey(metricKey: string, fiscalYear: number, fiscalPeriod: string): string {
  return `${metricKey}|${fiscalYear}|${fiscalPeriod}`;
}

function quarterLabel(fact: IssuerFundamentalFact): string {
  return `${fact.fiscal_period} ${fact.fiscal_year}`;
}

function nativeValue(fact: IssuerFundamentalFact): number {
  return fact.value_num! * fact.scale;
}

function byFiscalQuarter(a: IssuerFundamentalFact, b: IssuerFundamentalFact): number {
  return (a.fiscal_year! - b.fiscal_year!) ||
    ((QUARTER_ORDER[a.fiscal_period!] ?? 0) - (QUARTER_ORDER[b.fiscal_period!] ?? 0));
}

// The human-readable text of fact blocks (titles, labels, formatted values):
// what the user sees, and so what the narrative may quote.
export function displayTextsForBlocks(blocks: ReadonlyArray<Block>): string[] {
  const texts: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value !== null && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        if (DISPLAY_KEYS.has(key) && typeof child === "string") texts.push(child);
        else if (key !== "data_ref") visit(child);
      }
    }
  };
  blocks.forEach(visit);
  return texts;
}

const DISPLAY_KEYS = new Set(["title", "label", "format"]);

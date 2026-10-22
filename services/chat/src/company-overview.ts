import { DEFAULT_EXECUTION_LIMITS, publicAtCutoff, type IsoDateTime } from "../../financial-core/src/index.ts";
import { buildDeterministicPlan, type PlanningContext, type PlanningResult, type RequestedSubject } from "../../financial-engine/src/planner.ts";
import type { FinancialEvidencePort, InputCandidate } from "../../financial-engine/src/ports.ts";
import { requestedFiscalQuarter, requestedFiscalYear, requestedPriceWindow, type FiscalQuarter } from "./fact-blocks.ts";
import { GROWTH, MARGINS, quarterBefore } from "./quarter-metrics.ts";
import { PARTIAL_QUARTER, type ScopeProposal } from "./research-scope.ts";

const SLOT = "a";
const QUARTERS_SHOWN = 8;

type Node = Record<string, unknown> & { node_id: string };

/** Whether a turn may be a company overview before its reading: one resolved company it names, not carried, and no period. */
export function namesOneCompany(subjects: ReadonlyArray<RequestedSubject>, carried: boolean, text: string): boolean {
  return subjects.length === 1 && subjects[0]!.resolution.status === "resolved" && !carried &&
    requestedFiscalYear(text) === undefined && requestedFiscalQuarter(text) === undefined && !PARTIAL_QUARTER.test(text) && requestedPriceWindow(text) === undefined;
}

/** Whether the reading of a question asks for no figure and turns nothing off ("no margins"), so the overview answers it. */
export function asksForNoFigure(reading: ScopeProposal | null): boolean {
  return reading !== null && reading.metrics.length === 0 && reading.income_items.length === 0 &&
    reading.turns_off.facets.size === 0 && reading.turns_off.metrics.size === 0 &&
    [...reading.asks].every((facet) => facet === "latest_quarter");
}

/**
 * The overview of the context's one company, from the newest quarter it
 * reported revenue for; null when it reported none. The engine's latest
 * quarter is the newest it can certify, and it cannot certify the fourth
 * quarters the SEC ingester derives (#469), so each quarter is named: one the
 * engine cannot certify is a gap cell where it falls.
 */
export async function planCompanyOverview(context: PlanningContext, evidence: FinancialEvidencePort): Promise<PlanningResult | null> {
  const subject = context.requested_subjects[0]!;
  if (subject.resolution.status !== "resolved") return null;
  const page = await evidence.listInputCandidates({
    authority: context.authority,
    subject: subject.resolution.subject_ref,
    metric_key: "revenue",
    fiscal_year: null,
    fiscal_period: null,
    limit: DEFAULT_EXECUTION_LIMITS.max_input_candidates,
  });
  if (page.status === "error") throw new Error(`the company's quarters could not be read: ${page.reason_code}`);
  // ponytail: a truncated page may lack the newest quarter, so the planner answers instead.
  const newest = page.truncated ? null : newestQuarter(page.candidates, context.knowledge_cutoff);
  return newest && buildDeterministicPlan(context, companyOverviewDraft(subject.mention, newest));
}

// The engine sees a fact once a proof says its filing was public by the
// cutoff. Precision is not asked, so a derived fourth quarter counts.
function newestQuarter(candidates: ReadonlyArray<InputCandidate>, cutoff: IsoDateTime): FiscalQuarter | null {
  const newest = candidates
    .filter((candidate) => candidate.period.fiscal_period !== "FY" && candidate.publication.some((proof) => publicAtCutoff(proof.timing, cutoff) === "eligible"))
    .reduce<InputCandidate | null>((best, candidate) => (best === null || candidate.period.end > best.period.end ? candidate : best), null);
  return newest && { fiscal_year: newest.period.fiscal_year, fiscal_period: newest.period.fiscal_period };
}

function companyOverviewDraft(mention: string, newest: FiscalQuarter) {
  const quarter = (metric: string, back: number): Node => {
    const period = quarterBefore(newest.fiscal_year, newest.fiscal_period, back)!;
    return {
      node_id: `${metric}_fy${period.fiscal_year}_${period.fiscal_period.toLowerCase()}`,
      operation: "reported_metric",
      subject_slot: SLOT,
      metric_key: metric,
      period: { kind: "fiscal_period", ...period },
    };
  };
  const revenue = Array.from({ length: QUARTERS_SHOWN }, (_, back) => quarter("revenue", back));
  const lines = MARGINS.map(({ numerator }) => quarter(numerator, 0));
  const margins = MARGINS.map(({ metric }, index): Node => ({ node_id: metric, operation: metric, numerator: lines[index]!.node_id, revenue: revenue[0]!.node_id }));
  const growth = GROWTH.map(({ metric, back }): Node => ({ node_id: metric, operation: "percent_change_positive_base", current: revenue[0]!.node_id, prior: revenue[back]!.node_id }));
  return {
    subjects: [{ slot_id: SLOT, mention }],
    operations: [...revenue, ...lines, ...margins, ...growth],
    outputs: [...[...revenue].reverse(), ...lines, ...margins, ...growth].map((node) => ({ output_id: `out_${node.node_id}`, node_id: node.node_id })),
    thresholds: [],
  };
}

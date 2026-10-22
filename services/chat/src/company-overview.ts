import { DEFAULT_EXECUTION_LIMITS, publicAtCutoff, type FinancialSubjectRef, type IsoDateTime } from "../../financial-core/src/index.ts";
import { buildDeterministicPlan, type PlanningContext, type PlanningResult, type RequestedSubject } from "../../financial-engine/src/planner.ts";
import type { FinancialEvidencePort, InputCandidate } from "../../financial-engine/src/ports.ts";
import { requestedFiscalQuarter, requestedFiscalYear, requestedPriceWindow, type FiscalQuarter } from "./fact-blocks.ts";
import { GROWTH, MARGINS, quarterBefore } from "./quarter-metrics.ts";
import { PARTIAL_QUARTER, type ScopeProposal } from "./research-scope.ts";

const QUARTERS_SHOWN = 8;

type Node = Record<string, unknown> & { node_id: string };

/** Whether a turn may be a company overview before its reading: resolved companies it names, none carried, and no period. */
export function namesCompanies(subjects: ReadonlyArray<RequestedSubject>, carried: boolean, text: string): boolean {
  return subjects.length > 0 && subjects.every((subject) => subject.resolution.status === "resolved") && !carried &&
    requestedFiscalYear(text) === undefined && requestedFiscalQuarter(text) === undefined && !PARTIAL_QUARTER.test(text) && requestedPriceWindow(text) === undefined;
}

/**
 * The companies a turn's overview covers, by the reading of its question: the
 * ones it names, or the one it names and that company's peers when it asks
 * for peers. Null when it asks for a figure, turns something off ("no
 * margins"), or asks for peers of several companies or of one with none.
 */
export async function overviewSubjects(
  subjects: ReadonlyArray<RequestedSubject>,
  reading: ScopeProposal | null,
  peersOf: (issuer: FinancialSubjectRef) => Promise<ReadonlyArray<RequestedSubject>>,
): Promise<ReadonlyArray<RequestedSubject> | null> {
  if (!asksForNoFigure(reading)) return null;
  if (!reading.asks.has("peers")) return subjects;
  const company = subjects.length === 1 ? subjects[0]! : null;
  if (company?.resolution.status !== "resolved") return null;
  const peers = await peersOf(company.resolution.subject_ref);
  return peers.length === 0 ? null : [company, ...peers];
}

function asksForNoFigure(reading: ScopeProposal | null): reading is ScopeProposal {
  return reading !== null && reading.metrics.length === 0 && reading.income_items.length === 0 &&
    reading.turns_off.facets.size === 0 && reading.turns_off.metrics.size === 0 &&
    [...reading.asks].every((facet) => facet === "latest_quarter" || facet === "peers");
}

/** The evidence could not list a company's quarters; any other throw is a defect. */
export class OverviewEvidenceError extends Error {
  constructor(reasonCode: string) {
    super(`the company's quarters could not be read: ${reasonCode}`);
    this.name = "OverviewEvidenceError";
  }
}

/**
 * The overview of the context's companies, each from the newest quarter it
 * reported revenue for, so fiscal calendars are never aligned by date; null
 * when one reported none. The engine's latest quarter is the newest it can
 * certify, and it cannot certify the fourth quarters the SEC ingester derives
 * (#469), so each quarter is named: one the engine cannot certify is a gap
 * cell where it falls.
 */
export async function planCompanyOverview(context: PlanningContext, evidence: FinancialEvidencePort): Promise<PlanningResult | null> {
  const subjects = context.requested_subjects;
  const refs = subjects.flatMap((subject) => subject.resolution.status === "resolved" ? [subject.resolution.subject_ref] : []);
  if (refs.length < subjects.length) return null;
  const pages = await Promise.all(refs.map((subject) => evidence.listInputCandidates({
    authority: context.authority,
    subject,
    metric_key: "revenue",
    fiscal_year: null,
    fiscal_period: null,
    limit: DEFAULT_EXECUTION_LIMITS.max_input_candidates,
  })));
  const newest = pages.map((page) => {
    if (page.status === "error") throw new OverviewEvidenceError(page.reason_code);
    // ponytail: a truncated page may lack the newest quarter, so the planner answers instead.
    return page.truncated ? null : newestQuarter(page.candidates, context.knowledge_cutoff);
  });
  if (newest.includes(null)) return null;
  return buildDeterministicPlan(context, companyOverviewDraft(subjects.map((subject, index) => ({ mention: subject.mention, newest: newest[index]! }))));
}

// The engine sees a fact once a proof says its filing was public by the
// cutoff. Precision is not asked, so a derived fourth quarter counts.
function newestQuarter(candidates: ReadonlyArray<InputCandidate>, cutoff: IsoDateTime): FiscalQuarter | null {
  const newest = candidates
    .filter((candidate) => candidate.period.fiscal_period !== "FY" && candidate.publication.some((proof) => publicAtCutoff(proof.timing, cutoff) === "eligible"))
    .reduce<InputCandidate | null>((best, candidate) => (best === null || candidate.period.end > best.period.end ? candidate : best), null);
  return newest && { fiscal_year: newest.period.fiscal_year, fiscal_period: newest.period.fiscal_period };
}

function companyOverviewDraft(companies: ReadonlyArray<{ mention: string; newest: FiscalQuarter }>) {
  const several = companies.length > 1;
  const backs = several ? [0, ...GROWTH.map(({ back }) => back)] : Array.from({ length: QUARTERS_SHOWN }, (_, back) => back);
  const parts = companies.map(({ mention, newest }, index) => {
    const slot = String.fromCharCode(97 + index);
    const id = (name: string) => several ? `${slot}_${name}` : name;
    const quarter = (metric: string, back: number): Node => {
      const period = quarterBefore(newest.fiscal_year, newest.fiscal_period, back)!;
      return {
        node_id: id(`${metric}_fy${period.fiscal_year}_${period.fiscal_period.toLowerCase()}`),
        operation: "reported_metric",
        subject_slot: slot,
        metric_key: metric,
        period: { kind: "fiscal_period", ...period },
      };
    };
    const revenue = new Map(backs.map((back) => [back, quarter("revenue", back)]));
    const latest = revenue.get(0)!;
    const lines = MARGINS.map(({ numerator }) => quarter(numerator, 0));
    const margins = MARGINS.map(({ metric }, line): Node => ({ node_id: id(metric), operation: metric, numerator: lines[line]!.node_id, revenue: latest.node_id }));
    const growth = GROWTH.map(({ metric, back }): Node => ({ node_id: id(metric), operation: "percent_change_positive_base", current: latest.node_id, prior: revenue.get(back)!.node_id }));
    return {
      subject: { slot_id: slot, mention },
      operations: [...revenue.values(), ...lines, ...margins, ...growth],
      outputs: [...(several ? [latest] : [...revenue.values()].reverse()), ...lines, ...margins, ...growth],
    };
  });
  return {
    subjects: parts.map((part) => part.subject),
    operations: parts.flatMap((part) => part.operations),
    outputs: parts.flatMap((part) => part.outputs).map((node) => ({ output_id: `out_${node.node_id}`, node_id: node.node_id })),
    thresholds: [],
  };
}

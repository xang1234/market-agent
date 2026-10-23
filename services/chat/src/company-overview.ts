import { DEFAULT_EXECUTION_LIMITS, type FinancialSubjectRef } from "../../financial-core/src/index.ts";
import { isDatabaseError } from "../../financial-engine/src/evidence-adapter.ts";
import { buildDeterministicPlan, type PlanningContext, type PlanningResult, type RequestedSubject } from "../../financial-engine/src/planner.ts";
import type { FinancialEvidencePort, InputCandidate, SqlExecutor } from "../../financial-engine/src/ports.ts";
import { issuerLabels } from "../../financial-engine/src/request.ts";
import { reportedBy, type SelectionPolicy } from "../../financial-engine/src/select-inputs.ts";
import { createSqlPeerSetResolver } from "../../fundamentals/src/peer-set-resolver.ts";
import { MAX_TURN_SUBJECTS } from "./coordinator.ts";
import type { FiscalQuarter } from "./fact-blocks.ts";
import { GROWTH, MARGINS, quarterBefore } from "./quarter-metrics.ts";
import { readingAsks, type PERIOD_FIELDS, type ResearchScope, type ScopeFacet, type ScopeProposal } from "./research-scope.ts";

const QUARTERS_SHOWN = 8;
const UNPLANNED = "[chat] the company overview could not be planned; the planner answers";

type Node = Record<string, unknown> & { node_id: string };
export type PeersOf = (issuer: FinancialSubjectRef) => Promise<ReadonlyArray<RequestedSubject>>;
type ReadyPlan = Extract<PlanningResult, { outcome: "ready" }>;

/** Whether every company a turn covers, named or carried, is resolved, as an overview needs. */
export function allResolved(subjects: ReadonlyArray<RequestedSubject>): boolean {
  return subjects.length > 0 && subjects.every((subject) => subject.resolution.status === "resolved");
}

/**
 * The companies a turn's overview covers, by the reading of its question: the
 * ones it names, or the one it names and that company's peers when it asks
 * for peers. Null when it asks for a figure or a period other than the
 * latest, turns off something it shows ("no margins"), it has no scope or one with a
 * price window the overview would not show, or it asks for peers of several
 * companies or of one with none.
 */
export async function overviewSubjects(
  subjects: ReadonlyArray<RequestedSubject>,
  reading: ScopeProposal | null,
  scope: Pick<ResearchScope, "price_window"> | null,
  peersOf: PeersOf,
): Promise<ReadonlyArray<RequestedSubject> | null> {
  if (!asksForNoFigure(reading) || scope === null || scope.price_window) return null;
  if (!readingAsks(reading).asks.has("peers")) return subjects;
  const company = subjects.length === 1 ? subjects[0]! : null;
  if (company?.resolution.status !== "resolved") return null;
  const peers = await peersOf(company.resolution.subject_ref);
  return peers.length === 0 ? null : [company, ...peers];
}

// Its commentary comments on its figures; a cause stays a named gap.
const OVERVIEW_ASKS: ReadonlySet<ScopeFacet> = new Set(["latest_quarter", "peers", "explains"]);
const OVERVIEW_SHOWS: ReadonlySet<ScopeFacet | (typeof PERIOD_FIELDS)[number]> = new Set(["latest_quarter", "margins", "margin_trend"]);

function asksForNoFigure(reading: ScopeProposal | null): reading is ScopeProposal {
  if (reading === null) return false;
  const { asks, offFacets, offMetrics } = readingAsks(reading);
  return (reading.period.kind === "none" || reading.period.kind === "latest") && reading.metrics.length === 0 && reading.income_items.length === 0 &&
    ![...offFacets].some((facet) => OVERVIEW_SHOWS.has(facet)) && offMetrics.size === 0 && [...asks].every((facet) => OVERVIEW_ASKS.has(facet));
}

/**
 * A company's peers, as many as the turn's company cap leaves room for, each
 * named to the planner by its issuer id and labelled by its legal name. None
 * when the database cannot be read; any other throw is a defect.
 */
export async function overviewPeers(db: SqlExecutor, issuer: FinancialSubjectRef): Promise<ReadonlyArray<RequestedSubject>> {
  try {
    const peers = await createSqlPeerSetResolver(db).resolvePeers(issuer.id, { limit: MAX_TURN_SUBJECTS - 1 });
    const names = await issuerLabels(db, peers.map((peer) => peer.id));
    return peers.map((peer) => ({ mention: peer.id, resolution: { status: "resolved", subject_ref: peer, label: names.get(peer.id) ?? peer.id } }));
  } catch (reason) {
    if (!isDatabaseError(reason)) throw reason;
    console.warn(UNPLANNED, reason);
    return [];
  }
}

/**
 * The overview of the context's companies, each from the newest quarter it
 * reported revenue for, so fiscal calendars are never aligned by date; null
 * when one reported none, or when it cannot be read or planned. A quarter
 * the engine cannot certify is a gap cell where it falls.
 */
export async function planCompanyOverview(context: PlanningContext, evidence: FinancialEvidencePort): Promise<ReadyPlan | null> {
  const companies: Array<{ mention: string; newest: FiscalQuarter }> = [];
  for (const subject of context.requested_subjects) {
    if (subject.resolution.status !== "resolved") return null;
    const page = await evidence.listInputCandidates({
      authority: context.authority,
      subject: subject.resolution.subject_ref,
      metric_key: "revenue",
      fiscal_year: null,
      fiscal_period: null,
      limit: DEFAULT_EXECUTION_LIMITS.max_input_candidates,
    });
    if (page.status === "error") {
      console.warn(UNPLANNED, page.reason_code);
      return null;
    }
    // ponytail: a truncated page may lack the newest quarter, so the planner answers instead.
    const newest = page.truncated ? null : newestQuarter(page.candidates, { knowledge_cutoff: context.knowledge_cutoff, allowed_source_classes: context.authority.allowed_source_classes });
    if (newest === null) return null;
    companies.push({ mention: subject.mention, newest });
  }
  const planned = buildDeterministicPlan(context, companyOverviewDraft(companies));
  if (planned.outcome === "ready") return planned;
  console.warn(UNPLANNED, planned);
  return null;
}

function newestQuarter(candidates: ReadonlyArray<InputCandidate>, policy: Pick<SelectionPolicy, "knowledge_cutoff" | "allowed_source_classes">): FiscalQuarter | null {
  const newest = candidates
    .filter((candidate) => candidate.period.fiscal_period !== "FY" && reportedBy(candidate, policy))
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

import { DEFAULT_EXECUTION_LIMITS, dayNumber, type FinancialSubjectRef } from "../../financial-core/src/index.ts";
import { isDatabaseError } from "../../financial-engine/src/evidence-adapter.ts";
import { buildDeterministicPlan, type PlanningContext, type PlanningResult, type RequestedSubject } from "../../financial-engine/src/planner.ts";
import type { FinancialEvidencePort, InputCandidate, SqlExecutor } from "../../financial-engine/src/ports.ts";
import { issuerLabels } from "../../financial-engine/src/request.ts";
import { reportedBy } from "../../financial-engine/src/select-inputs.ts";
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

/** A ready deterministic plan, and what it leaves out for its answer's note: each change it could not pair by date. */
export type OverviewPlan = ReadyPlan & Readonly<{ uncovered: ReadonlyArray<string> }>;

type Dates = Readonly<{ start: string; end: string }>;

// A company's revenue quarters, as the candidates reported by the cutoff state them.
type Company = Readonly<{
  mention: string;
  label: string;
  newest: FiscalQuarter;
  // A quarter's dates, when every revenue reported for it states the same ones.
  dated: (quarter: FiscalQuarter) => Dates | null;
}>;

/**
 * The overview of the context's companies, each from the newest quarter it
 * reported revenue for, so fiscal calendars are never aligned by date; null
 * when one reported none, or when it cannot be read or planned. A quarter
 * the engine cannot certify is a gap cell where it falls.
 */
export async function planCompanyOverview(context: PlanningContext, evidence: FinancialEvidencePort): Promise<OverviewPlan | null> {
  const companies = await companyQuarters(context, evidence);
  return companies && planned(context, companyOverviewDraft(companies));
}

/**
 * One company's three margins over its charted quarters, each with its high
 * and low (#398): the answer to a question about its margin trend, with no
 * model planning it. Null as for the overview.
 */
export async function planMarginTrend(context: PlanningContext, evidence: FinancialEvidencePort): Promise<OverviewPlan | null> {
  const companies = await companyQuarters(context, evidence);
  return companies && planned(context, { draft: marginTrendDraft(companies[0]!), uncovered: [] });
}

const TREND_ASKS: ReadonlySet<ScopeFacet> = new Set(["margin_trend", "margins", "explains"]);
const MARGIN_ITEMS: ReadonlySet<string> = new Set(MARGINS.map(({ metric }) => metric));

/**
 * The one company a question about its margin trend covers: its reading asks
 * for margins over time, names no other figure, and reads the latest
 * periods. Null otherwise, and for several companies, which the planner
 * answers.
 */
export function marginTrendSubjects(
  subjects: ReadonlyArray<RequestedSubject>,
  reading: ScopeProposal | null,
  scope: Pick<ResearchScope, "price_window"> | null,
): ReadonlyArray<RequestedSubject> | null {
  if (reading === null || scope === null || scope.price_window || subjects.length !== 1) return null;
  const { asks, offMetrics } = readingAsks(reading);
  const latest = reading.period.kind === "none" || reading.period.kind === "latest";
  const trendOnly = asks.has("margin_trend") && [...asks].every((facet) => TREND_ASKS.has(facet));
  const marginsOnly = reading.metrics.every((metric) => metric.metric_key === "income_statement") && reading.income_items.every((item) => MARGIN_ITEMS.has(item));
  return latest && trendOnly && marginsOnly && offMetrics.size === 0 ? subjects : null;
}

function planned(context: PlanningContext, { draft, uncovered }: { draft: unknown; uncovered: ReadonlyArray<string> }): OverviewPlan | null {
  const result = buildDeterministicPlan(context, draft);
  if (result.outcome === "ready") return { ...result, uncovered };
  console.warn(UNPLANNED, result);
  return null;
}

async function companyQuarters(context: PlanningContext, evidence: FinancialEvidencePort): Promise<Company[] | null> {
  const policy = { knowledge_cutoff: context.knowledge_cutoff, allowed_source_classes: context.authority.allowed_source_classes };
  const companies: Company[] = [];
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
    const reported = page.truncated ? [] : page.candidates.filter((candidate) => candidate.period.fiscal_period !== "FY" && reportedBy(candidate, policy));
    const newest = reported.reduce<InputCandidate | null>((best, candidate) => (best === null || candidate.period.end > best.period.end ? candidate : best), null);
    if (newest === null) return null;
    const { fiscal_year, fiscal_period } = newest.period;
    companies.push({ mention: subject.mention, label: subject.resolution.label, newest: { fiscal_year, fiscal_period }, dated: quarterDates(reported) });
  }
  return companies;
}

function quarterDates(reported: ReadonlyArray<InputCandidate>): Company["dated"] {
  const dates = new Map<string, Set<string>>();
  for (const { period } of reported) dates.set(quarterId(period), (dates.get(quarterId(period)) ?? new Set()).add(JSON.stringify([period.start, period.end])));
  return (quarter) => {
    const [only, ...others] = dates.get(quarterId(quarter)) ?? [];
    const [start, end] = only === undefined || others.length > 0 ? [null, null] : JSON.parse(only) as [string | null, string];
    return start === null ? null : { start, end: end! };
  };
}

// A quarter starts the day after the one before it ends. A week's slack takes
// a start dated a few days late, as some filings date them, and stays far
// below the shortest quarter (89 days), so a quarter skipped, mislabelled or
// moved to a new fiscal calendar never pairs with the one before it (#479).
const FOLLOWS_WITHIN_DAYS = 7;

// Whether each quarter of the `span` before `at` follows the one before it, by their reported dates.
function consecutive(company: Company, at: FiscalQuarter, span: number): boolean {
  return Array.from({ length: span }, (_, step) => step).every((step) => {
    const [prior, current] = [company.dated(before(at, step + 1)), company.dated(before(at, step))];
    if (prior === null || current === null) return false;
    const gap = dayNumber(current.start) - dayNumber(prior.end);
    return gap >= 1 && gap <= FOLLOWS_WITHIN_DAYS;
  });
}

const before = (quarter: FiscalQuarter, back: number): FiscalQuarter => quarterBefore(quarter.fiscal_year, quarter.fiscal_period, back)!;
const quarterId = (quarter: FiscalQuarter) => `fy${quarter.fiscal_year}_${quarter.fiscal_period.toLowerCase()}`;
const quarterText = (quarter: FiscalQuarter) => `${quarter.fiscal_period} FY${quarter.fiscal_year}`;

// A company's reported figure `back` quarters before its newest.
function quarterly(slot: string, id: (name: string) => string, newest: FiscalQuarter) {
  return (metric: string, back: number): Node => {
    const period = before(newest, back);
    return { node_id: id(`${metric}_${quarterId(period)}`), operation: "reported_metric", subject_slot: slot, metric_key: metric, period: { kind: "fiscal_period", ...period } };
  };
}

function companyOverviewDraft(companies: ReadonlyArray<Company>) {
  const several = companies.length > 1;
  const backs = several ? [0, ...GROWTH.map(({ back }) => back)] : Array.from({ length: QUARTERS_SHOWN }, (_, back) => back);
  const uncovered: string[] = [];
  const parts = companies.map((company, index) => {
    const slot = String.fromCharCode(97 + index);
    const id = (name: string) => several ? `${slot}_${name}` : name;
    const quarter = quarterly(slot, id, company.newest);
    const revenue = new Map(backs.map((back) => [back, quarter("revenue", back)]));
    const latest = revenue.get(0)!;
    const lines = MARGINS.map(({ numerator }) => quarter(numerator, 0));
    const margins = MARGINS.map(({ metric }, line): Node => ({ node_id: id(metric), operation: metric, numerator: lines[line]!.node_id, revenue: latest.node_id }));
    // Each charted quarter's change from the one before it, oldest first, then the latest's from a year earlier.
    const changes = [
      ...backs.filter((back) => revenue.has(back + 1)).reverse().map((back) => ({ back, span: 1, name: back === 0 ? GROWTH[0].metric : `${GROWTH[0].metric}_${quarterId(before(company.newest, back))}` })),
      { back: 0, span: GROWTH[1].back, name: GROWTH[1].metric },
    ];
    const growth = changes.flatMap(({ back, span, name }): Node[] => {
      const at = before(company.newest, back);
      if (consecutive(company, at, span)) return [{ node_id: id(name), operation: "percent_change_positive_base", current: revenue.get(back)!.node_id, prior: revenue.get(back + span)!.node_id }];
      uncovered.push(`revenue growth from ${quarterText(before(at, span))} to ${quarterText(at)}${several ? ` for ${company.label}` : ""}, whose quarters are not dated consecutively`);
      return [];
    });
    const charted = [...revenue.values()].reverse();
    const window = several ? [] : highAndLow("revenue", charted);
    return {
      subject: { slot_id: slot, mention: company.mention },
      operations: [...revenue.values(), ...lines, ...margins, ...growth, ...window],
      outputs: [...(several ? [latest] : charted), ...lines, ...margins, ...growth, ...window],
    };
  });
  return {
    draft: {
      subjects: parts.map((part) => part.subject),
      operations: parts.flatMap((part) => part.operations),
      outputs: parts.flatMap((part) => part.outputs).map((node) => ({ output_id: `out_${node.node_id}`, node_id: node.node_id })),
      thresholds: [],
    },
    uncovered,
  };
}

function marginTrendDraft(company: Company) {
  const quarter = quarterly("a", (name) => name, company.newest);
  const backs = Array.from({ length: QUARTERS_SHOWN }, (_, back) => QUARTERS_SHOWN - 1 - back);
  const revenue = backs.map((back) => quarter("revenue", back));
  const lines = MARGINS.map(({ numerator }) => backs.map((back) => quarter(numerator, back)));
  const margins = MARGINS.map(({ metric }, line) => lines[line]!.map((numerator, index): Node => ({
    node_id: `${metric}_${quarterId(before(company.newest, backs[index]!))}`,
    operation: metric,
    numerator: numerator.node_id,
    revenue: revenue[index]!.node_id,
  })));
  const windows = MARGINS.flatMap(({ metric }, line) => highAndLow(metric, margins[line]!));
  return {
    subjects: [{ slot_id: "a", mention: company.mention }],
    operations: [...revenue, ...lines.flat(), ...margins.flat(), ...windows],
    outputs: [...margins.flat(), ...windows].map((node) => ({ output_id: `out_${node.node_id}`, node_id: node.node_id })),
    thresholds: [],
  };
}

// A figure's highest and lowest among the quarters shown.
function highAndLow(name: string, members: ReadonlyArray<Node>): Node[] {
  return (["highest", "lowest"] as const).map((direction) => ({ node_id: `${name}_${direction}`, operation: "period_rank", members: members.map((member) => member.node_id), direction }));
}

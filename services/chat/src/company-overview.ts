import { coverSameMonths, DEFAULT_EXECUTION_LIMITS, dayNumber, type FinancialPlanV1, type FinancialRuntimeAuthority, type FinancialSubjectRef, type OperationNode, type PeriodSelector } from "../../financial-core/src/index.ts";
import { isDatabaseError } from "../../financial-engine/src/evidence-adapter.ts";
import { buildDeterministicPlan, type PlanningContext, type PlanningResult, type RequestedSubject } from "../../financial-engine/src/planner.ts";
import type { FinancialEvidencePort, InputCandidate, SqlExecutor } from "../../financial-engine/src/ports.ts";
import { issuerLabels } from "../../financial-engine/src/request.ts";
import { reportedBy } from "../../financial-engine/src/select-inputs.ts";
import { createSqlPeerSetResolver } from "../../fundamentals/src/peer-set-resolver.ts";
import { MAX_TURN_SUBJECTS } from "./coordinator.ts";
import { BALANCE_SHEET_ITEMS, readingAsks, type FiscalQuarter, type PERIOD_FIELDS, type ResearchScope, type ScopeFacet, type ScopeProposal } from "./research-scope.ts";

const QUARTERS_SHOWN = 8;
// Each margin, and the statement line it divides by revenue.
const MARGINS = [
  { metric: "gross_margin", numerator: "gross_profit" },
  { metric: "operating_margin", numerator: "operating_income" },
  { metric: "net_margin", numerator: "net_income" },
] as const;
// Revenue growth from the quarter before, and from a year earlier.
const GROWTH = [
  { metric: "revenue_growth_qoq", back: 1 },
  { metric: "revenue_growth_yoy", back: 4 },
] as const;
const QUARTERS = ["Q1", "Q2", "Q3", "Q4"];
const UNPLANNED = "[chat] the company overview could not be planned; the planner answers";
const TREND_UNPLANNED = "[chat] the margin trend could not be planned; the planner answers";
const FIGURES_UNPLANNED = "[chat] the follow-up's figures could not be planned; the planner answers";

type Node = Record<string, unknown> & { node_id: string };
export type PeersOf = (issuer: FinancialSubjectRef) => Promise<ReadonlyArray<RequestedSubject>>;
type ReadyPlan = Extract<PlanningResult, { outcome: "ready" }>;

/**
 * The period a turn's figures are read at: the latest, a fiscal year, or a
 * fiscal quarter, which with no year named is each company's newest such
 * quarter.
 */
export type ReadPeriod =
  | Readonly<{ kind: "latest" }>
  | Readonly<{ kind: "fiscal_year"; fiscal_year: number }>
  | Readonly<{ kind: "fiscal_quarter"; fiscal_period: string; fiscal_year: number | null }>;

export const LATEST: ReadPeriod = { kind: "latest" };

/**
 * The period a reading reads its figures at, or null for one no fiscal field
 * holds (TTM, a range), which the planner answers. A follow-up that names no
 * period keeps the one its scope holds; a question of its own reads the latest.
 */
export function readPeriod(reading: ScopeProposal, scope: Pick<ResearchScope, "fiscal_year" | "fiscal_quarter"> | null): ReadPeriod | null {
  const { period } = reading;
  switch (period.kind) {
    case "latest":
      return LATEST;
    case "fiscal_year":
      return { kind: "fiscal_year", fiscal_year: period.fiscal_year };
    case "fiscal_quarter": {
      // A quarter named alone takes the year its scope gives it (research-scope.ts), if any.
      const kept = scope?.fiscal_quarter?.fiscal_period === period.fiscal_period ? scope.fiscal_quarter.fiscal_year : null;
      return { kind: "fiscal_quarter", fiscal_period: period.fiscal_period, fiscal_year: period.fiscal_year ?? kept };
    }
    case "none":
      if (!continues(reading) || scope === null) return LATEST;
      if (scope.fiscal_quarter !== null) return { kind: "fiscal_quarter", ...scope.fiscal_quarter };
      return scope.fiscal_year === null ? LATEST : { kind: "fiscal_year", fiscal_year: scope.fiscal_year };
    default:
      return null;
  }
}

// A follow-up names no company of its own, so it continues its scope's
// companies, figures and period.
function continues(reading: ScopeProposal): boolean {
  return !(reading.companies.kind === "as_named" && reading.companies.names.length > 0);
}

// The chat catalog metrics a reading's figures are: a follow-up's are those its scope keeps.
function keptMetrics(reading: ScopeProposal, scope: Pick<ResearchScope, "metrics"> | null): string[] {
  return continues(reading) && scope !== null ? scope.metrics.map((metric) => metric.metric_key) : [];
}

/** Whether every company a turn covers, named or carried, is resolved, as an overview needs. */
export function allResolved(subjects: ReadonlyArray<RequestedSubject>): boolean {
  return subjects.length > 0 && subjects.every((subject) => subject.resolution.status === "resolved");
}

/**
 * The companies a turn's overview covers, by the reading of its question: the
 * ones it names, or the one it names and that company's peers when it asks
 * for peers. Null when it asks for a figure or a period no fiscal field holds,
 * turns off something it shows ("no margins"), it has no scope, it follows up
 * on figures beside the income statement, or it asks for peers of several
 * companies or of one with none.
 */
export async function overviewSubjects(
  subjects: ReadonlyArray<RequestedSubject>,
  reading: ScopeProposal | null,
  scope: Pick<ResearchScope, "metrics"> | null,
  peersOf: PeersOf,
): Promise<ReadonlyArray<RequestedSubject> | null> {
  if (!asksForNoFigure(reading) || scope === null || keptMetrics(reading, scope).some((key) => key !== INCOME_STATEMENT)) return null;
  if (!readingAsks(reading).asks.has("peers")) return subjects;
  const company = subjects.length === 1 ? subjects[0]! : null;
  if (company?.resolution.status !== "resolved") return null;
  const peers = await peersOf(company.resolution.subject_ref);
  return peers.length === 0 ? null : [company, ...peers];
}

// Its commentary comments on its figures; a cause stays a named gap.
const OVERVIEW_ASKS: ReadonlySet<ScopeFacet> = new Set(["latest_quarter", "peers", "explains"]);
const OVERVIEW_SHOWS: ReadonlySet<ScopeFacet | (typeof PERIOD_FIELDS)[number]> = new Set(["latest_quarter", "margins", "margin_trend"]);
const READ_PERIODS: ReadonlySet<ScopeProposal["period"]["kind"]> = new Set(["none", "latest", "fiscal_year", "fiscal_quarter"]);
const INCOME_STATEMENT = "income_statement";

function asksForNoFigure(reading: ScopeProposal | null): reading is ScopeProposal {
  if (reading === null) return false;
  const { asks, offFacets, offMetrics } = readingAsks(reading);
  return READ_PERIODS.has(reading.period.kind) && reading.metrics.length === 0 && reading.income_items.length === 0 &&
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

type Dates = Readonly<{ start: string | null; end: string }>;

type RevenueQuarters = Readonly<{
  newest: FiscalQuarter;
  quarters: ReadonlyArray<FiscalQuarter>;
  agreedDates: (quarter: FiscalQuarter) => Dates | "unreported" | "conflicting";
}>;

// A company's quarters with the one its figures are shown at.
type Anchored = RevenueQuarters & Readonly<{ anchor: FiscalQuarter }>;

// What a plan leaves out, for its answer's note, given each slot's company name.
type Omission = (name: (slot: string) => string) => string;

/**
 * The overview of the context's companies, each from its own quarter at the
 * period (anchorOf), so fiscal calendars are never aligned by date; null when
 * one reported no revenue, has no such quarter, or when it cannot be read or
 * planned. A quarter the engine cannot certify is a gap cell where it falls.
 */
export async function planCompanyOverview(context: PlanningContext, evidence: FinancialEvidencePort, period: ReadPeriod = LATEST): Promise<ReadyPlan | null> {
  const companies = await planningQuarters(context, evidence, UNPLANNED, period);
  return companies && planned(context, companyOverviewDraft(companies), UNPLANNED);
}

/** One company's three margins over the quarters charted to its quarter at the period, each with its high and low. Null as for planCompanyOverview. */
export async function planMarginTrend(context: PlanningContext, evidence: FinancialEvidencePort, period: ReadPeriod = LATEST): Promise<ReadyPlan | null> {
  const companies = await planningQuarters(context, evidence, TREND_UNPLANNED, period);
  return companies && planned(context, marginTrendDraft(companies[0]!), TREND_UNPLANNED);
}

/**
 * The chat catalog metrics a follow-up that asks for no figure of its own
 * reads again at its period, when its scope keeps any the overview does not
 * show; null otherwise. Its scope has applied what it turns off.
 */
export function keptFigures(reading: ScopeProposal, scope: Pick<ResearchScope, "metrics"> | null): ReadonlyArray<string> | null {
  const { asks } = readingAsks(reading);
  const kept = keptMetrics(reading, scope);
  const asksNone = READ_PERIODS.has(reading.period.kind) && reading.metrics.length === 0 && reading.income_items.length === 0 &&
    [...asks].every((facet) => facet === "explains" || facet === "latest_quarter");
  return asksNone && kept.some((key) => key !== INCOME_STATEMENT) ? kept : null;
}

// A figure computed from reported metrics of one period, each input by its role.
type Computed = Readonly<{ operation: OperationNode["operation"]; inputs: Readonly<Record<string, string>> }>;

// What a follow-up reads of each chat catalog metric, at the period it reads:
// engine metrics as reported, and figures computed from them in that period.
// A metric with no entry (a valuation, one no definition serves) is the
// planner's. The engine computes free cash flow for a fiscal year only, and a
// balance its filings certify at the year's end: at a quarter either is a gap
// cell with the engine's reason.
const AT_PERIOD: Readonly<Record<string, ReadonlyArray<string | Computed>>> = {
  income_statement: [
    "revenue",
    ...MARGINS.map(({ numerator }) => numerator),
    ...MARGINS.map(({ metric, numerator }) => ({ operation: metric, inputs: { numerator, revenue: "revenue" } })),
  ],
  operating_cash_flow: ["operating_cash_flow"],
  capex: ["capex"],
  free_cash_flow: ["operating_cash_flow", "capex", { operation: "free_cash_flow", inputs: { operating_cash_flow: "operating_cash_flow", capex: "capex" } }],
  eps_basic: ["eps_basic"],
  eps_diluted: ["eps_diluted"],
  balance_sheet: BALANCE_SHEET_ITEMS,
  cash_and_equivalents: ["cash_and_equivalents"],
  total_assets: ["total_assets"],
  total_liabilities: ["total_liabilities"],
  total_equity: ["total_equity"],
};

/**
 * Each company's figures for the chat catalog metrics, at the period: the
 * latest fiscal year, the year or quarter named, or a quarter named alone at
 * the company's newest such quarter. Null when a metric has no entry, or a
 * company has no such quarter or cannot be read or planned.
 */
export async function planScopeFigures(
  context: PlanningContext,
  evidence: FinancialEvidencePort,
  metrics: ReadonlyArray<string>,
  period: ReadPeriod,
): Promise<ReadyPlan | null> {
  const figures = metrics.map((key) => AT_PERIOD[key]);
  if (figures.length === 0 || figures.some((entry) => entry === undefined)) return null;
  const selectors = await periodSelectors(context, evidence, period);
  if (selectors === null) return null;
  const several = selectors.length > 1;
  const parts = selectors.map((selector, index) => {
    const slot = slotOf(index);
    const id = nodeIdOf(several, slot);
    const suffix = selector.kind === "fiscal_period" ? quarterId(selector) : "latest_fy";
    const reported = (metric: string): Node => ({ node_id: id(`${metric}_${suffix}`), operation: "reported_metric", subject_slot: slot, metric_key: metric, period: selector });
    const shown = figures.flat().map((figure): Node => typeof figure === "string"
      ? reported(figure)
      : { node_id: id(`${figure.operation}_${suffix}`), operation: figure.operation, ...Object.fromEntries(Object.entries(figure.inputs).map(([role, metric]) => [role, reported(metric).node_id])) });
    const inputs = figures.flat().flatMap((figure) => typeof figure === "string" ? [] : Object.values(figure.inputs).map(reported));
    return { operations: [...inputs, ...shown], outputs: shown };
  });
  const distinct = (nodes: ReadonlyArray<Node>) => [...new Map(nodes.map((node) => [node.node_id, node])).values()];
  return planned(context, { operations: distinct(parts.flatMap((part) => part.operations)), outputs: distinct(parts.flatMap((part) => part.outputs)) }, FIGURES_UNPLANNED);
}

async function periodSelectors(context: PlanningContext, evidence: FinancialEvidencePort, period: ReadPeriod): Promise<PeriodSelector[] | null> {
  const each = (selector: PeriodSelector) => context.requested_subjects.map(() => selector);
  switch (period.kind) {
    case "latest":
      return each({ kind: "latest", period_type: "annual", offset: 0 });
    case "fiscal_year":
      return each({ kind: "fiscal_period", fiscal_year: period.fiscal_year, fiscal_period: "FY" });
    case "fiscal_quarter": {
      if (period.fiscal_year !== null) return each(fiscalPeriod({ fiscal_year: period.fiscal_year, fiscal_period: period.fiscal_period }));
      const companies = await planningQuarters(context, evidence, FIGURES_UNPLANNED, period);
      return companies && companies.map(({ anchor }) => fiscalPeriod(anchor));
    }
  }
}

const fiscalPeriod = (quarter: FiscalQuarter) => ({ kind: "fiscal_period", ...quarter }) as PeriodSelector;

/**
 * What a saved overview plan leaves out, for its answer's note: read again
 * from the evidence by the plan's cutoff, so a run resumed without planning
 * notes what its first attempt planned. None for any other plan.
 */
export async function overviewOmissions(
  plan: FinancialPlanV1,
  authority: FinancialRuntimeAuthority,
  evidence: FinancialEvidencePort,
  name: (slot: string) => string,
): Promise<string[]> {
  if (plan.planner.kind !== "deterministic") return [];
  const members = [...plan.subjects.members].sort((left, right) => left.display_order - right.display_order);
  const saved = new Set(plan.operations.map((node) => node.node_id));
  // An overview names each company's margins by the margin alone, whatever growth it omits. A margin trend names each by its quarter.
  const several = members.length > 1;
  if (!members.every(({ slot_id }) => MARGINS.every(({ metric }) => saved.has(nodeIdOf(several, slot_id)(metric))))) return [];
  const companies = await revenueQuarters(members.map((member) => member.subject_ref), { authority, knowledge_cutoff: plan.time.knowledge_cutoff }, evidence, UNREAD);
  if (companies === null) return [];
  // Each company at the quarter its saved margins are of.
  const nodes = new Map(plan.operations.map((node) => [node.node_id, node]));
  const anchored = companies.flatMap((company, index) => {
    const margin = nodes.get(nodeIdOf(several, members[index]!.slot_id)(MARGINS[0].metric));
    const line = margin?.operation === MARGINS[0].metric ? nodes.get(margin.numerator) : undefined;
    return line?.operation === "reported_metric" && line.period.kind === "fiscal_period"
      ? [{ ...company, anchor: { fiscal_year: line.period.fiscal_year, fiscal_period: line.period.fiscal_period } }]
      : [];
  });
  if (anchored.length !== companies.length) return [];
  const { operations, omitted } = companyOverviewDraft(anchored);
  return operations.length === saved.size && operations.every((node) => saved.has(node.node_id)) ? omitted.map((omission) => omission(name)) : [];
}

const TREND_ASKS: ReadonlySet<ScopeFacet> = new Set(["margin_trend", "margins", "explains"]);
const MARGIN_ITEMS: ReadonlySet<string> = new Set(MARGINS.map(({ metric }) => metric));

/**
 * The one company a question about its margin trend covers: its reading asks
 * for margins over time, names no other figure, and reads the latest periods;
 * or it follows up on a trend its scope keeps by naming only another period.
 * Null otherwise, and for several companies, which the planner answers.
 */
export function marginTrendSubjects(
  subjects: ReadonlyArray<RequestedSubject>,
  reading: ScopeProposal | null,
  scope: Pick<ResearchScope, "margin_trend" | "metrics"> | null,
): ReadonlyArray<RequestedSubject> | null {
  if (reading === null || scope === null || subjects.length !== 1) return null;
  const { asks, offMetrics } = readingAsks(reading);
  const latest = reading.period.kind === "none" || reading.period.kind === "latest";
  const trendOnly = asks.has("margin_trend") && [...asks].every((facet) => TREND_ASKS.has(facet));
  const marginsOnly = reading.metrics.every((metric) => metric.metric_key === INCOME_STATEMENT) && reading.income_items.every((item) => MARGIN_ITEMS.has(item));
  const anotherPeriod = (reading.period.kind === "fiscal_year" || reading.period.kind === "fiscal_quarter") && asksForNoFigure(reading) && continues(reading) &&
    scope.margin_trend && keptMetrics(reading, scope).every((key) => key === INCOME_STATEMENT);
  return (latest && trendOnly && marginsOnly && offMetrics.size === 0) || anotherPeriod ? subjects : null;
}

const slotOf = (index: number) => String.fromCharCode(97 + index);
const nodeIdOf = (several: boolean, slot: string) => (name: string) => several ? `${slot}_${name}` : name;

function planned(context: PlanningContext, { operations, outputs }: { operations: ReadonlyArray<Node>; outputs: ReadonlyArray<Node> }, unplanned: string): ReadyPlan | null {
  const result = buildDeterministicPlan(context, {
    subjects: context.requested_subjects.map((subject, index) => ({ slot_id: slotOf(index), mention: subject.mention })),
    operations,
    outputs: outputs.map((node) => ({ output_id: `out_${node.node_id}`, node_id: node.node_id })),
    thresholds: [],
  });
  if (result.outcome === "ready") return result;
  console.warn(unplanned, result);
  return null;
}

async function planningQuarters(context: PlanningContext, evidence: FinancialEvidencePort, unplanned: string, period: ReadPeriod): Promise<Anchored[] | null> {
  const refs = context.requested_subjects.flatMap((subject) => subject.resolution.status === "resolved" ? [subject.resolution.subject_ref] : []);
  if (refs.length !== context.requested_subjects.length) return null;
  const companies = await revenueQuarters(refs, context, evidence, unplanned);
  const anchored = companies?.flatMap((company) => {
    const anchor = anchorOf(company, period);
    return anchor === null ? [] : [{ ...company, anchor }];
  });
  return anchored?.length === refs.length ? anchored : null;
}

// The quarter a company's figures are shown at: its newest for the latest; a
// fiscal year's newest it reported, else that year's fourth; the quarter
// named, or with no year its newest such quarter, which it may never have
// reported (null).
function anchorOf(company: RevenueQuarters, period: ReadPeriod): FiscalQuarter | null {
  const order = (quarter: FiscalQuarter) => quarter.fiscal_year * 4 + QUARTERS.indexOf(quarter.fiscal_period);
  const newestOf = (quarters: ReadonlyArray<FiscalQuarter>) =>
    quarters.reduce<FiscalQuarter | null>((best, quarter) => (best === null || order(quarter) > order(best) ? quarter : best), null);
  switch (period.kind) {
    case "latest":
      return company.newest;
    case "fiscal_year":
      return newestOf(company.quarters.filter((quarter) => quarter.fiscal_year === period.fiscal_year)) ?? { fiscal_year: period.fiscal_year, fiscal_period: "Q4" };
    case "fiscal_quarter":
      return period.fiscal_year === null
        ? newestOf(company.quarters.filter((quarter) => quarter.fiscal_period === period.fiscal_period))
        : { fiscal_year: period.fiscal_year, fiscal_period: period.fiscal_period };
  }
}

const UNREAD = "[chat] the overview's revenue quarters could not be read again, so its note names no growth it leaves out";

async function revenueQuarters(
  subjects: ReadonlyArray<FinancialSubjectRef>,
  { authority, knowledge_cutoff }: Pick<PlanningContext, "authority" | "knowledge_cutoff">,
  evidence: FinancialEvidencePort,
  unread: string,
): Promise<RevenueQuarters[] | null> {
  const policy = { knowledge_cutoff, allowed_source_classes: authority.allowed_source_classes };
  const companies: RevenueQuarters[] = [];
  for (const subject of subjects) {
    const page = await evidence.listInputCandidates({
      authority,
      subject,
      metric_key: "revenue",
      fiscal_year: null,
      fiscal_period: null,
      limit: DEFAULT_EXECUTION_LIMITS.max_input_candidates,
    });
    if (page.status === "error") {
      console.warn(unread, page.reason_code);
      return null;
    }
    // ponytail: a truncated page may lack the newest quarter, so the planner answers instead.
    const reported = page.truncated ? [] : page.candidates.filter((candidate) => candidate.period.fiscal_period !== "FY" && reportedBy(candidate, policy));
    const newest = reported.reduce<InputCandidate | null>((best, candidate) => (best === null || candidate.period.end > best.period.end ? candidate : best), null);
    if (newest === null) return null;
    const quarters = new Map(reported.map(({ period: { fiscal_year, fiscal_period } }) => [quarterId({ fiscal_year, fiscal_period }), { fiscal_year, fiscal_period }]));
    companies.push({ newest: quarters.get(quarterId(newest.period))!, quarters: [...quarters.values()], agreedDates: agreedDates(reported) });
  }
  return companies;
}

function agreedDates(reported: ReadonlyArray<InputCandidate>): RevenueQuarters["agreedDates"] {
  const dates = new Map<string, Set<string>>();
  for (const { period } of reported) dates.set(quarterId(period), (dates.get(quarterId(period)) ?? new Set()).add(JSON.stringify([period.start, period.end])));
  return (quarter) => {
    const [only, ...others] = dates.get(quarterId(quarter)) ?? [];
    if (only === undefined) return "unreported";
    if (others.length > 0) return "conflicting";
    const [start, end] = JSON.parse(only) as [string | null, string];
    return { start, end };
  };
}

// Some filings date a quarter's start a few days late (#479).
const FOLLOWS_WITHIN_DAYS = 7;

/**
 * Why the change from `span` quarters before `at` to `at` is not planned, or
 * null when it is: every quarter between them starts just after the one
 * before it ends. An end never reported is planned all the same, as the
 * engine cannot compute it: the change is a gap where it falls.
 */
function unpaired(company: Anchored, at: FiscalQuarter, span: number): string | null {
  const chain = Array.from({ length: span + 1 }, (_, back) => before(at, back));
  if (company.agreedDates(at) === "unreported" || company.agreedDates(chain[span]!) === "unreported") return null;
  const dates: Dates[] = [];
  for (const quarter of chain) {
    const agreed = company.agreedDates(quarter);
    if (agreed === "unreported") return `as ${quarterText(quarter)} has no reported revenue`;
    if (agreed === "conflicting") return `as its filings date ${quarterText(quarter)} differently`;
    dates.push(agreed);
  }
  const follows = dates.slice(1).every((prior, step) => {
    const start = dates[step]!.start;
    const gap = start === null ? 0 : dayNumber(start) - dayNumber(prior.end);
    return gap >= 1 && gap <= FOLLOWS_WITHIN_DAYS;
  });
  return follows ? null : "whose quarters are not dated consecutively";
}

// The quarter `back` quarters before (1 = the previous one, 4 = a year earlier).
function before(quarter: FiscalQuarter, back: number): FiscalQuarter {
  const total = quarter.fiscal_year * 4 + QUARTERS.indexOf(quarter.fiscal_period) - back;
  return { fiscal_year: Math.floor(total / 4), fiscal_period: QUARTERS[total % 4]! };
}
const quarterId = (quarter: FiscalQuarter) => `fy${quarter.fiscal_year}_${quarter.fiscal_period.toLowerCase()}`;
const quarterText = (quarter: FiscalQuarter) => `${quarter.fiscal_period} FY${quarter.fiscal_year}`;

function reportedAt(slot: string, id: (name: string) => string) {
  return (metric: string, period: FiscalQuarter): Node =>
    ({ node_id: id(`${metric}_${quarterId(period)}`), operation: "reported_metric", subject_slot: slot, metric_key: metric, period: { kind: "fiscal_period", ...period } });
}

// The company's quarter ending closest to `target`, when the two cover mostly the same months.
function closestQuarter(company: Anchored, target: Dates): FiscalQuarter | null {
  const apart = (dates: Dates) => Math.abs(dayNumber(dates.end) - dayNumber(target.end));
  const [closest] = company.quarters
    .flatMap((quarter) => {
      const dates = company.agreedDates(quarter);
      return typeof dates === "string" || dates.start === null ? [] : [{ quarter, dates }];
    })
    .sort((left, right) => apart(left.dates) - apart(right.dates) || right.dates.end.localeCompare(left.dates.end));
  return closest !== undefined && coverSameMonths(target, closest.dates) ? closest.quarter : null;
}

function growthChanges(backs: ReadonlyArray<number>, anchor: FiscalQuarter) {
  return [
    ...backs.filter((back) => backs.includes(back + 1)).reverse().map((back) => ({ back, span: 1, name: back === 0 ? GROWTH[0].metric : `${GROWTH[0].metric}_${quarterId(before(anchor, back))}` })),
    { back: 0, span: GROWTH[1].back, name: GROWTH[1].metric },
  ];
}

function companyOverviewDraft(companies: ReadonlyArray<Anchored>) {
  const several = companies.length > 1;
  const backs = several ? [0, ...GROWTH.map(({ back }) => back)] : Array.from({ length: QUARTERS_SHOWN }, (_, back) => back);
  const omitted: Omission[] = [];
  const parts = companies.map((company, index) => {
    const slot = slotOf(index);
    const id = nodeIdOf(several, slot);
    const at = reportedAt(slot, id);
    const revenue = new Map(backs.map((back) => [back, at("revenue", before(company.anchor, back))]));
    const latest = revenue.get(0)!;
    const lines = MARGINS.map(({ numerator }) => at(numerator, company.anchor));
    const margins = MARGINS.map(({ metric }, line): Node => ({ node_id: id(metric), operation: metric, numerator: lines[line]!.node_id, revenue: latest.node_id }));
    const growth = growthChanges(backs, company.anchor).flatMap(({ back, span, name }): Node[] => {
      const at = before(company.anchor, back);
      const why = unpaired(company, at, span);
      if (why === null) return [{ node_id: id(name), operation: "percent_change_positive_base", current: revenue.get(back)!.node_id, prior: revenue.get(back + span)!.node_id }];
      omitted.push((named) => `revenue growth from ${quarterText(before(at, span))} to ${quarterText(at)}${several ? ` for ${named(slot)}` : ""}, ${why}`);
      return [];
    });
    const charted = [...revenue.values()].reverse();
    const window = several ? [] : highAndLow("revenue", charted);
    return {
      slot,
      at,
      id,
      margins,
      operations: [...revenue.values(), ...lines, ...margins, ...growth, ...window],
      outputs: [...(several ? [latest] : charted), ...lines, ...margins, ...growth, ...window],
    };
  });
  const [primary, ...others] = parts;
  const shownAt = companies[0]!.anchor;
  const dates = companies[0]!.agreedDates(shownAt);
  const anchor = typeof dates === "string" || dates.start === null ? null : dates;
  const paired = others.flatMap((other, index): Array<{ slot: string; margins: ReadonlyArray<Node>; operations: ReadonlyArray<Node> }> => {
    const quarter = anchor && closestQuarter(companies[index + 1]!, anchor);
    if (quarter === null) {
      omitted.push((named) => `${named(primary!.slot)}'s lead over ${named(other.slot)} in each margin, as ${dates === "unreported"
        ? `${named(primary!.slot)} reported no revenue for its ${quarterText(shownAt)}`
        : anchor === null
        ? `the filings of ${named(primary!.slot)} do not agree on the dates of its ${quarterText(shownAt)}`
        : `no quarter ${named(other.slot)} reported ends within half a quarter of ${named(primary!.slot)}'s ${quarterText(shownAt)}`}`);
      return [];
    }
    if (quarterId(quarter) === quarterId(companies[index + 1]!.anchor)) return [{ slot: other.slot, margins: other.margins, operations: [] }];
    const revenue = other.at("revenue", quarter);
    const lines = MARGINS.map(({ numerator }) => other.at(numerator, quarter));
    const margins = MARGINS.map(({ metric }, line): Node => ({ node_id: other.id(`${metric}_${quarterId(quarter)}`), operation: metric, numerator: lines[line]!.node_id, revenue: revenue.node_id }));
    // Only the lead shows them: each company is shown at its own quarter.
    return [{ slot: other.slot, margins, operations: [revenue, ...lines, ...margins] }];
  });
  const leads = MARGINS.flatMap(({ metric }, line) => paired.map((other): Node => ({
    node_id: `${primary!.slot}_minus_${other.slot}_${metric}`,
    operation: "spread",
    left: primary!.margins[line]!.node_id,
    right: other.margins[line]!.node_id,
  })));
  // A company's closest quarter may be one its growth already reads.
  const operations = new Map([...parts.flatMap((part) => part.operations), ...paired.flatMap((other) => other.operations), ...leads].map((node) => [node.node_id, node]));
  return {
    operations: [...operations.values()],
    outputs: [...parts.flatMap((part) => part.outputs), ...leads],
    omitted,
  };
}

function marginTrendDraft(company: Anchored) {
  const at = reportedAt("a", (name) => name);
  const backs = Array.from({ length: QUARTERS_SHOWN }, (_, back) => QUARTERS_SHOWN - 1 - back);
  const revenue = backs.map((back) => at("revenue", before(company.anchor, back)));
  const lines = MARGINS.map(({ numerator }) => backs.map((back) => at(numerator, before(company.anchor, back))));
  const margins = MARGINS.map(({ metric }, line) => lines[line]!.map((numerator, index): Node => ({
    node_id: `${metric}_${quarterId(before(company.anchor, backs[index]!))}`,
    operation: metric,
    numerator: numerator.node_id,
    revenue: revenue[index]!.node_id,
  })));
  const windows = MARGINS.flatMap(({ metric }, line) => highAndLow(metric, margins[line]!));
  return { operations: [...revenue, ...lines.flat(), ...margins.flat(), ...windows], outputs: [...margins.flat(), ...windows] };
}

function highAndLow(name: string, members: ReadonlyArray<Node>): Node[] {
  return (["highest", "lowest"] as const).map((direction) => ({ node_id: `${name}_${direction}`, operation: "period_rank", members: members.map((member) => member.node_id), direction }));
}

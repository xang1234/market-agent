import { coverSameMonths, DEFAULT_EXECUTION_LIMITS, dayNumber, type FinancialPlanV1, type FinancialRuntimeAuthority, type FinancialSubjectRef } from "../../financial-core/src/index.ts";
import { isDatabaseError } from "../../financial-engine/src/evidence-adapter.ts";
import { buildDeterministicPlan, type PlanningContext, type PlanningResult, type RequestedSubject } from "../../financial-engine/src/planner.ts";
import type { FinancialEvidencePort, InputCandidate, SqlExecutor } from "../../financial-engine/src/ports.ts";
import { issuerLabels } from "../../financial-engine/src/request.ts";
import { reportedBy } from "../../financial-engine/src/select-inputs.ts";
import { createSqlPeerSetResolver } from "../../fundamentals/src/peer-set-resolver.ts";
import { MAX_TURN_SUBJECTS } from "./coordinator.ts";
import { FISCAL_PERIODS, QUARTERS_SHOWN, type FiscalQuarter } from "./research-scope.ts";
import type { ReadPeriod } from "./scope-figures.ts";

export const MARGINS = [
  { metric: "gross_margin", numerator: "gross_profit" },
  { metric: "operating_margin", numerator: "operating_income" },
  { metric: "net_margin", numerator: "net_income" },
] as const;
const GROWTH = [
  { metric: "revenue_growth_qoq", quartersBack: 1 },
  { metric: "revenue_growth_yoy", quartersBack: 4 },
] as const;
const UNPLANNED = "[chat] the company overview could not be planned; the planner answers";
const TREND_UNPLANNED = "[chat] the margin trend could not be planned; the planner answers";

type Node = Record<string, unknown> & { node_id: string };
export type PeersOf = (issuer: FinancialSubjectRef) => Promise<ReadonlyArray<RequestedSubject>>;
export type ReadyPlan = Extract<PlanningResult, { outcome: "ready" }>;

/** Whether every company a turn covers, named or carried, is resolved, as an overview needs. */
export function allResolved(subjects: ReadonlyArray<RequestedSubject>): boolean {
  return subjects.length > 0 && subjects.every((subject) => subject.resolution.status === "resolved");
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
// A revenue candidate for a fiscal quarter, not a fiscal year.
type Quarterly = InputCandidate & Readonly<{ period: InputCandidate["period"] & FiscalQuarter }>;
const quarterly = (candidate: InputCandidate): candidate is Quarterly => candidate.period.fiscal_period !== "FY";

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
export async function planCompanyOverview(context: PlanningContext, evidence: FinancialEvidencePort, period: ReadPeriod): Promise<ReadyPlan | null> {
  const companies = await planningQuarters(context, evidence, UNPLANNED, period);
  return companies && planned(context, companyOverviewDraft(companies), UNPLANNED);
}

/** One company's three margins over the quarters charted to its quarter at the period, each with its high and low. Null as for planCompanyOverview. */
export async function planMarginTrend(context: PlanningContext, evidence: FinancialEvidencePort, period: ReadPeriod): Promise<ReadyPlan | null> {
  const companies = await planningQuarters(context, evidence, TREND_UNPLANNED, period);
  return companies && planned(context, marginTrendDraft(companies[0]!), TREND_UNPLANNED);
}

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
    const period = line?.operation === "reported_metric" && line.period.kind === "fiscal_period" ? line.period : null;
    return period !== null && period.fiscal_period !== "FY" ? [{ ...company, anchor: { fiscal_year: period.fiscal_year, fiscal_period: period.fiscal_period } }] : [];
  });
  if (anchored.length !== companies.length) return [];
  const { operations, omitted } = companyOverviewDraft(anchored);
  return operations.length === saved.size && operations.every((node) => saved.has(node.node_id)) ? omitted.map((omission) => omission(name)) : [];
}

export const slotOf = (index: number) => String.fromCharCode(97 + index);
export const nodeIdOf = (several: boolean, slot: string) => (name: string) => several ? `${slot}_${name}` : name;

export function planned(context: PlanningContext, { operations, outputs }: { operations: ReadonlyArray<Node>; outputs: ReadonlyArray<Node> }, unplanned: string): ReadyPlan | null {
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

export async function planningQuarters(context: PlanningContext, evidence: FinancialEvidencePort, unplanned: string, period: ReadPeriod): Promise<Anchored[] | null> {
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
  const order = (quarter: FiscalQuarter) => quarter.fiscal_year * 4 + FISCAL_PERIODS.indexOf(quarter.fiscal_period);
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
    const reported = page.truncated ? [] : page.candidates.filter(quarterly).filter((candidate) => reportedBy(candidate, policy));
    const newest = reported.reduce<Quarterly | null>((best, candidate) => (best === null || candidate.period.end > best.period.end ? candidate : best), null);
    if (newest === null) return null;
    const quarters = new Map(reported.map(({ period: { fiscal_year, fiscal_period } }) => [quarterId({ fiscal_year, fiscal_period }), { fiscal_year, fiscal_period }]));
    companies.push({ newest: quarters.get(quarterId(newest.period))!, quarters: [...quarters.values()], agreedDates: agreedDates(reported) });
  }
  return companies;
}

function agreedDates(reported: ReadonlyArray<Quarterly>): RevenueQuarters["agreedDates"] {
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

function before(quarter: FiscalQuarter, quartersBack: number): FiscalQuarter {
  const total = quarter.fiscal_year * 4 + FISCAL_PERIODS.indexOf(quarter.fiscal_period) - quartersBack;
  return { fiscal_year: Math.floor(total / 4), fiscal_period: FISCAL_PERIODS[total % 4]! };
}
export const quarterId = (quarter: Readonly<{ fiscal_year: number; fiscal_period: string }>) => `fy${quarter.fiscal_year}_${quarter.fiscal_period.toLowerCase()}`;
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
    { back: 0, span: GROWTH[1].quartersBack, name: GROWTH[1].metric },
  ];
}

function companyOverviewDraft(companies: ReadonlyArray<Anchored>) {
  const several = companies.length > 1;
  const backs = several ? [0, ...GROWTH.map(({ quartersBack }) => quartersBack)] : Array.from({ length: QUARTERS_SHOWN }, (_, back) => back);
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

// What a turn about a company is planned as (#398): the one choice its reading
// and resolved scope make, and the figures a follow-up keeps, at the period it
// reads.

import type { FinancialPlanV1, PeriodSelector } from "../../financial-core/src/index.ts";
import type { PlanningContext } from "../../financial-engine/src/planner.ts";
import type { FinancialEvidencePort } from "../../financial-engine/src/ports.ts";
import { MARGINS, nodeIdOf, planned, planningQuarters, quarterId, slotOf, type ReadyPlan } from "./company-overview.ts";
import { BALANCE_SHEET_ITEMS, readingAsks, type FiscalQuarter, type PERIOD_FIELDS, type PeriodType, type ResearchScope, type ScopeFacet, type ScopeProposal } from "./research-scope.ts";

/**
 * The period a turn's figures are read at: the latest, of the type its scope
 * records, if any; a fiscal year; or a fiscal quarter, which with no year
 * named is each company's newest such quarter.
 */
export type ReadPeriod =
  | Readonly<{ kind: "latest"; period: PeriodType | null }>
  | Readonly<{ kind: "fiscal_year"; fiscal_year: number }>
  | Readonly<{ kind: "fiscal_quarter"; fiscal_period: string; fiscal_year: number | null }>;

export const LATEST: ReadPeriod = { kind: "latest", period: null };

/** How a turn about a company is answered: by the analyst path, or by the engine with one plan. */
export type PlanChoice =
  | Readonly<{ kind: "analyst" }>
  | Readonly<{ kind: "segments_gap" }>
  | Readonly<{ kind: "trend"; period: ReadPeriod }>
  | Readonly<{ kind: "overview"; period: ReadPeriod; peers: boolean }>
  | Readonly<{ kind: "kept_figures"; metrics: ReadonlyArray<string>; period: ReadPeriod }>
  | Readonly<{ kind: "planner" }>;

const PLANNER: PlanChoice = { kind: "planner" };
const INCOME_STATEMENT = "income_statement";

// The lane each facet asks for, when a question names no metric: a figure
// the engine shows, something only the analyst path answers (the previous
// answer's evidence, guidance from claims, market data per #398 D2), or neither.
const FACET_LANE: Readonly<Record<ScopeFacet, "figure" | "analyst" | "neutral">> = {
  peers: "neutral",
  segments: "figure",
  margins: "figure",
  margin_trend: "figure",
  price_window: "analyst",
  benchmark: "analyst",
  guidance: "analyst",
  explains: "neutral",
  evidence: "analyst",
  latest_quarter: "neutral",
};
const OVERVIEW_ASKS: ReadonlySet<ScopeFacet> = new Set(["latest_quarter", "peers", "explains"]);
const OVERVIEW_SHOWS: ReadonlySet<ScopeFacet | (typeof PERIOD_FIELDS)[number]> = new Set(["latest_quarter", "margins", "margin_trend"]);
const KEPT_ASKS: ReadonlySet<ScopeFacet> = new Set(["explains", "latest_quarter"]);
const TREND_ASKS: ReadonlySet<ScopeFacet> = new Set(["margin_trend", "margins", "explains"]);
const MARGIN_ITEMS: ReadonlySet<string> = new Set(MARGINS.map(({ metric }) => metric));
const READ_PERIODS: ReadonlySet<ScopeProposal["period"]["kind"]> = new Set(["none", "latest", "fiscal_year", "fiscal_quarter"]);

/**
 * The one plan a turn about a company gets. The analyst path keeps a turn that
 * asks for no figure but something only it answers; a follow-up naming no
 * company of its own whose scope keeps guidance, or keeps market data and
 * that names no period; and a follow-up that names no company and no period,
 * turns nothing off and asks only for a cause. A turn
 * asking for segments is the engine's segment gap. Otherwise, with a scope:
 * one company's margin trend, the companies' overview, or the figures a
 * follow-up keeps beside the income statement; anything else is the planner's.
 */
export function routeTurn(reading: ScopeProposal | null, scope: ResearchScope | null): PlanChoice {
  if (reading === null) return PLANNER;
  const { asks, offFacets, offMetrics } = readingAsks(reading);
  const namesFigure = reading.metrics.some((metric) => !offMetrics.has(metric.metric_key)) || reading.income_items.length > 0;
  const own = reading.companies.kind === "as_named" && reading.companies.names.length > 0;
  const lanes = new Set([...asks].map((facet) => FACET_LANE[facet]));
  const followUp = namedCompanies(reading.companies) === 0;
  const onlyExplains = followUp && offFacets.size === 0 && offMetrics.size === 0 && [...asks].every((facet) => facet === "explains");
  if (!namesFigure && !lanes.has("figure")) {
    const keptAnalyst = scope !== null && !own && (scope.guidance === true || (reading.period.kind === "none" && (scope.price_window !== null || scope.benchmark)));
    if (lanes.has("analyst") || keptAnalyst || (reading.period.kind === "none" && onlyExplains)) return { kind: "analyst" };
  }
  if (asks.has("segments")) return { kind: "segments_gap" };
  if (scope === null || !READ_PERIODS.has(reading.period.kind)) return PLANNER;
  const period = readPeriod(scope);
  const kept = scope.inherited.includes("metrics") ? scope.metrics.map((metric) => metric.metric_key) : [];
  const keptIncome = kept.every((key) => key === INCOME_STATEMENT);
  const asksNoFigure = READ_PERIODS.has(reading.period.kind) && reading.metrics.length === 0 && reading.income_items.length === 0;
  const overview = asksNoFigure && offMetrics.size === 0 && ![...offFacets].some((facet) => OVERVIEW_SHOWS.has(facet)) && [...asks].every((facet) => OVERVIEW_ASKS.has(facet));
  const oneCompany = scope.companies.length === 1;
  const askedTrend = (reading.period.kind === "none" || reading.period.kind === "latest") && asks.has("margin_trend") &&
    [...asks].every((facet) => TREND_ASKS.has(facet)) && offMetrics.size === 0 &&
    reading.metrics.every((metric) => metric.metric_key === INCOME_STATEMENT) && reading.income_items.every((item) => MARGIN_ITEMS.has(item));
  const keptTrend = (reading.period.kind === "fiscal_year" || reading.period.kind === "fiscal_quarter") && overview && scope.margin_trend && keptIncome;
  if (oneCompany && (askedTrend || keptTrend)) return { kind: "trend", period };
  if (overview && keptIncome) return { kind: "overview", period, peers: asks.has("peers") };
  if (asksNoFigure && [...asks].every((facet) => KEPT_ASKS.has(facet)) && !keptIncome) return { kind: "kept_figures", metrics: kept, period };
  return PLANNER;
}

// The companies a reading's change names, whatever it does with them.
function namedCompanies(change: ScopeProposal["companies"]): number {
  switch (change.kind) {
    case "compare":
      return change.add.length;
    case "drop":
      return change.drop.length + change.add.length;
    default:
      return change.names.length;
  }
}

type ScopePeriod = Pick<ResearchScope, "fiscal_year" | "fiscal_quarter" | "latest_period">;

/** The period a resolved scope reads its figures at: its quarter, else its fiscal year, else the latest. */
export function readPeriod(scope: ScopePeriod): ReadPeriod {
  if (scope.fiscal_quarter !== null) return { kind: "fiscal_quarter", ...scope.fiscal_quarter };
  return scope.fiscal_year === null ? { kind: "latest", period: scope.latest_period ?? null } : { kind: "fiscal_year", fiscal_year: scope.fiscal_year };
}

/** A plan's period type: the one every reported figure in it is of, or null. */
export function planPeriod(plan: FinancialPlanV1): PeriodType | null {
  const types = new Set(plan.operations.flatMap((node): PeriodType[] => {
    if (node.operation !== "reported_metric" || node.period.kind === "at_cutoff") return [];
    const annual = node.period.kind === "latest" ? node.period.period_type === "annual" : node.period.fiscal_period === "FY";
    return [annual ? "fiscal_year" : "quarter"];
  }));
  return types.size === 1 ? [...types][0]! : null;
}

/** What an answer's note says when its figures are of another period type than the one its turn read; null when they are not. */
export function periodNote(scope: ScopePeriod, shown: PeriodType | null): string | null {
  const read = readPeriod(scope);
  const readType = read.kind === "latest" ? read.period : read.kind === "fiscal_year" ? "fiscal_year" : "quarter";
  if (shown === null || readType === null || shown === readType) return null;
  if (shown === "quarter") {
    return read.kind === "fiscal_year"
      ? `Fiscal ${read.fiscal_year} is shown by quarter, to the newest quarter reported in it.`
      : "These figures are quarterly, where the previous answer's were for the latest fiscal year.";
  }
  if (read.kind !== "fiscal_quarter") return "These figures are for the latest fiscal year, not the latest quarter.";
  return `These figures are for a fiscal year, not ${read.fiscal_year === null ? `each company's newest ${read.fiscal_period}` : `${read.fiscal_period} FY${read.fiscal_year}`}.`;
}

// A figure computed from reported metrics of one period, each input by its role.
type Computed = Readonly<{ operation: string; inputs: Readonly<Record<string, string>> }>;

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

type Node = Record<string, unknown> & { node_id: string };
const FIGURES_UNPLANNED = "[chat] the follow-up's figures could not be planned; the planner answers";

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
    const suffix = selector.kind === "fiscal_period" ? quarterId(selector) : selector.kind === "latest" && selector.period_type === "quarterly" ? "latest_q" : "latest_fy";
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
      return each({ kind: "latest", period_type: period.period === "quarter" ? "quarterly" : "annual", offset: 0 });
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

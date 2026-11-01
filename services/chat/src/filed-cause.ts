// The cause a company filed for the figures an engine answer shows (#542):
// management's own explanations (management.explanation.*, verbatim from its
// earnings release) bound to the fiscal period of those figures. What a cause
// would explain comes from the plan and the periods its inputs bound to, never
// from the question's words or a date window.

import { dependencyClosure, type FinancialPlanV1, type LocalId, type OperationNode } from "../../financial-core/src/index.ts";
import type { ClaimPeriod } from "../../evidence/src/claim-repo.ts";
import { INCOME_ITEM_FIGURE, SCOPE_METRICS } from "./scope-figures.ts";
import { readingAsks, type ResearchScope, type ScopeProposal } from "./research-scope.ts";

/** Per company: the figures a filed cause would explain and the one period they end at, or none. */
export type Explained = Readonly<{ issuer: string } & ({ kind: "none" } | { kind: "figures"; period: ClaimPeriod; metrics: ReadonlyArray<string> })>;

// Each figure a release explains, by the release metric of its own
// explanations (sec-earnings-release-extraction.ts RELEASE_METRICS). A release
// explains a margin by the income it divides, and files gross profit as gross
// margin. A figure not listed (a balance item, a share count, a valuation, a
// ratio other than a margin) has no filed cause.
const OWN_EXPLANATION: Readonly<Record<string, string>> = {
  revenue: "revenue",
  gross_profit: "gross_margin",
  gross_margin: "gross_margin",
  operating_income: "operating_income",
  operating_margin: "operating_income",
  net_income: "net_income",
  net_margin: "net_income",
  operating_cash_flow: "operating_cash_flow",
  capex: "capex",
  free_cash_flow: "free_cash_flow",
  eps_basic: "eps",
  eps_diluted: "eps",
};
const MARGINS: ReadonlySet<string> = new Set(["gross_margin", "operating_margin", "net_margin"]);
// What a release metric is computed from, beyond a margin's revenue.
const COMPUTED_FROM: Readonly<Record<string, ReadonlyArray<string>>> = {
  operating_income: ["gross_margin", "operating_expenses"],
  free_cash_flow: ["operating_cash_flow", "capex"],
};
// Outputs no one period's explanation covers.
const OPAQUE: ReadonlySet<OperationNode["operation"]> = new Set(["trailing_sum", "threshold", "peer_compare", "spread", "period_rank"]);

type Shown =
  | Readonly<{ kind: "ignored" }>
  | Readonly<{ kind: "opaque"; slots: ReadonlySet<LocalId> }>
  | Readonly<{ kind: "figure"; slot: LocalId; figure: string; period: ClaimPeriod }>;

/**
 * What a filed cause explains for each company: the figures it shows at the
 * period with the latest end, which `named` accepts. Its earlier figures must
 * be the trend of one shown there. A company with an output no one period
 * explains, with two periods ending that day (a Q4 beside its fiscal year), or
 * with an earlier figure not shown at the latest, has none.
 */
export function explainedFigures(input: Readonly<{
  plan: FinancialPlanV1;
  // The outputs the answer shows a verified value for.
  verified: ReadonlySet<LocalId>;
  // Each reported node's bound fiscal period; an instant or a price has none.
  periods: ReadonlyMap<LocalId, ClaimPeriod>;
  named: (figure: string) => boolean;
}>): Explained[] {
  const { plan, periods } = input;
  const nodes = new Map(plan.operations.map((node) => [node.node_id, node]));
  const reported = (node: OperationNode) =>
    [...dependencyClosure(plan, [node.node_id])].map((id) => nodes.get(id)!).flatMap((input) => input.operation === "reported_metric" ? [input] : []);
  const IGNORED: Shown = { kind: "ignored" };
  const opaque = (node: OperationNode): Shown => ({ kind: "opaque", slots: new Set(reported(node).map((input) => input.subject_slot)) });
  const shown = (node: OperationNode): Shown => {
    if (OPAQUE.has(node.operation)) return opaque(node);
    if (node.operation === "absolute_change" || node.operation === "percent_change_positive_base") {
      const [current, prior] = [shown(nodes.get(node.current)!), shown(nodes.get(node.prior)!)];
      if (current.kind === "ignored" && prior.kind === "ignored") return IGNORED;
      const same = current.kind === "figure" && prior.kind === "figure" && current.figure === prior.figure && current.slot === prior.slot;
      return same ? current : opaque(node);
    }
    const figure = node.operation === "reported_metric" ? node.metric_key : node.operation;
    if (!Object.hasOwn(OWN_EXPLANATION, figure)) return IGNORED;
    const inputs = reported(node);
    const bound = inputs.map((input) => periods.get(input.node_id));
    const [first] = bound;
    const onePeriod = first !== undefined && bound.every((period) => period !== undefined && samePeriod(period, first));
    const slots = new Set(inputs.map((input) => input.subject_slot));
    return onePeriod && slots.size === 1 ? { kind: "figure", slot: inputs[0]!.subject_slot, figure, period: first } : opaque(node);
  };
  const outputs = plan.outputs.filter((output) => input.verified.has(output.output_id)).map((output) => shown(nodes.get(output.node_id)!));
  return plan.subjects.members.map((member): Explained => {
    const issuer = member.subject_ref.id.toLowerCase();
    const none: Explained = { issuer, kind: "none" };
    const own = outputs.filter((output) => output.kind === "opaque" ? output.slots.has(member.slot_id) : output.kind === "figure" && output.slot === member.slot_id);
    const figures = own.flatMap((output) => output.kind === "figure" ? [output] : []);
    if (figures.length === 0 || figures.length < own.length) return none;
    const end = figures.reduce((latest, { period }) => (period.end > latest ? period.end : latest), "");
    const latest = figures.filter(({ period }) => period.end === end);
    const period = latest[0]!.period;
    if (latest.some((figure) => figure.period.kind !== period.kind)) return none;
    const atLatest = new Set(latest.map(({ figure }) => figure));
    if (figures.some(({ figure }) => !atLatest.has(figure))) return none;
    const metrics = [...atLatest].filter(input.named);
    return metrics.length === 0 ? none : { issuer, kind: "figures", period, metrics };
  });
}

const samePeriod = (left: ClaimPeriod, right: ClaimPeriod) => left.kind === right.kind && left.end === right.end;

/**
 * The predicate prefixes of the explanations that are a cause of these
 * figures, in priority tiers: their own, then what they are computed from,
 * nearest first, and a margin's revenue last, so revenue's explanations never
 * crowd out its income's. Revenue is computed from nothing here: a gross
 * margin's explanation is no cause of it, and "other" is no cause of any.
 */
export function causeFamilies(metrics: ReadonlyArray<string>): string[][] {
  const tiers: string[][] = [];
  const seen = new Set<string>();
  let next = metrics.map((metric) => OWN_EXPLANATION[metric]!);
  while (next.length > 0) {
    const tier = [...new Set(next)].filter((metric) => !seen.has(metric));
    tier.forEach((metric) => seen.add(metric));
    if (tier.length > 0) tiers.push(tier);
    next = tier.flatMap((metric) => COMPUTED_FROM[metric] ?? []);
  }
  if (metrics.some((metric) => MARGINS.has(metric)) && !seen.has("revenue")) tiers.push(["revenue"]);
  return tiers.map((tier) => tier.map((metric) => `management.explanation.${metric}`));
}

/** Whether a turn asks for a cause: its scope keeps one (asked now or carried, until turned off), else its reading asks. */
export function asksCause(reading: ScopeProposal, scope: Pick<ResearchScope, "explains"> | null): boolean {
  return scope === null ? readingAsks(reading).asks.has("explains") : scope.explains === true;
}

/**
 * The engine figures this turn's reading names: its income items, which name
 * them more closely than the whole statement, and each other metric's
 * figures. A reading that names none names every figure.
 */
export function namedFigures(reading: ScopeProposal): (figure: string) => boolean {
  const { offMetrics } = readingAsks(reading);
  const items = new Set(reading.income_items.map((item) => INCOME_ITEM_FIGURE[item]));
  const metrics = new Set(reading.metrics
    .filter((metric) => !offMetrics.has(metric.metric_key) && !(metric.metric_key === "income_statement" && reading.income_items.length > 0))
    .map((metric) => metric.base ?? metric.metric_key));
  if (items.size === 0 && metrics.size === 0) return () => true;
  return (figure) => items.has(figure) || metrics.has(SCOPE_METRICS[figure] ?? "");
}

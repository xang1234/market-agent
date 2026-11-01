import assert from "node:assert/strict";
import test from "node:test";

import { createRuntimeAuthority, dependencyClosure, type FinancialPlanV1, type LocalId, type PeriodSelector } from "../../financial-core/src/index.ts";
import type { ClaimPeriod } from "../../evidence/src/claim-repo.ts";
import { buildDeterministicPlan, type PlanningResult } from "../../financial-engine/src/planner.ts";
import { asksCause, causeFamilies, explainedFigures, namedFigures } from "../src/filed-cause.ts";
import { parseProposal } from "../src/scope-proposal.ts";
import { GOLDEN_AS_OF, GOLDEN_COMPANIES } from "./golden/dataset.ts";

const [NVDA, AMD] = ["NVDA", "AMD"].map((ticker) => GOLDEN_COMPANIES.find((company) => company.ticker === ticker)!);
const SLOTS: Readonly<Record<string, typeof AMD>> = { a: AMD!, b: NVDA! };

type Node = Record<string, unknown> & { node_id: string };
const at = (fiscal_year: number, fiscal_period: string) => ({ kind: "fiscal_period", fiscal_year, fiscal_period });
const reported = (node_id: string, metric_key: string, period: object, subject_slot = "a"): Node => ({ node_id, operation: "reported_metric", subject_slot, metric_key, period });
const margin = (name: string, period: object, slot = "a"): Node[] => [
  reported(`oi_${name}`, "operating_income", period, slot),
  reported(`rev_${name}`, "revenue", period, slot),
  { node_id: `om_${name}`, operation: "operating_margin", numerator: `oi_${name}`, revenue: `rev_${name}` },
];
const revenue = (name: string, period: object, slot = "a"): Node[] => [reported(`rev_${name}`, "revenue", period, slot)];

// A plan of these figures, each the output of its last node, as the
// deterministic planner assembles it for the companies its slots name.
function plan(figures: ReadonlyArray<ReadonlyArray<Node>>, slots = ["a"]): FinancialPlanV1 {
  const authority = createRuntimeAuthority({
    owner_user_id: "10000000-0000-4000-8000-000000000001",
    egress_channel: "chat",
    parent: { kind: "chat_thread", id: "65000000-0000-4000-8000-0000000000e1", version: "turn:filed-cause" },
    allowed_source_classes: ["sec_filing"],
    feature: { surface: "chat", capability: "financial-answer", mode: "enforce" },
    approval_state: "not_required",
    lease: null,
  });
  const planned = buildDeterministicPlan({
    plan_id: "65000000-0000-4000-8000-0000000000e2",
    origin: { kind: "chat_request", ref: "chat:filed-cause" },
    knowledge_cutoff: GOLDEN_AS_OF,
    cutoff_timezone: "UTC",
    reporting_basis: "as_reported",
    freshness_max_age_days: null,
    authority,
    parent_limits: {},
    max_model_calls: 0,
    requested_subjects: slots.map((slot) => ({ mention: SLOTS[slot]!.ticker, resolution: { status: "resolved", subject_ref: { kind: "issuer", id: SLOTS[slot]!.issuer_id }, label: SLOTS[slot]!.legal_name } })),
    publication_unit_kind: "chat_section",
  }, {
    subjects: slots.map((slot_id) => ({ slot_id, mention: SLOTS[slot_id]!.ticker })),
    operations: [...new Map(figures.flat().map((node) => [node.node_id, node])).values()],
    outputs: figures.map((nodes) => ({ output_id: `out_${nodes.at(-1)!.node_id}`, node_id: nodes.at(-1)!.node_id })),
    thresholds: [],
  });
  assert.equal(planned.outcome, "ready", JSON.stringify(planned));
  return (planned as Extract<PlanningResult, { outcome: "ready" }>).plan;
}

// Each reported node bound as the golden facts date its company's period; a
// latest selector binds to `latest`.
function bound(planned: FinancialPlanV1, latest?: ClaimPeriod): Map<LocalId, ClaimPeriod> {
  const periodOf = (slot: string, selector: PeriodSelector): ClaimPeriod => {
    if (selector.kind !== "fiscal_period") return latest!;
    const company = SLOTS[slot]!;
    if (selector.fiscal_period === "FY") return { kind: "fiscal_y", end: company.years.find(([year]) => year === selector.fiscal_year)![2] };
    return { kind: "fiscal_q", end: company.quarters.find((quarter) => quarter.fiscal_year === selector.fiscal_year && quarter.fiscal_period === selector.fiscal_period)!.period_end };
  };
  return new Map(planned.operations.flatMap((node) => node.operation === "reported_metric" ? [[node.node_id, periodOf(node.subject_slot, node.period)] as const] : []));
}

const reading = (metrics: string[], income_items: string[]) =>
  parseProposal(JSON.stringify({ metrics, asks: ["explains"], turns_off: { facets: [], metrics: [] }, income_items, period: { kind: "none" }, companies: { kind: "as_named", names: [] } }), "")!;
const EVERY_FIGURE = () => true;

// A gap's reported node binds no period, and no output that reads it is verified.
function explained(planned: FinancialPlanV1, options: { latest?: ClaimPeriod; named?: (figure: string) => boolean; gaps?: ReadonlyArray<LocalId> } = {}) {
  const gaps = new Set(options.gaps ?? []);
  const readsGap = (nodeId: LocalId) => [...dependencyClosure(planned, [nodeId])].some((id) => gaps.has(id));
  return explainedFigures({
    plan: planned,
    verified: new Set(planned.outputs.flatMap((output) => readsGap(output.node_id) ? [] : [output.output_id])),
    periods: new Map([...bound(planned, options.latest)].filter(([id]) => !gaps.has(id))),
    named: options.named ?? EVERY_FIGURE,
  });
}

const Q2_2025: ClaimPeriod = { kind: "fiscal_q", end: "2025-06-28" };
const figures = (metrics: string[], period = Q2_2025, issuer = AMD!.issuer_id) => ({ issuer, kind: "figures", period, metrics });
const none = (issuer = AMD!.issuer_id) => ({ issuer, kind: "none" });

test("a filed cause explains the figures each company shows at its one latest period, and their trend to it (#542)", () => {
  const change = [
    ...revenue("q2", at(2025, "Q2")),
    ...revenue("q1", at(2025, "Q1")),
    { node_id: "rev_change", operation: "percent_change_positive_base", current: "rev_q2", prior: "rev_q1" },
  ];
  const trailing = [
    ...["Q3", "Q4"].map((quarter) => revenue(quarter.toLowerCase(), at(2024, quarter))).flat(),
    ...["Q1", "Q2"].map((quarter) => revenue(quarter.toLowerCase(), at(2025, quarter))).flat(),
    { node_id: "rev_ttm", operation: "trailing_sum", quarters: ["rev_q3", "rev_q4", "rev_q1", "rev_q2"] },
  ];
  const rows: ReadonlyArray<readonly [string, ReturnType<typeof explained>, ReadonlyArray<object>]> = [
    ["a point", explained(plan([margin("q2", at(2025, "Q2"))])), [figures(["operating_margin"])]],
    ["a change, at its current period", explained(plan([change])), [figures(["revenue"])]],
    ["a trend ending at Q2", explained(plan([margin("q1", at(2025, "Q1")), margin("q2", at(2025, "Q2"))])), [figures(["operating_margin"])]],
    ["a fiscal year", explained(plan([margin("fy", at(2025, "FY"))])), [figures(["operating_margin"], { kind: "fiscal_y", end: "2025-12-27" })]],
    ["Q4 beside its fiscal year, which end the same day", explained(plan([margin("q4", at(2025, "Q4")), margin("fy", at(2025, "FY"))])), [none()]],
    ["a trailing sum", explained(plan([trailing])), [none()]],
    ["a Q1 margin beside Q2 revenue", explained(plan([margin("q1", at(2025, "Q1")), revenue("q2", at(2025, "Q2"))])), [none()]],
    [
      "Q2 a gap beside the Q1 it is compared with: Q1's cause explains no figure shown for Q2",
      explained(plan([revenue("q2", at(2025, "Q2")), revenue("q1", at(2025, "Q1")), change]), { gaps: ["rev_q2"] }),
      [none()],
    ],
    [
      "a gap of a figure no cause explains leaves the others explained",
      explained(plan([revenue("q2", at(2025, "Q2")), [reported("assets", "total_assets", at(2025, "Q2"))]]), { gaps: ["assets"] }),
      [figures(["revenue"])],
    ],
    [
      "a latest plan bound to Q2",
      explained(plan([margin("latest", { kind: "latest", period_type: "quarterly", offset: 0 })]), { latest: Q2_2025 }),
      [figures(["operating_margin"])],
    ],
    [
      "an inherited margin trend followed by a revenue question",
      explained(plan([margin("q1", at(2025, "Q1")), margin("q2", at(2025, "Q2")), revenue("q2", at(2025, "Q2"))]), { named: namedFigures(reading(["income_statement"], ["revenue"])) }),
      [figures(["revenue"])],
    ],
    [
      "each company at its own latest period",
      explained(plan([margin("a", at(2025, "Q2")), margin("b", at(2026, "Q1"), "b")], ["a", "b"])),
      [figures(["operating_margin"]), figures(["operating_margin"], { kind: "fiscal_q", end: "2025-04-27" }, NVDA!.issuer_id)],
    ],
  ];
  for (const [name, actual, expected] of rows) assert.deepEqual(actual, expected, name);
});

test("a reading narrows the figures a cause explains, and one naming none narrows nothing (#542)", () => {
  const shown = plan([margin("q2", at(2025, "Q2")), revenue("q2", at(2025, "Q2"))]);
  assert.deepEqual(explained(shown, { named: namedFigures(reading(["income_statement"], ["operating_margin"])) }), [figures(["operating_margin"])]);
  assert.deepEqual(explained(shown, { named: namedFigures(reading(["income_statement"], [])) }), [figures(["operating_margin", "revenue"])]);
  assert.deepEqual(explained(shown, { named: namedFigures(reading([], [])) }), [figures(["operating_margin", "revenue"])]);
  assert.deepEqual(explained(shown, { named: namedFigures(reading(["income_statement"], ["net_margin"])) }), [none()], "a figure the answer does not show adds nothing");
});

test("a figure's cause families are its own explanations, then what it is computed from, nearest first, a margin's revenue last (#542)", () => {
  const families = (metrics: string[]) => causeFamilies(metrics).map((tier) => tier.map((prefix) => prefix.replace("management.explanation.", "")));
  assert.deepEqual(families(["operating_margin"]), [["operating_income"], ["gross_margin", "operating_expenses"], ["revenue"]]);
  assert.deepEqual(families(["gross_margin"]), [["gross_margin"], ["revenue"]]);
  assert.deepEqual(families(["revenue"]), [["revenue"]]);
  assert.deepEqual(families(["free_cash_flow"]), [["free_cash_flow"], ["operating_cash_flow", "capex"]]);
  assert.deepEqual(families(["revenue", "operating_margin"]), [["revenue", "operating_income"], ["gross_margin", "operating_expenses"]]);
  assert.deepEqual(causeFamilies(["revenue"]), [["management.explanation.revenue"]]);
});

test("a cause is asked when the turn's scope keeps one, or with no scope when its reading asks (#542)", () => {
  const why = reading([], []);
  const what = parseProposal(JSON.stringify({ metrics: [], asks: [], turns_off: { facets: [], metrics: [] }, income_items: [], period: { kind: "none" }, companies: { kind: "as_named", names: [] } }), "")!;
  assert.deepEqual([asksCause(why, null), asksCause(what, null), asksCause(what, { explains: true }), asksCause(why, {})], [true, false, true, false]);
});

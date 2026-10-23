// Held-out research traps (#221): fixed cases on the frozen golden dataset, each
// declaring what the turn must establish (companies, period or window, blocks or
// a named gap, the ambiguity rule) and a known-good recorded answer whose
// assertion list passes. Each mutation keeps the known-good answer but changes
// one thing, and must fail one named check (a rejection's check, assertions.ts)
// or never reach the page. No model, provider or credential is involved: replies
// are recorded.
//
// A question that names a metric reaches the financial engine, never the
// analyst (financial-runtime.ts): its case records the planner's reply, and
// declares the certified results, the note naming what the plan does not
// cover, or the gap the user sees.
//
// Expected values are written from the golden dataset (test/golden/dataset.ts)
// by hand, not derived from the code under test. The suite is versioned: the
// digest of these cases is pinned in holdout.integration.test.ts, so a change
// to a case is a deliberate new version, never a quiet edit.
//
// Packet ids follow the order figures are shown (evidence-packet.ts): an
// analyst turn's are its year-to-date chart's returns, one per company in the
// order compared (#398 D2); an engine answer's are its results, in the
// answer's order (enginePacket).

import type { RejectionCheck } from "../../src/assertions.ts";

export const HOLDOUT_VERSION = 18;

type Assertion = Record<string, unknown>;

export type HoldoutCase = {
  id: string;
  // The trap the case sets.
  trap: string;
  // The questions in order; the last is the one checked.
  turns: ReadonlyArray<string>;
  // The scope model's recorded reply for each turn, in order (scope-proposal.ts).
  scopes: ReadonlyArray<ScopeReply>;
  // The planner's recorded reply for a checked turn that names a metric.
  plan?: Readonly<Record<string, unknown>>;
  expect: {
    // The companies the checked turn covers, primary first (research scope).
    companies: ReadonlyArray<string>;
    route?: string;
    fiscal_year?: number | null;
    // A YTD window the scope keeps, as the chart draws it.
    ytd_range?: string;
    // Blocks that must be shown, by kind and title.
    blocks?: ReadonlyArray<{ kind: string; title?: string }>;
    // Kinds that must not be shown (a gap shows none of them).
    absent_kinds?: ReadonlyArray<string>;
    // A named gap the answer must state.
    gap?: string;
    // A value the answer must show, in a block's items.
    shows?: { block_title: string; label: string; format: string };
    // The turn asks instead of answering, binding no company.
    clarification?: boolean;
    financial?: ReadonlyArray<readonly [company: string, measure: string, period: string, disposition: string, text: string]>;
    // The note naming what the plan does not cover.
    uncovered?: string;
    // The engine's gap for a request it cannot plan: its reason code.
    financial_gap?: string;
  };
  // The recorded answer for the checked turn: prose and, optionally, its
  // assertion list, which must pass in full. The judge's recorded reply finds
  // each inference entailed unless a mutation records another verdict.
  prose: string;
  good?: ReadonlyArray<Assertion>;
  mutations?: ReadonlyArray<
    | { name: string; list: ReadonlyArray<Assertion>; judged?: Readonly<Record<number, "contradicted">>; fails: { index: number; check: RejectionCheck } }
    // A prose mutation: a figure the data does not hold, which must never be shown.
    | { name: string; prose: string; never_shown: string }
    | { name: string; list: ReadonlyArray<Assertion>; never_shown: string }
  >;
};

type ScopeReply = {
  metrics: ReadonlyArray<{ metric: string; adjustment?: string | null; qualifier?: string | null }>;
  asks: ReadonlyArray<string>;
  turns_off: { facets: ReadonlyArray<string>; metrics: ReadonlyArray<{ metric: string }> };
  income_items: ReadonlyArray<string>;
  period: Readonly<Record<string, string | number | null>>;
  companies: Readonly<Record<string, string | ReadonlyArray<string>>>;
};

const obs = (text: string, evidence: string[]): Assertion => ({ kind: "observation", text, evidence });
const cmp = (op: string, result: unknown, evidence: string[], text = "x"): Assertion => ({ kind: "comparison", op, result, text, evidence });
const inference = (text: string, supports: number[]): Assertion => ({ kind: "analyst_inference", text, supports });

type Period = Readonly<Record<string, string | number>>;
const latest = (period_type: "annual" | "quarterly", offset = 0): Period => ({ kind: "latest", period_type, offset });
const fiscal = (fiscal_year: number, fiscal_period: string): Period => ({ kind: "fiscal_period", fiscal_year, fiscal_period });
const reported = (slot: string, node_id: string, metric_key: string, period: Period) => ({ node_id, operation: "reported_metric", subject_slot: slot, metric_key, period });
const margin = (operation: string, node_id: string, numerator: string, revenue: string) => ({ node_id, operation, numerator, revenue });
const draft = (mentions: string[], operations: ReadonlyArray<Record<string, unknown>>, outputs: string[]) => ({
  outcome: "ready",
  subjects: mentions.map((mention, index) => ({ slot_id: "abc"[index]!, mention })),
  operations,
  outputs: outputs.map((node_id) => ({ output_id: `out_${node_id}`, node_id })),
  thresholds: [],
});
const latestMargins = (slot: string) => [
  reported(slot, `${slot}_rev`, "revenue", latest("annual")),
  reported(slot, `${slot}_gp`, "gross_profit", latest("annual")),
  reported(slot, `${slot}_oi`, "operating_income", latest("annual")),
  reported(slot, `${slot}_ni`, "net_income", latest("annual")),
  margin("gross_margin", `${slot}_gm`, `${slot}_gp`, `${slot}_rev`),
  margin("operating_margin", `${slot}_om`, `${slot}_oi`, `${slot}_rev`),
  margin("net_margin", `${slot}_nm`, `${slot}_ni`, `${slot}_rev`),
];
const amdOperatingMargin = (period: Period, suffix: string) => [
  reported("a", `oi_${suffix}`, "operating_income", period),
  reported("a", `rev_${suffix}`, "revenue", period),
  margin("operating_margin", `om_${suffix}`, `oi_${suffix}`, `rev_${suffix}`),
];

const NVIDIA = "NVIDIA Corporation";
const AMD = "Advanced Micro Devices, Inc.";
const commentary = (list: ReadonlyArray<Assertion>) => `\`\`\`assertions\n${JSON.stringify(list)}\n\`\`\``;
const APPLE = "Apple Inc.";
const REVENUE = "Revenue";
const GROSS_MARGIN = "Gross margin (gross profit / revenue)";
const OPERATING_MARGIN = "Operating margin (operating income / revenue)";
const NET_MARGIN = "Net margin (net income / revenue)";
const LATEST_YEAR = "latest fiscal year";
const NOT_PUBLIC = "No eligible input was public before the knowledge cutoff.";

export const HOLDOUT_CASES: ReadonlyArray<HoldoutCase> = [
  {
    id: "three-company-order",
    trap: "three companies on revenue and margins: a figure credited to the wrong company, or a company dropped",
    turns: ["Compare NVDA, AMD and AAPL on revenue and margins."],
    scopes: [{metrics: [{metric: "income_statement", adjustment: null, qualifier: null}], asks: ["margins"], turns_off: {facets: [], metrics: []}, income_items: ["revenue"], period: {kind: "none"}, companies: {kind: "compare", add: ["NVDA", "AMD", "AAPL"]}}],
    plan: draft(["NVDA", "AMD", "AAPL"], [...latestMargins("a"), ...latestMargins("b"), ...latestMargins("c")],
      ["a", "b", "c"].flatMap((slot) => [`${slot}_rev`, `${slot}_gm`, `${slot}_om`, `${slot}_nm`])),
    expect: {
      companies: ["NVDA", "AMD", "AAPL"],
      route: "financial_answer",
      financial: [
        [NVIDIA, REVENUE, LATEST_YEAR, "verified", "USD 209,911,000,000.00"],
        [NVIDIA, GROSS_MARGIN, LATEST_YEAR, "verified", "70.78%"],
        [NVIDIA, OPERATING_MARGIN, LATEST_YEAR, "verified", "60.21%"],
        [NVIDIA, NET_MARGIN, LATEST_YEAR, "verified", "53.60%"],
        [AMD, REVENUE, LATEST_YEAR, "verified", "USD 34,669,000,000.00"],
        [AMD, GROSS_MARGIN, LATEST_YEAR, "verified", "49.92%"],
        [AMD, OPERATING_MARGIN, LATEST_YEAR, "verified", "9.78%"],
        [AMD, NET_MARGIN, LATEST_YEAR, "verified", "12.04%"],
        [APPLE, REVENUE, LATEST_YEAR, "verified", "USD 416,161,000,000.00"],
        [APPLE, GROSS_MARGIN, LATEST_YEAR, "verified", "46.91%"],
        [APPLE, OPERATING_MARGIN, LATEST_YEAR, "verified", "31.97%"],
        [APPLE, NET_MARGIN, LATEST_YEAR, "verified", "26.92%"],
      ],
    },
    prose: "",
  },
  {
    id: "fiscal-period",
    trap: "the fiscal year asked for, whose calendars end eight months apart; a substituted year",
    turns: ["Compare NVDA's and AAPL's fiscal 2025 revenue."],
    scopes: [{metrics: [{metric: "income_statement", adjustment: null, qualifier: null}], asks: [], turns_off: {facets: [], metrics: []}, income_items: ["revenue"], period: {kind: "fiscal_year", fiscal_year: 2025}, companies: {kind: "as_named", names: ["NVDA", "AAPL"]}}],
    plan: draft(["NVDA", "AAPL"], [reported("a", "a_rev", "revenue", fiscal(2025, "FY")), reported("b", "b_rev", "revenue", fiscal(2025, "FY"))], ["a_rev", "b_rev"]),
    expect: {
      companies: ["NVDA", "AAPL"],
      route: "financial_answer",
      fiscal_year: 2025,
      financial: [
        [NVIDIA, REVENUE, "FY2025", "verified", "USD 130,497,000,000.00"],
        [APPLE, REVENUE, "FY2025", "verified", "USD 416,161,000,000.00"],
      ],
    },
    prose: "",
  },
  {
    id: "unknown-cause",
    trap: "a margin drop with no cause in evidence: the change is calculated, and no cause is stated",
    turns: ["What changed in NVDA's gross margin in Q1 fiscal 2026?"],
    scopes: [{metrics: [{metric: "income_statement", adjustment: null, qualifier: null}], asks: ["margins", "margin_trend"], turns_off: {facets: [], metrics: []}, income_items: ["gross_margin"], period: {kind: "fiscal_quarter", fiscal_period: "Q1", fiscal_year: 2026}, companies: {kind: "as_named", names: ["NVDA"]}}],
    plan: draft(["NVDA"], [
      reported("a", "gp_q4", "gross_profit", fiscal(2025, "Q4")),
      reported("a", "rev_q4", "revenue", fiscal(2025, "Q4")),
      margin("gross_margin", "gm_q4", "gp_q4", "rev_q4"),
      reported("a", "gp_q1", "gross_profit", fiscal(2026, "Q1")),
      reported("a", "rev_q1", "revenue", fiscal(2026, "Q1")),
      margin("gross_margin", "gm_q1", "gp_q1", "rev_q1"),
      { node_id: "gm_change", operation: "absolute_change", current: "gm_q1", prior: "gm_q4" },
    ], ["gm_q4", "gm_q1", "gm_change"]),
    expect: {
      companies: ["NVDA"],
      route: "financial_answer",
      financial: [
        [NVIDIA, GROSS_MARGIN, "Q4 FY2025", "verified", "73.03%"],
        [NVIDIA, GROSS_MARGIN, "Q1 FY2026", "verified", "60.52%"],
        [NVIDIA, `Quarter-over-quarter change in ${GROSS_MARGIN}`, "Q1 FY2026 vs Q4 FY2025", "verified", "-12.51%"],
      ],
    },
    prose: "",
  },
  {
    id: "missing-cash-flow",
    trap: "free cash flow is not in the data: a declared gap, never a number in its place",
    turns: ["What is AMD's free cash flow?"],
    scopes: [{metrics: [{metric: "free_cash_flow", adjustment: null, qualifier: null}], asks: [], turns_off: {facets: [], metrics: []}, income_items: [], period: {kind: "none"}, companies: {kind: "as_named", names: ["AMD"]}}],
    plan: draft(["AMD"], [
      reported("a", "a_ocf", "operating_cash_flow", latest("annual")),
      reported("a", "a_capex", "capex", latest("annual")),
      { node_id: "a_fcf", operation: "free_cash_flow", operating_cash_flow: "a_ocf", capex: "a_capex" },
    ], ["a_fcf"]),
    expect: {
      companies: ["AMD"],
      route: "financial_answer",
      financial: [
        [AMD, "Operating cash flow", LATEST_YEAR, "missing", NOT_PUBLIC],
        [AMD, "Capital expenditures (PP&E cash payments)", LATEST_YEAR, "missing", NOT_PUBLIC],
        [AMD, "Free cash flow (OCF less PP&E cash capex)", LATEST_YEAR, "blocked_dependency", "A required input or calculation is unavailable."],
      ],
      absent_kinds: ["metric_row", "revenue_bars"],
    },
    prose: "",
  },
  {
    id: "restatement",
    // Chat plans as reported: docs/engineering/verified-finance-producer-inventory.md
    trap: "a restated quarter: the engine shows the one value its as-reported basis selects, and the other is never shown",
    turns: ["Analyze AAPL's latest quarter."],
    scopes: [{metrics: [], asks: ["latest_quarter"], turns_off: {facets: [], metrics: []}, income_items: [], period: {kind: "latest"}, companies: {kind: "as_named", names: ["AAPL"]}}],
    expect: {
      companies: ["AAPL"],
      route: "financial_answer",
      financial: [
        [APPLE, "Revenue", "Q4 FY2024", "verified", "USD 94,930,000,000.00"],
        [APPLE, "Revenue", "Q1 FY2025", "verified", "USD 124,300,000,000.00"],
        [APPLE, "Revenue", "Q2 FY2025", "verified", "USD 95,359,000,000.00"],
        [APPLE, "Revenue", "Q3 FY2025", "verified", "USD 94,036,000,000.00"],
        [APPLE, "Revenue", "Q4 FY2025", "verified", "USD 102,466,000,000.00"],
        [APPLE, "Revenue", "Q1 FY2026", "verified", "USD 128,000,000,000.00"],
        [APPLE, "Revenue", "Q2 FY2026", "verified", "USD 98,700,000,000.00"],
        [APPLE, "Revenue", "Q3 FY2026", "verified", "USD 97,100,000,000.00"],
        [APPLE, "Gross profit", "Q3 FY2026", "verified", "USD 45,700,000,000.00"],
        [APPLE, "Operating income", "Q3 FY2026", "verified", "USD 29,800,000,000.00"],
        [APPLE, "Net income", "Q3 FY2026", "verified", "USD 24,900,000,000.00"],
        [APPLE, "Gross margin (gross profit / revenue)", "Q3 FY2026", "verified", "47.06%"],
        [APPLE, OPERATING_MARGIN, "Q3 FY2026", "verified", "30.69%"],
        [APPLE, "Net margin (net income / revenue)", "Q3 FY2026", "verified", "25.64%"],
        [APPLE, "Quarter-over-quarter percent change in Revenue", "Q1 FY2025 vs Q4 FY2024", "verified", "30.94%"],
        [APPLE, "Quarter-over-quarter percent change in Revenue", "Q2 FY2025 vs Q1 FY2025", "verified", "-23.28%"],
        [APPLE, "Quarter-over-quarter percent change in Revenue", "Q3 FY2025 vs Q2 FY2025", "verified", "-1.39%"],
        [APPLE, "Quarter-over-quarter percent change in Revenue", "Q4 FY2025 vs Q3 FY2025", "verified", "8.96%"],
        [APPLE, "Quarter-over-quarter percent change in Revenue", "Q1 FY2026 vs Q4 FY2025", "verified", "24.92%"],
        [APPLE, "Quarter-over-quarter percent change in Revenue", "Q2 FY2026 vs Q1 FY2026", "verified", "-22.89%"],
        [APPLE, "Quarter-over-quarter percent change in Revenue", "Q3 FY2026 vs Q2 FY2026", "verified", "-1.62%"],
        [APPLE, "Year-over-year percent change in Revenue", "Q3 FY2026 vs Q3 FY2025", "verified", "3.26%"],
        [APPLE, "Revenue ranked across periods", "Q4 FY2024 to Q3 FY2026", "verified", "Q1 FY2026 has the highest revenue of the 8 quarters ranked"],
        [APPLE, "Revenue ranked across periods", "Q4 FY2024 to Q3 FY2026", "verified", "Q3 FY2025 has the lowest revenue of the 8 quarters ranked"],
      ],
      uncovered: "AAPL's revenue was USD 97,100,000,000.00 in Q3 FY2026.",
    },
    // The engine's commentary, citing its Q3 FY2026 revenue result.
    prose: commentary([obs("AAPL's revenue was [[F8]] in Q3 FY2026.", ["F8"])]),
    mutations: [
      { name: "the restated value written into the commentary", prose: commentary([obs("AAPL's revenue was $97.4B in Q3 FY2026.", ["F8"])]), never_shown: "97.4" },
    ],
  },
  {
    id: "segment-definition",
    trap: "a redefined segment: the engine has no segment definition, so neither definition's revenue is shown",
    turns: ["Break down NVDA's revenue by segment."],
    scopes: [{metrics: [{metric: "income_statement", adjustment: null, qualifier: null}], asks: ["segments"], turns_off: {facets: [], metrics: []}, income_items: ["revenue"], period: {kind: "none"}, companies: {kind: "as_named", names: ["NVDA"]}}],
    plan: { outcome: "unsupported", reason: "segments" },
    expect: { companies: ["NVDA"], financial_gap: "unsupported", absent_kinds: ["metric_row", "financial_answer"] },
    prose: "",
  },
  {
    id: "ambiguous-follow-up",
    trap: "a follow-up naming a new company after a comparison could add it or switch to it: ask, never guess",
    turns: ["Compare NVDA with AMD.", "What about AAPL?"],
    scopes: [{metrics: [], asks: [], turns_off: {facets: [], metrics: []}, income_items: [], period: {kind: "none"}, companies: {kind: "compare", add: ["NVDA", "AMD"]}}, {metrics: [], asks: [], turns_off: {facets: [], metrics: []}, income_items: [], period: {kind: "none"}, companies: {kind: "unclear", names: ["AAPL"]}}],
    expect: { companies: [], clarification: true, absent_kinds: ["metric_row", "metrics_comparison", "revenue_bars"] },
    prose: "",
  },
  {
    id: "interior-extremum-and-trend",
    trap: "a low inside the window, a rebound and net rise: every quarter is calculated, the low among them",
    turns: ["How have AMD's operating margins trended over the last eight quarters?"],
    scopes: [{metrics: [{metric: "income_statement", adjustment: null, qualifier: "margin"}], asks: ["margins", "margin_trend"], turns_off: {facets: [], metrics: []}, income_items: ["operating_margin"], period: {kind: "range"}, companies: {kind: "as_named", names: ["AMD"]}}],
    plan: draft(["AMD"], [7, 6, 5, 4, 3, 2, 1, 0].flatMap((offset) => amdOperatingMargin(latest("quarterly", offset), `q${offset}`)),
      [7, 6, 5, 4, 3, 2, 1, 0].map((offset) => `om_q${offset}`)),
    expect: {
      companies: ["AMD"],
      route: "financial_answer",
      financial: [
        [AMD, OPERATING_MARGIN, "fiscal quarter 7 before latest", "verified", "10.62%"],
        [AMD, OPERATING_MARGIN, "fiscal quarter 6 before latest", "verified", "11.37%"],
        [AMD, OPERATING_MARGIN, "fiscal quarter 5 before latest", "verified", "10.84%"],
        [AMD, OPERATING_MARGIN, "fiscal quarter 4 before latest", "verified", "-1.74%"],
        [AMD, OPERATING_MARGIN, "fiscal quarter 3 before latest", "verified", "13.74%"],
        [AMD, OPERATING_MARGIN, "fiscal quarter 2 before latest", "verified", "14.08%"],
        [AMD, OPERATING_MARGIN, "fiscal quarter 1 before latest", "verified", "14.21%"],
        [AMD, OPERATING_MARGIN, "latest fiscal quarter", "verified", "14.38%"],
      ],
    },
    prose: "",
  },
  {
    id: "comparison-follow-up-scope",
    trap: "a follow-up keeps both companies and the sealed YTD window, its only figures the chart's returns; a conclusion on a narrowed cohort or the wrong winner; an inference crediting one company with another's figure",
    turns: ["Analyze NVDA", "Compare it with AMD YTD", "Explain the differences and show the evidence"],
    scopes: [{metrics: [], asks: [], turns_off: {facets: [], metrics: []}, income_items: [], period: {kind: "none"}, companies: {kind: "as_named", names: ["NVDA"]}}, {metrics: [], asks: ["price_window"], turns_off: {facets: [], metrics: []}, income_items: [], period: {kind: "none"}, companies: {kind: "compare", add: ["AMD"]}}, {metrics: [], asks: ["explains", "evidence"], turns_off: {facets: [], metrics: []}, income_items: [], period: {kind: "none"}, companies: {kind: "as_named", names: []}}],
    expect: {
      companies: ["NVDA", "AMD"],
      route: "evidence_followup",
      ytd_range: "YTD 2026: 2025-12-31 close to 2026-08-31 close",
      blocks: [{ kind: "perf_comparison" }],
      absent_kinds: ["metrics_comparison", "metric_row", "revenue_bars"],
    },
    prose: "NVDA's shares returned more than AMD's.",
    good: [
      cmp("highest", "F1", ["F1", "F2"]),
      obs("NVDA's price return was [[F1]]; AMD's was [[F2]].", ["F1", "F2"]),
      inference("The market rewarded the faster grower more this year.", [0, 1]),
    ],
    mutations: [
      { name: "narrowed cohort", list: [cmp("highest", "F1", ["F1"])], fails: { index: 0, check: "kind" } },
      { name: "wrong winner", list: [cmp("highest", "F2", ["F1", "F2"])], fails: { index: 0, check: "comparative" } },
      // Beside a checked NVDA-highest, words naming the wrong leader contradict
      // it (#288).
      {
        name: "an inference naming the wrong leader",
        list: [cmp("highest", "F1", ["F1", "F2"]), inference("AMD's lead in returns shows the market favours it.", [0])],
        judged: { 1: "contradicted" },
        fails: { index: 1, check: "judge" },
      },
      // F2 is AMD's return, cited by the observation the inference rests on (#301).
      {
        name: "a reference swapped to another company's figure",
        list: [
          cmp("highest", "F1", ["F1", "F2"]),
          obs("NVDA's price return was [[F1]]; AMD's was [[F2]].", ["F1", "F2"]),
          inference("The lead comes with [[F2]] of return.", [0, 1]),
        ],
        fails: { index: 2, check: "binding" },
      },
    ],
  },
  {
    id: "filed-cause",
    trap: "a cause asked for: the margin is calculated, and the answer says the cause is not",
    turns: ["Why did AMD's operating margin turn negative in Q2 2025?"],
    // pinned 2026-10-23: the live reading flips on this question (#511).
    scopes: [{metrics: [{metric: "income_statement", adjustment: null, qualifier: null}], asks: ["explains", "margin_trend"], turns_off: {facets: [], metrics: []}, income_items: ["operating_margin"], period: {kind: "fiscal_quarter", fiscal_period: "Q2", fiscal_year: 2025}, companies: {kind: "as_named", names: ["AMD"]}}],
    plan: draft(["AMD"], amdOperatingMargin(fiscal(2025, "Q2"), "q2"), ["om_q2"]),
    expect: {
      companies: ["AMD"],
      route: "financial_answer",
      financial: [[AMD, OPERATING_MARGIN, "Q2 FY2025", "verified", "-1.74%"]],
      uncovered: "Not covered by this answer: a margin over several periods; the cause of these figures.",
    },
    prose: "",
  },
];

// Comparative traps on explicit values (#221): ties, negatives, rounded
// displays and missing intervals, with expected outcomes independent of the
// checker. Run against a declared packet, not a turn.
export type SyntheticFigure = { id: string; company?: string; metric: string; period: string; period_end?: string; value: string };
export const SYNTHETIC_FIGURES: ReadonlyArray<SyntheticFigure> = [
  { id: "T1", company: "NVDA", metric: "Net margin", period: "FY2026", value: "13.2%" },
  { id: "T2", company: "AMD", metric: "Net margin", period: "FY2025", value: "13.2%" },
  { id: "T3", company: "AAPL", metric: "Net margin", period: "FY2025", value: "13.25%" },
  { id: "N1", company: "NVDA", metric: "EPS growth", period: "FY2026", value: "-5.0%" },
  { id: "N2", company: "AMD", metric: "EPS growth", period: "FY2025", value: "-12.0%" },
  { id: "N3", company: "AAPL", metric: "EPS growth", period: "FY2025", value: "-8.0%" },
  { id: "R1", company: "AMD", metric: "Revenue", period: "Q1 2025", period_end: "2025-03-29", value: "$7.4B" },
  { id: "R3", company: "AMD", metric: "Revenue", period: "Q3 2025", period_end: "2025-09-27", value: "$9.2B" },
  { id: "R4", company: "AMD", metric: "Revenue", period: "Q4 2025", period_end: "2025-12-27", value: "$10.3B" },
];
export const SYNTHETIC_CASES: ReadonlyArray<{ name: string; assertion: Assertion; outcome: "accepted" | RejectionCheck }> = [
  { name: "a tie is no unique winner", assertion: cmp("highest", "T1", ["T1", "T2", "T3"]), outcome: "comparative" },
  { name: "values within rounding are a tie", assertion: cmp("highest", "T3", ["T1", "T2", "T3"]), outcome: "comparative" },
  { name: "the least negative is highest", assertion: cmp("highest", "N1", ["N1", "N2", "N3"]), outcome: "accepted" },
  { name: "the most negative is lowest", assertion: cmp("lowest", "N2", ["N1", "N2", "N3"]), outcome: "accepted" },
  { name: "a missing quarter allows a net rise", assertion: cmp("trend", "rose", ["R1", "R3", "R4"]), outcome: "accepted" },
  { name: "a missing quarter allows no every-quarter rise", assertion: cmp("trend", "rose_throughout", ["R1", "R3", "R4"]), outcome: "comparative" },
  { name: "an incomplete cohort allows no full-cohort superlative", assertion: cmp("lowest", "N2", ["N1", "N2"]), outcome: "comparative" },
];

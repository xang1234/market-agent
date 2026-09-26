// The verified-finance release gate's fixtures.
//
// Golden cases: plans over bound inputs, and selections over candidate
// disclosures, whose expected outcomes are computed here from the source
// tokens with an independent exact-rational oracle (BigInt; no production
// arithmetic, rounding, or selection code). Each case names the reviewed rule
// it exercises.
//
// Mutants: a correct sealed unit tampered one way at a time — a changed
// result, unit, period, cutoff, definition, peer count, or a number written as
// words — always with valid source and fact ids. The verifier must reject every
// one; a verifier that rejects everything fails the valid baseline instead.

import {
  hashCanonical,
  validateFinancialPlan,
  type FinancialPlanV1,
  type GraphEvaluation,
  type LocalId,
  type ReportedMetricNode,
  type SlotBinding,
} from "../services/financial-core/src/index.ts";
import { planFixture } from "../services/financial-core/test/fixtures.ts";
import { boundInput, type InputSpec } from "../services/financial-core/test/operand-fixtures.ts";
import { addRational, compareRational, divideRational, rational, reduce, type Rational } from "../services/financial-core/test/rational-oracle.ts";
import type { InputCandidate } from "../services/financial-engine/src/ports.ts";
import type { SelectionPolicy, SlotSelection } from "../services/financial-engine/src/select-inputs.ts";
import type { FinancialUnitRecords } from "../services/snapshot/src/financial-verifier-loader.ts";
import { mutable, validRecords } from "../services/snapshot/test/financial-fixtures.ts";

// --- independent oracle extensions -----------------------------------------

function subtractRational(a: Rational, b: Rational): Rational {
  return reduce({ n: a.n * b.d - b.n * a.d, d: a.d * b.d });
}

/** Rounds to `digits` significant digits, ties to even (numeric-policy.v1 as documented, not as implemented). */
function roundSignificant(value: Rational, digits: number): Rational {
  if (value.n === 0n) return value;
  const negative = value.n < 0n;
  const magnitude = { n: negative ? -value.n : value.n, d: value.d };
  let exponent = 0; // 10^exponent <= magnitude < 10^(exponent + 1)
  while (compareRational(magnitude, { n: 10n ** BigInt(exponent + 1), d: 1n }) >= 0) exponent += 1;
  while (compareRational(magnitude, { n: 1n, d: 10n ** BigInt(-exponent) }) < 0) exponent -= 1;
  const shift = digits - 1 - exponent;
  const scaled = shift >= 0 ? { n: magnitude.n * 10n ** BigInt(shift), d: magnitude.d } : { n: magnitude.n, d: magnitude.d * 10n ** BigInt(-shift) };
  let quotient = scaled.n / scaled.d;
  const twice = 2n * (scaled.n % scaled.d);
  if (twice > scaled.d || (twice === scaled.d && quotient % 2n === 1n)) quotient += 1n;
  const rounded = shift >= 0 ? reduce({ n: quotient, d: 10n ** BigInt(shift) }) : reduce({ n: quotient * 10n ** BigInt(-shift), d: 1n });
  return negative ? { n: -rounded.n, d: rounded.d } : rounded;
}

/** A quotient as the policy presents it: exact when it terminates within 50 significant digits, otherwise rounded. */
function policyQuotient(numerator: string, denominator: string): { value: Rational; exact: boolean } {
  const exact = divideRational(rational(numerator), rational(denominator));
  const rounded = roundSignificant(exact, 50);
  return { value: rounded, exact: compareRational(rounded, exact) === 0 };
}

// --- golden computation cases ------------------------------------------------

export type GoldenCategory =
  | "exact_source_token" | "calendar_53_week" | "restatement" | "public_versus_ingestion" | "date_only_uncertainty"
  | "negative_base" | "zero_denominator" | "precision_limit" | "partial_cohort";

export type GoldenExpectation =
  | Readonly<{ kind: "value"; value: Rational; exact: boolean }>
  | Readonly<{ kind: "gap"; reason_code: string }>
  | Readonly<{ kind: "predicate"; outcome: boolean }>
  | Readonly<{ kind: "ranking"; requested: number; evaluated: number; complete: boolean; extreme: ReadonlyArray<string> | null }>;

export type ComputationCase = Readonly<{
  id: string;
  category: GoldenCategory;
  rule: string;
  plan: FinancialPlanV1;
  bindings: ReadonlyMap<LocalId, SlotBinding>;
  expected: Readonly<Record<string, GoldenExpectation>>;
}>;

type Node = Record<string, unknown> & { node_id: string };
const HASH = "c".repeat(64);

const reported = (nodeId: string, slot: string, metric: string, fiscalYear = 2023, fiscalPeriod = "FY"): Node => ({
  node_id: nodeId, operation: "reported_metric", operation_version: "reported_metric.v1", subject_slot: slot, metric_key: metric,
  period: { kind: "fiscal_period", fiscal_year: fiscalYear, fiscal_period: fiscalPeriod },
});

function plan(operations: Node[], outputs: string[], thresholds: ReadonlyArray<{ id: string; value: string; unit: unknown }> = [], slots = ["a", "b"]): FinancialPlanV1 {
  const base = planFixture();
  const members = [
    ...base.subjects.members,
    { slot_id: "c", subject_ref: { kind: "issuer", id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }, display_order: 2, role: "peer" },
  ].filter((member) => slots.includes(member.slot_id));
  const metrics = [...new Set(operations.flatMap((node) => (typeof node.metric_key === "string" ? [node.metric_key] : [])))];
  const validated = validateFinancialPlan({
    ...base,
    subjects: { ...base.subjects, requested_count: members.length, resolved_count: members.length, members },
    metric_definitions: metrics.map((key) => ({ metric_key: key, definition_version: `${key}.v1` })),
    operations: operations.map((node) => ({ operation_version: `${String(node.operation)}.v1`, ...node })),
    outputs: outputs.map((nodeId) => ({ output_id: `out_${nodeId}`, node_id: nodeId, unit_id: "section" })),
    thresholds: thresholds.map((threshold) => ({ threshold_id: threshold.id, value: threshold.value, unit: threshold.unit, attribution: { kind: "user_request", ref: "chat:turn:1" } })),
  });
  if (!validated.ok) throw new Error(`golden plan is invalid: ${JSON.stringify(validated.issues)}`);
  return validated.value;
}

function bound(nodeId: string, spec: InputSpec): [LocalId, SlotBinding] {
  const input = { ...boundInput(spec), input_slot: nodeId };
  return [nodeId, { status: "bound", input, payload_hash: hashCanonical("bound_input", input), candidate_set_digest: HASH }];
}

const gapBinding = (nodeId: string, reason: string): [LocalId, SlotBinding] =>
  [nodeId, { status: "gap", reason_code: reason as never, candidate_set_digest: HASH }];

const FY = (year: number) => ({ start: `${year}-01-01`, end: `${year}-12-31`, fiscal_year: year, fiscal_period: "FY" as const });
const value = (token: string): GoldenExpectation => ({ kind: "value", value: rational(token), exact: true });
const quotient = (numerator: string, denominator: string): GoldenExpectation => ({ kind: "value", ...policyQuotient(numerator, denominator) });

// A 52/53-week fiscal year: Q4 runs 14 weeks (98 days) and is still one quarter.
const QUARTERS_53_WEEK = [
  { fiscal_period: "Q1" as const, start: "2023-01-01", end: "2023-04-01", value: "90753000000.25" },
  { fiscal_period: "Q2" as const, start: "2023-04-02", end: "2023-07-01", value: "81797000000" },
  { fiscal_period: "Q3" as const, start: "2023-07-02", end: "2023-09-30", value: "89498000000" },
  { fiscal_period: "Q4" as const, start: "2023-10-01", end: "2024-01-06", value: "119575000000.75" },
];

function trailingSumCase(id: string, rule: string, quarters: typeof QUARTERS_53_WEEK, expected: GoldenExpectation): ComputationCase {
  const nodes = quarters.map((quarter) => reported(`q_${quarter.fiscal_period.toLowerCase()}`, "a", "revenue", 2023, quarter.fiscal_period));
  return {
    id, category: "calendar_53_week", rule,
    plan: plan([...nodes, { node_id: "ttm", operation: "trailing_sum", quarters: nodes.map((node) => node.node_id) }], ["ttm"], [], ["a"]),
    bindings: new Map(quarters.map((quarter) => bound(`q_${quarter.fiscal_period.toLowerCase()}`, { metric: "revenue", value: quarter.value, start: quarter.start, end: quarter.end, fiscal_year: 2023, fiscal_period: quarter.fiscal_period }))),
    expected: { out_ttm: expected },
  };
}

export const COMPUTATION_CASES: ReadonlyArray<ComputationCase> = [
  {
    id: "reported-token-exact", category: "exact_source_token",
    rule: "A reported value is the source token exactly, with no float conversion or trimming.",
    plan: plan([reported("a_rev", "a", "revenue")], ["a_rev"], [], ["a"]),
    bindings: new Map([bound("a_rev", { metric: "revenue", value: "383285000000.123456789012345678", ...FY(2023) })]),
    expected: { out_a_rev: value("383285000000.123456789012345678") },
  },
  {
    id: "reported-token-scaled", category: "exact_source_token",
    rule: "A token reported in millions is the token times its declared scale.",
    plan: plan([reported("a_rev", "a", "revenue")], ["a_rev"], [], ["a"]),
    bindings: new Map([bound("a_rev", { metric: "revenue", value: "383285.25", scale: "1000000", native: "383285250000", ...FY(2023) })]),
    expected: { out_a_rev: value("383285250000") },
  },
  trailingSumCase(
    "ttm-53-week-year", "Four contiguous quarters sum exactly even when a 53-week year makes Q4 fourteen weeks long.",
    QUARTERS_53_WEEK,
    { kind: "value", value: QUARTERS_53_WEEK.reduce((sum, quarter) => addRational(sum, rational(quarter.value)), rational("0")), exact: true },
  ),
  trailingSumCase(
    "ttm-overlong-quarter", "A fifteen-week span is not a fiscal quarter, so no trailing sum is formed from it.",
    QUARTERS_53_WEEK.map((quarter) => (quarter.fiscal_period === "Q4" ? { ...quarter, end: "2024-01-13" } : quarter)),
    { kind: "gap", reason_code: "unsupported_period" },
  ),
  {
    id: "growth-negative-base", category: "negative_base",
    rule: "Percent change needs a positive prior value; a loss-to-profit swing is not a growth rate.",
    plan: plan([reported("cur", "a", "revenue"), reported("pri", "a", "revenue", 2022), { node_id: "growth", operation: "percent_change_positive_base", current: "cur", prior: "pri" }], ["growth"], [], ["a"]),
    bindings: new Map([bound("cur", { metric: "revenue", value: "120", ...FY(2023) }), bound("pri", { metric: "revenue", value: "-80", ...FY(2022) })]),
    expected: { out_growth: { kind: "gap", reason_code: "non_positive_base" } },
  },
  {
    id: "growth-exact", category: "negative_base",
    rule: "With a positive base, growth is (current − prior) / prior under the numeric policy.",
    plan: plan([reported("cur", "a", "revenue"), reported("pri", "a", "revenue", 2022), { node_id: "growth", operation: "percent_change_positive_base", current: "cur", prior: "pri" }], ["growth"], [], ["a"]),
    bindings: new Map([bound("cur", { metric: "revenue", value: "383285000000", ...FY(2023) }), bound("pri", { metric: "revenue", value: "365817000000", ...FY(2022) })]),
    expected: {
      out_growth: (() => {
        const exact = divideRational(subtractRational(rational("383285000000"), rational("365817000000")), rational("365817000000"));
        const rounded = roundSignificant(exact, 50);
        return { kind: "value", value: rounded, exact: compareRational(rounded, exact) === 0 };
      })(),
    },
  },
  {
    id: "margin-zero-revenue", category: "zero_denominator",
    rule: "A margin over zero revenue is a declared gap, never infinity or zero.",
    plan: plan([reported("gp", "a", "gross_profit"), reported("rev", "a", "revenue"), { node_id: "gm", operation: "gross_margin", numerator: "gp", revenue: "rev" }], ["gm"], [], ["a"]),
    bindings: new Map([bound("gp", { metric: "gross_profit", value: "10", ...FY(2023) }), bound("rev", { metric: "revenue", value: "0", ...FY(2023) })]),
    expected: { out_gm: { kind: "gap", reason_code: "zero_denominator" } },
  },
  ...([["1", "3"], ["2", "3"], ["1", "8"], ["169148000000", "383285000000.123456789012345678"]] as const).map(([gp, rev], index): ComputationCase => ({
    id: `margin-precision-${index + 1}`, category: "precision_limit",
    rule: "Division keeps 50 significant digits, ties to even, and says whether the value is exact.",
    plan: plan([reported("gp", "a", "gross_profit"), reported("rev", "a", "revenue"), { node_id: "gm", operation: "gross_margin", numerator: "gp", revenue: "rev" }], ["gm"], [], ["a"]),
    bindings: new Map([bound("gp", { metric: "gross_profit", value: gp, ...FY(2023) }), bound("rev", { metric: "revenue", value: rev, ...FY(2023) })]),
    expected: { out_gm: quotient(gp, rev) },
  })),
  {
    id: "threshold-exact-equality", category: "precision_limit",
    rule: "Threshold predicates compare exact values: a value equal to its threshold is not greater than it.",
    plan: plan(
      [reported("rev", "a", "revenue"), { node_id: "above", operation: "threshold", subject: "rev", threshold_id: "t", comparison: "gt" }, { node_id: "at_least", operation: "threshold", subject: "rev", threshold_id: "t", comparison: "gte" }],
      ["above", "at_least"], [{ id: "t", value: "383285000000.123456789012345678", unit: { kind: "currency", currency: "USD" } }], ["a"],
    ),
    bindings: new Map([bound("rev", { metric: "revenue", value: "383285000000.123456789012345678", ...FY(2023) })]),
    expected: { out_above: { kind: "predicate", outcome: false }, out_at_least: { kind: "predicate", outcome: true } },
  },
  {
    id: "cohort-partial", category: "partial_cohort",
    rule: "A cohort with a missing member ranks who is present but names no leader.",
    plan: plan([reported("a_rev", "a", "revenue"), reported("b_rev", "b", "revenue"), reported("c_rev", "c", "revenue"), { node_id: "rank", operation: "peer_compare", members: ["a_rev", "b_rev", "c_rev"], direction: "highest" }], ["rank"], [], ["a", "b", "c"]),
    bindings: new Map([bound("a_rev", { slot: "a", metric: "revenue", value: "300", ...FY(2023) }), bound("b_rev", { slot: "b", metric: "revenue", value: "500", ...FY(2023) }), gapBinding("c_rev", "missing_input")]),
    expected: { out_rank: { kind: "ranking", requested: 3, evaluated: 2, complete: false, extreme: null } },
  },
  {
    id: "cohort-complete-tie", category: "partial_cohort",
    rule: "A complete cohort names every tied leader.",
    plan: plan([reported("a_rev", "a", "revenue"), reported("b_rev", "b", "revenue"), reported("c_rev", "c", "revenue"), { node_id: "rank", operation: "peer_compare", members: ["a_rev", "b_rev", "c_rev"], direction: "highest" }], ["rank"], [], ["a", "b", "c"]),
    bindings: new Map([bound("a_rev", { slot: "a", metric: "revenue", value: "500.0", ...FY(2023) }), bound("b_rev", { slot: "b", metric: "revenue", value: "500", ...FY(2023) }), bound("c_rev", { slot: "c", metric: "revenue", value: "499.99", ...FY(2023) })]),
    expected: { out_rank: { kind: "ranking", requested: 3, evaluated: 3, complete: true, extreme: ["a_rev", "b_rev"] } },
  },
];

// --- golden selection cases -------------------------------------------------

export type SelectionCase = Readonly<{
  id: string;
  category: GoldenCategory;
  rule: string;
  node: ReportedMetricNode;
  candidates: ReadonlyArray<InputCandidate>;
  policy: SelectionPolicy;
  expected: Readonly<{ fact_id: string }> | Readonly<{ gap: string }>;
}>;

const FY2023_NODE: ReportedMetricNode = {
  node_id: "a_rev", operation: "reported_metric", operation_version: "reported_metric.v1", subject_slot: "a", metric_key: "revenue",
  period: { kind: "fiscal_period", fiscal_year: 2023, fiscal_period: "FY" },
};

function disclosure(id: string, input: { value: string; published: string; precision?: "date" | "instant"; relation?: "original" | "economic_restatement"; supersedes?: string; superseded_by?: string }): InputCandidate {
  return {
    fact_id: id, source_id: "11111111-1111-4111-8111-111111111111", source_version_hash: HASH, metric_key: "revenue",
    period: { start: "2023-01-01", end: "2023-12-31", fiscal_year: 2023, fiscal_period: "FY" },
    value_text: input.value, scale_text: "1", unit: { kind: "currency", currency: "USD" }, method: "reported", verification_status: "authoritative",
    // Ingested well after publication: public time, not ingestion time, decides eligibility.
    observed_at: "2024-06-01T00:00:00.000Z",
    supersedes: input.supersedes ?? null, superseded_by: input.superseded_by ?? null,
    context: {
      period_type: "duration", dimension_scope: "consolidated", dimension_members: [], adjustment_basis: "unadjusted", share_basis: "not_applicable",
      fiscal_calendar_version: "fiscal-calendar.v1", disclosure_relation: input.relation ?? "original",
    },
    precision: { precision_attestation_id: `p-${id}`, precision_class: "source_token_preserved", raw_token: input.value, token_proof_hash: HASH, source_locator: "loc" },
    publication: [{
      attestation_id: `a-${id}`,
      timing: {
        available_not_before: null,
        available_no_later_than: input.published,
        timing_precision: input.precision ?? "date",
        source_timezone: "America/New_York",
      },
    }],
  } as InputCandidate;
}

const ORIGINAL = "00000000-0000-4000-8000-00000000a001";
const RESTATED = "00000000-0000-4000-8000-00000000a002";
const originalAndRestated = () => [
  disclosure(ORIGINAL, { value: "100", published: "2024-01-10T00:00:00-05:00", superseded_by: RESTATED }),
  disclosure(RESTATED, { value: "104", published: "2024-06-10T00:00:00-04:00", relation: "economic_restatement", supersedes: ORIGINAL }),
];
const policy = (cutoff: string, basis: SelectionPolicy["reporting_basis"] = "as_reported"): SelectionPolicy => ({ knowledge_cutoff: cutoff, reporting_basis: basis, max_age_days: null });

export const SELECTION_CASES: ReadonlyArray<SelectionCase> = [
  {
    id: "restatement-as-reported", category: "restatement",
    rule: "As reported is the original disclosure, even after a restatement is public.",
    node: FY2023_NODE, candidates: originalAndRestated(), policy: policy("2024-12-31T23:59:59.999-05:00"),
    expected: { fact_id: ORIGINAL },
  },
  {
    id: "restatement-as-restated-after", category: "restatement",
    rule: "As restated is the latest disclosure public by the cutoff.",
    node: FY2023_NODE, candidates: originalAndRestated(), policy: policy("2024-12-31T23:59:59.999-05:00", "as_restated"),
    expected: { fact_id: RESTATED },
  },
  {
    id: "restatement-as-restated-before", category: "restatement",
    rule: "A restatement not yet public at the cutoff cannot replace the original.",
    node: FY2023_NODE, candidates: originalAndRestated(), policy: policy("2024-03-01T00:00:00-05:00", "as_restated"),
    expected: { fact_id: ORIGINAL },
  },
  {
    id: "public-before-ingestion", category: "public_versus_ingestion",
    rule: "A filing public before the cutoff is eligible even though it was ingested months later.",
    node: FY2023_NODE, candidates: [disclosure(ORIGINAL, { value: "100", published: "2024-01-10T00:00:00-05:00" })], policy: policy("2024-01-15T23:59:59.999-05:00"),
    expected: { fact_id: ORIGINAL },
  },
  {
    id: "date-only-same-day", category: "date_only_uncertainty",
    rule: "A date-only proof on the cutoff's own day counts as public only at the end of that local day.",
    node: FY2023_NODE, candidates: [disclosure(ORIGINAL, { value: "100", published: "2024-01-15T00:00:00-05:00" })], policy: policy("2024-01-15T10:00:00-05:00"),
    expected: { gap: "missing_input" },
  },
  {
    id: "instant-same-day", category: "date_only_uncertainty",
    rule: "An instant proof earlier on the cutoff's day is public at that instant.",
    node: FY2023_NODE, candidates: [disclosure(ORIGINAL, { value: "100", published: "2024-01-15T09:00:00-05:00", precision: "instant" })], policy: policy("2024-01-15T10:00:00-05:00"),
    expected: { fact_id: ORIGINAL },
  },
];

// --- running golden cases ---------------------------------------------------

/** The production functions under test; a harness self-test swaps in broken ones. */
export type EngineUnderTest = Readonly<{
  evaluate(plan: FinancialPlanV1, bindings: ReadonlyMap<LocalId, SlotBinding>): GraphEvaluation;
  select(node: ReportedMetricNode, candidates: ReadonlyArray<InputCandidate>, policy: SelectionPolicy): SlotSelection;
}>;

export type CaseResult = Readonly<{ id: string; category: GoldenCategory; passed: boolean; mismatches: ReadonlyArray<string> }>;

export function runGoldenCases(engine: EngineUnderTest): CaseResult[] {
  return [
    ...COMPUTATION_CASES.map((golden) => result(golden.id, golden.category, () => computationMismatches(engine, golden))),
    ...SELECTION_CASES.map((golden) => result(golden.id, golden.category, () => selectionMismatches(engine, golden))),
  ];
}

function result(id: string, category: GoldenCategory, check: () => string[]): CaseResult {
  let mismatches: string[];
  try {
    mismatches = check();
  } catch (error) {
    mismatches = [`threw ${error instanceof Error ? error.name : "error"}`];
  }
  return { id, category, passed: mismatches.length === 0, mismatches };
}

function computationMismatches(engine: EngineUnderTest, golden: ComputationCase): string[] {
  const outputs = new Map(engine.evaluate(golden.plan, golden.bindings).outputs.map((output) => [output.output_id, output.state]));
  return Object.entries(golden.expected).flatMap(([outputId, expected]) => {
    const state = outputs.get(outputId);
    if (!state) return [`${outputId}: missing`];
    if (expected.kind === "gap") {
      return state.status === "gap" && state.reason_code === expected.reason_code ? [] : [`${outputId}: expected gap ${expected.reason_code}, got ${describe(state)}`];
    }
    if (state.status !== "computed") return [`${outputId}: expected ${expected.kind}, got ${describe(state)}`];
    const payload = state.payload;
    switch (expected.kind) {
      case "value":
        if (payload.kind !== "value") return [`${outputId}: expected a value, got ${payload.kind}`];
        return [
          ...(compareRational(rational(payload.value), expected.value) === 0 ? [] : [`${outputId}: value differs from the oracle`]),
          ...(payload.exact === expected.exact ? [] : [`${outputId}: exact is ${payload.exact}, oracle says ${expected.exact}`]),
        ];
      case "predicate":
        return payload.kind === "predicate" && payload.outcome === expected.outcome ? [] : [`${outputId}: predicate differs from the oracle`];
      case "ranking":
        return payload.kind === "ranking"
          && payload.population.requested === expected.requested && payload.population.evaluated === expected.evaluated
          && payload.complete === expected.complete && JSON.stringify(payload.extreme) === JSON.stringify(expected.extreme)
          ? [] : [`${outputId}: ranking differs from the oracle`];
    }
  });
}

function selectionMismatches(engine: EngineUnderTest, golden: SelectionCase): string[] {
  const selection = engine.select(golden.node, golden.candidates, golden.policy);
  if ("gap" in golden.expected) {
    return selection.status === "gap" && selection.reason_code === golden.expected.gap ? [] : [`expected gap ${golden.expected.gap}, got ${selection.status === "gap" ? selection.reason_code : "a selection"}`];
  }
  return selection.status === "selected" && selection.input.candidate.fact_id === golden.expected.fact_id ? [] : ["selected a different disclosure"];
}

function describe(state: { status: string; reason_code?: string }): string {
  return state.status === "gap" ? `gap ${state.reason_code}` : state.status;
}

// --- mutants of a correct sealed unit ----------------------------------------

export type MutantKind = "numeric_result" | "unit" | "period" | "cutoff" | "definition" | "peer_count" | "word_only_claim";
export type Mutant = Readonly<{ id: string; kind: MutantKind; mutate(records: ReturnType<typeof mutable>): void }>;

/** Replaces a bound input's payload and re-hashes it, as a tamperer who knows the hashing scheme would. */
function rebind(records: ReturnType<typeof mutable>, slot: string, edit: (payload: any) => void): void {
  const row = records.bindings.find((binding: { input_slot: string }) => binding.input_slot === slot);
  edit(row.bound_payload);
  row.payload_hash = hashCanonical("bound_input", row.bound_payload);
}

const resultRow = (records: ReturnType<typeof mutable>, outputId: string) =>
  records.results.find((row: { output_id: string }) => row.output_id === outputId);

export const MUTANTS: ReadonlyArray<Mutant> = [
  { id: "margin-value", kind: "numeric_result", mutate: (records) => { resultRow(records, "out_gm").payload.value = "0.5"; } },
  { id: "revenue-last-digit", kind: "numeric_result", mutate: (records) => { resultRow(records, "out_rev").payload.value = "383285000000.123456789012345679"; } },
  { id: "revenue-currency", kind: "unit", mutate: (records) => { resultRow(records, "out_rev").payload.unit = { kind: "currency", currency: "EUR" }; } },
  { id: "bound-prior-year", kind: "period", mutate: (records) => rebind(records, "a_rev", (payload) => {
    payload.period = { ...payload.period, start: "2022-01-01", end: "2022-12-31", fiscal_year: 2022 };
  }) },
  { id: "later-cutoff", kind: "cutoff", mutate: (records) => { records.run.knowledge_cutoff = "2025-01-16T04:59:59.999Z"; } },
  { id: "plan-cutoff", kind: "cutoff", mutate: (records) => { records.plan.plan.time.knowledge_cutoff = "2025-01-16T04:59:59.999Z"; } },
  { id: "definition-version", kind: "definition", mutate: (records) => rebind(records, "a_gp", (payload) => { payload.metric.definition_version = "gross_profit.v2"; }) },
  { id: "cohort-size", kind: "peer_count", mutate: (records) => {
    records.plan.plan.subjects.requested_count = 2;
    records.plan.plan.subjects.omitted_count = 1;
  } },
  { id: "value-in-words", kind: "word_only_claim", mutate: (records) => { resultRow(records, "out_rev").payload.value = "three hundred eighty-three billion"; } },
];

export type MutationReport = Readonly<{
  baseline_verified: boolean;
  mutants: ReadonlyArray<Readonly<{ id: string; kind: MutantKind; rejected: boolean }>>;
  passed: boolean;
}>;

/** Runs the valid baseline and every mutant through `verify`; passes only if the baseline verifies and every mutant is rejected. */
export function runMutationSuite(verify: (records: FinancialUnitRecords) => boolean): MutationReport {
  const verifies = (records: FinancialUnitRecords) => {
    try {
      return verify(records);
    } catch {
      return false;
    }
  };
  const baseline = verifies(validRecords());
  const mutants = MUTANTS.map((mutant) => {
    const records = mutable(validRecords());
    mutant.mutate(records);
    return { id: mutant.id, kind: mutant.kind, rejected: !verifies(records) };
  });
  return { baseline_verified: baseline, mutants, passed: baseline && mutants.every((mutant) => mutant.rejected) };
}

// --- held-out questions for plan fidelity -------------------------------------
//
// Arithmetic equality cannot show that a plan answers the question that was
// asked. Each question states the intended companies, metrics, periods, and
// operations; an analyst reviews those intentions before they count toward
// release. The recorded drafts are the deterministic fixture (no provider
// secrets); a live run asks a configured model instead.

export type IntendedPlan = Readonly<{
  subjects: ReadonlyArray<string>;
  metrics: ReadonlyArray<string>;
  periods: ReadonlyArray<string>;
  operations: ReadonlyArray<string>;
}>;

export type HeldOutQuestion = Readonly<{
  id: string;
  question: string;
  subjects: ReadonlyArray<Readonly<{ mention: string; id: string; label: string }>>;
  intended: IntendedPlan;
  review: Readonly<{ status: "pending_analyst_review" | "reviewed"; reviewer: string | null }>;
}>;

const ALPHA = { mention: "AAA", id: "11111111-1111-4111-8111-111111111111", label: "Alpha Industries Inc." };
const BETA = { mention: "BBB", id: "22222222-2222-4222-8222-222222222222", label: "Beta Holdings Corp." };
const PENDING = { status: "pending_analyst_review", reviewer: null } as const;

export const HELD_OUT_QUESTIONS: ReadonlyArray<HeldOutQuestion> = [
  { id: "revenue-fy", question: "What was AAA's revenue in fiscal 2023?", subjects: [ALPHA],
    intended: { subjects: ["AAA"], metrics: ["revenue"], periods: ["FY2023"], operations: [] }, review: PENDING },
  { id: "revenue-compare", question: "Compare AAA and BBB revenue for fiscal 2023.", subjects: [ALPHA, BETA],
    intended: { subjects: ["AAA", "BBB"], metrics: ["revenue"], periods: ["FY2023"], operations: [] }, review: PENDING },
  { id: "gross-margin", question: "What was AAA's gross margin in fiscal 2023?", subjects: [ALPHA],
    intended: { subjects: ["AAA"], metrics: ["gross_profit", "revenue"], periods: ["FY2023"], operations: ["gross_margin"] }, review: PENDING },
  { id: "revenue-growth", question: "How much did AAA's revenue grow from fiscal 2022 to fiscal 2023?", subjects: [ALPHA],
    intended: { subjects: ["AAA"], metrics: ["revenue"], periods: ["FY2022", "FY2023"], operations: ["percent_change_positive_base"] }, review: PENDING },
  { id: "revenue-ttm", question: "What is AAA's trailing twelve month revenue?", subjects: [ALPHA],
    intended: { subjects: ["AAA"], metrics: ["revenue"], periods: ["latest:quarterly:0", "latest:quarterly:1", "latest:quarterly:2", "latest:quarterly:3"], operations: ["trailing_sum"] }, review: PENDING },
];

const fiscal = (node: string, slot: string, metric: string, year: number) =>
  ({ node_id: node, operation: "reported_metric", subject_slot: slot, metric_key: metric, period: { kind: "fiscal_period", fiscal_year: year, fiscal_period: "FY" } });

/** What a faithful planner answered for each held-out question, recorded as plan drafts. */
export const RECORDED_DRAFTS: Readonly<Record<string, unknown>> = {
  "revenue-fy": { outcome: "ready", subjects: [{ slot_id: "a", mention: "AAA" }], operations: [fiscal("a_rev", "a", "revenue", 2023)], outputs: [{ output_id: "out", node_id: "a_rev" }], thresholds: [] },
  "revenue-compare": {
    outcome: "ready", subjects: [{ slot_id: "a", mention: "AAA" }, { slot_id: "b", mention: "BBB" }],
    operations: [fiscal("a_rev", "a", "revenue", 2023), fiscal("b_rev", "b", "revenue", 2023)],
    outputs: [{ output_id: "a_out", node_id: "a_rev" }, { output_id: "b_out", node_id: "b_rev" }], thresholds: [],
  },
  "gross-margin": {
    outcome: "ready", subjects: [{ slot_id: "a", mention: "AAA" }],
    operations: [fiscal("a_gp", "a", "gross_profit", 2023), fiscal("a_rev", "a", "revenue", 2023), { node_id: "a_gm", operation: "gross_margin", numerator: "a_gp", revenue: "a_rev" }],
    outputs: [{ output_id: "out", node_id: "a_gm" }], thresholds: [],
  },
  "revenue-growth": {
    outcome: "ready", subjects: [{ slot_id: "a", mention: "AAA" }],
    operations: [fiscal("cur", "a", "revenue", 2023), fiscal("pri", "a", "revenue", 2022), { node_id: "growth", operation: "percent_change_positive_base", current: "cur", prior: "pri" }],
    outputs: [{ output_id: "out", node_id: "growth" }], thresholds: [],
  },
  "revenue-ttm": {
    outcome: "ready", subjects: [{ slot_id: "a", mention: "AAA" }],
    operations: [
      ...[0, 1, 2, 3].map((offset) => ({ node_id: `q${offset}`, operation: "reported_metric", subject_slot: "a", metric_key: "revenue", period: { kind: "latest", period_type: "quarterly", offset } })),
      { node_id: "ttm", operation: "trailing_sum", quarters: ["q0", "q1", "q2", "q3"] },
    ],
    outputs: [{ output_id: "out", node_id: "ttm" }], thresholds: [],
  },
};

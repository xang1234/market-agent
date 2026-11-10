// The Call eval (ADR 0005, "A Call has its own eval"). It scores generated
// Calls on their own rubric, never the research-quality one:
//
//   - every reason cites an input row;
//   - every input row is labelled with its kind and basis;
//   - the Call declines when the rules say it must (rule 0 on each input
//     outcome, rule 1 otherwise, until #605 anchors an exit multiple);
//   - it says no advice wording, and no stance wording leaks into a factual
//     answer.
//
// Deterministic: each case is assembled from fixed inputs with the function
// chat and the seal generate Calls with. The factual answers checked for
// stance wording are the server's own fixtures and fixed texts.
//
//   node --experimental-strip-types scripts/call-eval.ts
//
// Exits non-zero when any check fails.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  ADVICE_WORDS,
  assembleCall,
  CALL_INPUT_KINDS,
  DEFAULT_CALL_SETTINGS,
  SCENARIO_DISCLOSURE,
  STANCE_WORDS,
  type CallContent,
  type CallEngineFigure,
  type CallEvidence,
  type CallFactId,
  type CallRowId,
} from "../services/financial-core/src/index.ts";

export type CallCase = Readonly<{ id: string; evidence: CallEvidence; rule: 0 | 1; cites: ReadonlyArray<CallRowId> }>;

const TEN_K = "00000000-0000-4000-8000-0000000000a1";
const filing = (period_end: string) => ({ source_id: TEN_K, accession: "0000320193-26-000026", period_end, date: "2026-11-03" });

// ADR 0006's AAPL probe: F0, N and SBC from the FY2026 10-K, the cover count, and Friday's 342.37 close.
export const AAPL: CallEvidence = {
  call_date: "2026-11-09",
  subject: { issuer_id: "00000000-0000-4000-8000-0000000000d1", label: "AAPL" },
  settings: DEFAULT_CALL_SETTINGS,
  inputs: { snapshot_id: "00000000-0000-4000-8000-0000000000e1", run_id: "00000000-0000-4000-8000-0000000000e2", unit_id: "call", fingerprint: "f".repeat(64) },
  figures: {
    free_cash_flow: { kind: "value", value: "136056000000", currency: "USD" },
    net_cash: { kind: "value", value: "56824000000", currency: "USD" },
    stock_based_compensation: { kind: "value", value: "13789000000", currency: "USD" },
    shares_outstanding: { kind: "value", value: "14532182000", currency: null },
    share_price: { kind: "value", value: "342.37", currency: "USD" },
    market_cap: { kind: "value", value: "4975383151340", currency: "USD" },
  },
  citations: {
    free_cash_flow: [filing("2026-09-26")],
    net_cash: [filing("2026-09-26")],
    stock_based_compensation: [filing("2026-09-26")],
    shares_outstanding: [filing("2026-10-23")],
    share_price: [{ source_id: "00000000-0000-4000-8000-0000000000b1", accession: null, period_end: null, date: "2026-11-06" }],
  },
  fiscal_year_end: "2026-09-26",
  price_date: "2026-11-06",
  consensus: [{ source_id: "00000000-0000-4000-8000-0000000000c1", captured_on: "2026-11-09", eps_growth_next_5y: "8.18" }],
};

const FACTS: ReadonlyArray<CallFactId> = ["free_cash_flow", "net_cash", "stock_based_compensation", "shares_outstanding", "share_price"];
// Engine outcomes an input can publish instead of a value.
const ENGINE_OUTCOMES: ReadonlyArray<Extract<CallEngineFigure, { kind: "gap" }>> = [
  { kind: "gap", disposition: "missing", reason_code: "missing_input" },
  { kind: "gap", disposition: "missing", reason_code: "stale_input" },
  { kind: "gap", disposition: "blocked_dependency", reason_code: "blocked_by_dependency" },
  { kind: "gap", disposition: "incompatible", reason_code: "incompatible_period" },
  { kind: "gap", disposition: "incompatible", reason_code: "conflicting_evidence" },
];

/** AAPL as a full declined Call, NVDA's blocked free cash flow, each engine outcome on each input, and each input outcome the model finds. */
export const CALL_CASES: ReadonlyArray<CallCase> = [
  { id: "aapl", evidence: AAPL, rule: 1, cites: ["exit_multiple"] },
  { id: "aapl-no-consensus", evidence: { ...AAPL, consensus: [] }, rule: 1, cites: ["exit_multiple"] },
  { id: "nvda-free-cash-flow-blocked", evidence: with_("free_cash_flow", ENGINE_OUTCOMES[2]!), rule: 0, cites: ["free_cash_flow"] },
  ...FACTS.flatMap((fact) => ENGINE_OUTCOMES.map((outcome): CallCase => ({
    id: `${fact}-${outcome.reason_code}`,
    evidence: with_(fact, outcome),
    rule: 0,
    cites: [fact],
  }))),
  { id: "market-cap-not-certified", evidence: { ...AAPL, figures: { ...AAPL.figures, market_cap: ENGINE_OUTCOMES[0]! } }, rule: 0, cites: ["share_change"] },
  { id: "net-cash-other-filing", evidence: { ...AAPL, citations: { ...AAPL.citations, net_cash: [{ ...filing("2026-06-27"), source_id: "00000000-0000-4000-8000-0000000000a2" }] } }, rule: 0, cites: ["net_cash"] },
  { id: "stale-filing", evidence: { ...AAPL, fiscal_year_end: "2025-07-31", citations: { ...AAPL.citations, net_cash: [filing("2025-07-31")] } }, rule: 0, cites: ["free_cash_flow"] },
  { id: "stale-price", evidence: { ...AAPL, price_date: "2026-10-30" }, rule: 0, cites: ["share_price"] },
  { id: "non-positive-free-cash-flow", evidence: { ...AAPL, figures: { ...AAPL.figures, free_cash_flow: { kind: "value", value: "-1", currency: "USD" } } }, rule: 0, cites: ["free_cash_flow"] },
  { id: "non-usd-price", evidence: { ...AAPL, figures: { ...AAPL.figures, share_price: { kind: "value", value: "342.37", currency: "EUR" } } }, rule: 0, cites: ["share_price"] },
  { id: "no-multiple-today", evidence: { ...AAPL, figures: { ...AAPL.figures, net_cash: { kind: "value", value: "5000000000000", currency: "USD" } } }, rule: 1, cites: ["exit_multiple"] },
];

function with_(fact: CallFactId, figure: CallEngineFigure): CallEvidence {
  return { ...AAPL, figures: { ...AAPL.figures, [fact]: figure } };
}

/** What a Call fails of the rubric, each as "<check>: <detail>". */
export function scoreCall(call: CallContent, expected: Readonly<{ rule: 0 | 1; cites: ReadonlyArray<CallRowId> }>): string[] {
  const failures: string[] = [];
  const rows = [...call.facts, ...call.assumptions, ...call.requires];
  const ids = new Set(rows.map((row) => row.id));
  for (const reason of call.stance.reasons) {
    if (!ids.has(reason.cites)) failures.push(`reasons_cite_rows: ${reason.cites}`);
  }
  if (call.stance.reasons.length === 0) failures.push("reasons_cite_rows: no reason");
  for (const row of rows) {
    if (!(CALL_INPUT_KINDS as ReadonlyArray<string>).includes(row.kind)) failures.push(`rows_labelled: ${row.id} kind ${row.kind}`);
    if (row.basis.trim() === "") failures.push(`rows_labelled: ${row.id} has no basis`);
    if (row.kind === "agent_assumption" && !/^(?:judgment|anchored):/u.test(row.basis)) failures.push(`rows_labelled: ${row.id} basis is neither judgment nor anchored`);
  }
  for (const fact of call.facts) {
    if (fact.figure.kind === "value" && fact.citations.length === 0) failures.push(`rows_labelled: ${fact.id} cites nothing`);
  }
  const cites = call.stance.reasons.map((reason) => reason.cites);
  if (call.stance.rule !== expected.rule || cites.join() !== expected.cites.join()) {
    failures.push(`declines_when_required: rule ${call.stance.rule} citing ${cites.join(", ")}; expected rule ${expected.rule} citing ${expected.cites.join(", ")}`);
  }
  const text = JSON.stringify(call).replaceAll(/required return/giu, "");
  const advice = ADVICE_WORDS.exec(text) ?? STANCE_WORDS.exec(text);
  if (advice !== null) failures.push(`no_advice_wording: ${advice[0]}`);
  return failures;
}

/** The factual answers' texts that carry stance wording, by name. */
export function stanceLeaks(answers: Readonly<Record<string, string>>): string[] {
  return Object.entries(answers).flatMap(([name, text]) => STANCE_WORDS.test(text) ? [name] : []);
}

const WEB_FIXTURES = ["financialAnswer", "financialAnswer.fiscalCalendars", "financialAnswer.scenarios", "financialAnswer.v1", "scenarioPriceComparison"];

/** The server's factual answers on file: the financial answer and comparison fixtures it generated, and the scenario disclosure. */
export function factualAnswers(): Record<string, string> {
  const fixtures = Object.fromEntries(WEB_FIXTURES.map((name) => [name, readFileSync(new URL(`../web/src/blocks/${name}.fixture.json`, import.meta.url), "utf8")]));
  return { ...fixtures, scenario_disclosure: SCENARIO_DISCLOSURE };
}

export type CallEvalReport = Readonly<{
  passed: boolean;
  cases: ReadonlyArray<Readonly<{ id: string; rule: 0 | 1; failures: ReadonlyArray<string> }>>;
  factual_answers: number;
  stance_leaks: ReadonlyArray<string>;
}>;

export function buildCallReport(cases: ReadonlyArray<CallCase> = CALL_CASES, answers: Readonly<Record<string, string>> = factualAnswers()): CallEvalReport {
  const scored = cases.map((entry) => {
    const call = assembleCall(entry.evidence);
    return { id: entry.id, rule: call.stance.rule, failures: scoreCall(call, entry) };
  });
  const leaks = stanceLeaks(answers);
  return { passed: scored.every((entry) => entry.failures.length === 0) && leaks.length === 0, cases: scored, factual_answers: Object.keys(answers).length, stance_leaks: leaks };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const report = buildCallReport();
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.passed ? 0 : 1;
}

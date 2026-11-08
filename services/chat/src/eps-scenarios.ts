// P/E scenarios in chat (#201): a turn that states bear, base, and bull P/E
// multiples for one company gets a server-built plan that multiplies its
// reported diluted EPS by each. The multiples are read from the message only
// (input-side, like the cash-resilience trigger) and never defaulted: one not
// stated now is carried from the previous answer's sealed plan, with the
// attribution of the turn that stated it, or the turn is declined.

import {
  canonicalDecimalString,
  parseFinancialDecimal,
  SCENARIOS,
  type DecimalString,
  type FinancialPlan,
  type PeriodSelector,
  type PlanAssumption,
  type Scenario,
  type ScenarioAssumptions,
} from "../../financial-core/src/index.ts";
import { LATEST_FISCAL_YEAR } from "../../financial-engine/src/cash-resilience.ts";
import { buildDeterministicPlan, unresolvedSubjectClarification, type PlanningContext, type PlanningResult, type RequestedSubject } from "../../financial-engine/src/planner.ts";
import type { SqlExecutor } from "../../financial-engine/src/ports.ts";
import { labelList } from "./coordinator.ts";
import type { ScopeProposal } from "./research-scope.ts";
import { previousAnswer } from "./thread-context.ts";

export const SCENARIO_INPUTS = "scenario_inputs";
/** What the SCENARIO_INPUTS decline says: the ask that works, as the declined message may ask for something other than P/E. */
export const SCENARIO_DECLINE = "I can value P/E scenarios when you state one company and a P/E for each of bear, base and bull, for example “AAPL bear 20x, base 25x, bull 30x”, using reported diluted EPS for a fiscal year (FY2024, fiscal year 2024, or latest). Nothing was calculated.";
/** The decline of a P/E scenario ask that does not state one company and each multiple; nothing is run. */
export const SCENARIO_GAP: PlanningResult = { outcome: "unsupported", reason: SCENARIO_INPUTS, issues: [], model_calls: 0 };

/**
 * A message's P/E scenario ask, with how many of bear, base, and bull it
 * names: the multiples it states, or invalid when any word or number in it
 * falls outside the ask's closed sentence.
 */
export type ScenarioAsk = Readonly<{ labels: number }> & (StatedAsk | typeof INVALID);

type StatedAsk = Readonly<{
  invalid: false;
  /** Each scenario the message states, as a canonical positive decimal. */
  stated: Readonly<Partial<Record<Scenario, DecimalString>>>;
  /** The fiscal year the message names, "latest" when it asks for the latest, or null when it names neither. */
  fiscal_year: number | "latest" | null;
}>;

type Token =
  | Readonly<{ kind: "label"; scenario: Scenario }>
  | Readonly<{ kind: "number"; digits: string; times: boolean }>
  | Readonly<{ kind: "year"; year: number | "latest" }>
  | Readonly<{ kind: "pe" | "times" | "slash" | "filler" | "unknown" }>
  /** "EPS", "earnings", "per share": what the multiple applies to, never the multiple. */
  | Readonly<{ kind: "eps" }>
  /** A number written so it is no multiple: "2e1x", "NaN", "-20x", "$150". */
  | Readonly<{ kind: "malformed" }>;

const INVALID = { invalid: true } as const;
const PE: Token = { kind: "pe" };
const TIMES: Token = { kind: "times" };
const FILLER: Token = { kind: "filler" };
const UNKNOWN: Token = { kind: "unknown" };
const EPS: Token = { kind: "eps" };
const MALFORMED: Token = { kind: "malformed" };
const PE_WORDING = String.raw`p\s*\/\s*e|pe|price[- ]to[- ]earnings`;
// A P/E phrase or a fiscal year as one token, then a word (a ticker like
// "3m" or "brk.b", a number like "17.50x"), then any other character.
const TOKEN = new RegExp(String.raw`(?<![\p{L}\p{N}])(?:(?<pe>(?:${PE_WORDING})(?:\s+ratios?)?)|(?:fy\s?|fiscal\s+(?:year\s+)?)(?<year>\d+))(?![\p{L}\p{N}])|(?<word>[\p{L}\p{N}]+(?:[.'’&][\p{L}\p{N}]+)*)|(?<char>\S)`, "gu");
const NUMBER = /^(\d+(?:\.\d+)?)(x?)$/u;
// Every word a labelled ask may write besides its company's.
const WORDS: Readonly<Record<string, Token>> = {
  ...Object.fromEntries(SCENARIOS.map((scenario) => [scenario, { kind: "label", scenario }])),
  ...Object.fromEntries(["multiple", "multiples"].map((word) => [word, PE])),
  x: TIMES,
  times: TIMES,
  latest: { kind: "year", year: "latest" },
  ...Object.fromEntries(["earnings", "eps", "per", "share"].map((word) => [word, EPS])),
  ...Object.fromEntries(
    ("case scenario scenarios diluted reported annual of at on for and with use using what if were was is be make set change to now " +
      "the a an my i assume assuming give show me please about how would it look value values").split(" ").map((word) => [word, FILLER]),
  ),
};
const PUNCTUATION = new Set(",:;=?!.()\"'“”‘’-–—");
// The words and marks a label reaches its multiple through: "bull case is 50x", "base: 25", "bear earnings 6".
const CONNECTORS = new Set(["case", "scenario", "scenarios", "is", "was", "were", "be", "at", "of", "to", "earnings", "eps", ":", "="]);
const SIGNED = /\s*\d/uy;
// The one unlabelled scenario ask: P/E and exactly three multiples, as in "P/E 20/25/30".
const MULTIPLE = String.raw`(\d+(?:\.\d+)?)(?:\s*[x×])?`;
const UNLABELLED_LIST = new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${PE_WORDING}|multiples?)(?:\s+ratios?)?\s*(?:[:=]\s*|of\s+)?${MULTIPLE}\s*[\/,]\s*${MULTIPLE}(?:\s*[\/,]\s*(?:and\s+)?|\s+and\s+)${MULTIPLE}(?![\p{L}\p{N}]|\.\d|\s*(?:[\/,]|and\b)\s*\d)`, "u");
const MAX_MULTIPLE_LENGTH = 32;

/**
 * Reads the P/E scenarios a message states, or null when it asks for none.
 * A label decides only where it reaches a number through connectors ("bull
 * case is 50x", "bear/base/bull 20x/25x/30x"); "the bull and bear case for
 * NVDA in 2025" asks for none. A message with no such label asks only as the
 * unlabelled list "P/E 20/25/30", which states no scenario and is invalid. A
 * labelled ask is a closed sentence. Each word is a label, P/E wording, "x"
 * or "times", one fiscal year ("FY2024", "fiscal year 2024", "latest"), the
 * company it names (`company`, each name whole), small filler, or a multiple.
 * Each multiple follows its own label ("bear 20x") or its place in a grouped
 * list ("bear/base/bull 20x/25x/30x"), and more than one is a P/E only where
 * the message says so. Anything else is invalid.
 */
export function readScenarioAsk(text: string, company: ReadonlyArray<string>): ScenarioAsk | null {
  const names = company.map((name) => name.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\/]/gu, "\\$&")).filter(Boolean).sort((a, b) => b.length - a.length);
  const lower = names.length === 0 ? text.toLowerCase() : text.toLowerCase().replace(new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${names.join("|")})(?:['’]s)?(?![\p{L}\p{N}])`, "gu"), " ");
  const matches = [...lower.matchAll(TOKEN)];
  const tokens = matches.map(classify);
  const labels = new Set(tokens.flatMap((token) => token.kind === "label" ? [token.scenario] : [])).size;
  if (labels > 0 && labelReachesNumber(tokens, matches)) return { labels, ...labelledAsk(tokens) };
  return isUnlabelledList(lower) ? { labels, ...INVALID } : null;
}

// One pass from the end: whether each token reaches a number through connectors only.
function labelReachesNumber(tokens: ReadonlyArray<Token>, matches: ReadonlyArray<RegExpExecArray>): boolean {
  let reaches = false;
  for (let index = tokens.length - 1; index >= 0; index--) {
    const { kind } = tokens[index]!;
    if (kind === "label" && reaches) return true;
    reaches = kind === "number" || kind === "malformed" || (reaches && (kind === "pe" || kind === "slash" || CONNECTORS.has(matches[index]![0])));
  }
  return false;
}

function classify(match: RegExpExecArray): Token {
  const { pe, year, word, char } = match.groups!;
  if (pe !== undefined) return PE;
  if (year !== undefined) return /^20\d{2}$/u.test(year) ? { kind: "year", year: Number(year) } : UNKNOWN;
  if (word !== undefined) {
    const number = NUMBER.exec(word);
    if (number) return { kind: "number", digits: number[1]!, times: number[2] === "x" };
    const known = bare(word);
    return Object.hasOwn(WORDS, known) ? WORDS[known]! : /^(?:\d|nan$|inf(?:inity)?$)/u.test(known) ? MALFORMED : UNKNOWN;
  }
  // A sign, point, or currency before a number, spaced or not ("-20x", "- 20x", ".5x", "$150"), makes it no multiple.
  SIGNED.lastIndex = match.index + 1;
  if (/^[-–—+.$€£¥]$/u.test(char!) && SIGNED.test(match.input)) return MALFORMED;
  return char === "/" ? { kind: "slash" } : char === "×" ? TIMES : PUNCTUATION.has(char!) ? FILLER : UNKNOWN;
}

const bare = (word: string) => word.replace(/['’]s$/u, "");

// Labels wait for their multiples in order; only a slash chains a label onto
// one still waiting ("bear/base/bull"), so a label left waiting, or a number
// with none, is invalid.
function labelledAsk(tokens: ReadonlyArray<Token>): StatedAsk | typeof INVALID {
  const stated: Partial<Record<Scenario, DecimalString>> = {};
  const years = new Set<number | "latest">();
  const waiting: Scenario[] = [];
  let pe = false;
  let eps = false;
  for (const [index, token] of tokens.entries()) {
    switch (token.kind) {
      case "unknown":
      case "malformed":
        return INVALID;
      case "label":
        if (waiting.length > 0 && !(tokens[index - 1]?.kind === "slash" && tokens[index - 2]?.kind === "label")) return INVALID;
        waiting.push(token.scenario);
        break;
      case "number": {
        const scenario = waiting.shift();
        const value = positiveMultiple(token.digits);
        if (scenario === undefined || value === null || (stated[scenario] ?? value) !== value) return INVALID;
        stated[scenario] = value;
        pe ||= token.times;
        break;
      }
      case "eps":
        // "bull EPS 6" states an EPS, not a multiple.
        if (waiting.length > 0) return INVALID;
        eps = true;
        break;
      case "year":
        years.add(token.year);
        break;
      case "pe":
      case "times":
        pe = true;
        break;
    }
  }
  const [year = null, ...others] = years;
  // "bear 20 base 25 bull 30" with no P/E wording could be price targets, and "make bull 6 per share" an EPS.
  if (waiting.length > 0 || others.length > 0 || (!pe && (eps || Object.keys(stated).length > 1))) return INVALID;
  return { invalid: false, stated, fiscal_year: year };
}

// A list that is a year range ("P/E 2022/2023/2024"), a choice ("or"), or a question is not the scenario list.
function isUnlabelledList(lower: string): boolean {
  const list = UNLABELLED_LIST.exec(lower);
  return list !== null && !/\bor\b|\?/u.test(lower) && list.slice(1).every((value) => !/^(?:19|20)\d{2}$/u.test(value!) && positiveMultiple(value!) !== null);
}

function positiveMultiple(digits: string): DecimalString | null {
  const parsed = parseFinancialDecimal(digits.replace(/^0+(?=\d)/u, ""));
  if (!parsed.ok) return null;
  const value = canonicalDecimalString(parsed.value);
  return value === "0" || value.length > MAX_MULTIPLE_LENGTH ? null : value;
}

/** The previous answer's P/E scenario, as its sealed plan states it. */
export type PriorScenario = Readonly<{
  issuer_id: string;
  /** The fiscal year its EPS was bound to, or its plan's selector when none was bound. */
  earnings_period: PeriodSelector;
  assumptions: ScenarioAssumptions;
}>;

/**
 * The thread's previous answer, when it is a P/E scenario for one company:
 * the latest assistant message, if its block is a financial answer whose run
 * is this owner's in this thread and whose plan is v2. Anything else carries
 * nothing.
 */
export async function priorScenario(db: SqlExecutor, threadId: string, userId: string): Promise<PriorScenario | null> {
  const previous = await previousAnswer(db, threadId, userId);
  if (previous === null) return null;
  const { rows } = await db.query<{ plan: FinancialPlan; input_slot: string | null; fiscal_year: number | null }>(
    `select p.plan, i.input_slot, (i.bound_payload->'period'->>'fiscal_year')::int as fiscal_year
       from chat_messages m
       join financial_runs r on r.run_id::text = m.blocks->0->'financial'->>'run_id'
        and r.user_id = $2::uuid and r.parent_kind = 'chat_thread' and r.parent_id = $1::uuid
       join financial_plans p on p.plan_id = r.plan_id and p.user_id = r.user_id
       left join financial_run_inputs i on i.run_id = r.run_id and i.binding_status = 'bound'
      where m.thread_id = $1::uuid and m.role = 'assistant' and m.snapshot_id::text = $3 and m.blocks->0->>'kind' = 'financial_answer'`,
    [threadId, userId, previous.snapshot_id],
  );
  const plan = rows[0]?.plan;
  if (plan?.schema_version !== "financial_plan.v2" || plan.subjects.members.length !== 1) return null;
  const scenario = plan.operations.find((node) => node.operation === "scenario_eps_multiple");
  const earnings = plan.operations.find((node) => scenario && node.node_id === scenario.earnings);
  if (earnings?.operation !== "reported_metric") return null;
  const bound = rows.find((row) => row.input_slot === earnings.node_id)?.fiscal_year ?? null;
  return {
    issuer_id: plan.subjects.members[0]!.subject_ref.id,
    earnings_period: bound === null ? earnings.period : { kind: "fiscal_period", fiscal_year: bound, fiscal_period: "FY" },
    assumptions: plan.assumptions,
  };
}

/**
 * The P/E scenario a turn asks for, read against the companies it resolved.
 * One label is asked for only as a valid ask ("make bull 35"), which carries
 * the rest from a previous scenario for the same company or is declined;
 * one that is no valid ask is an ordinary question ("Is the bull 30x too
 * aggressive?").
 */
export function turnScenarioAsk(text: string, subjects: ReadonlyArray<RequestedSubject>): ScenarioAsk | null {
  const ask = readScenarioAsk(text, subjects.flatMap((subject) => subject.resolution.status === "resolved" ? [subject.mention, subject.resolution.label] : []));
  return ask?.labels === 1 && ask.invalid ? null : ask;
}

/**
 * The scenario plan for one resolved company, or the SCENARIO_INPUTS gap. Each
 * of bear, base, and bull is stated now, or carried from the previous answer
 * for the same company with its attribution. A plan that carries one reads
 * the fiscal year the previous answer's EPS was bound to, unless the message
 * names a year or the latest.
 */
export function planEpsScenarios(context: PlanningContext, ask: ScenarioAsk, prior: PriorScenario | null, receivedAt: string): PlanningResult {
  const question = unresolvedSubjectClarification(context);
  if (question) return { outcome: "needs_clarification", clarification: question, model_calls: 0 };
  const subjects = context.requested_subjects;
  const [subject] = subjects;
  if (subjects.length !== 1 || subject?.resolution.status !== "resolved" || ask.invalid) return SCENARIO_GAP;
  const carry = prior?.issuer_id.toLowerCase() === subject.resolution.subject_ref.id.toLowerCase() ? prior : null;
  const attribution = { kind: "user_request", ref: context.origin.ref, captured_at: receivedAt } as const;
  const assumptions = SCENARIOS.map((scenario): PlanAssumption | null => {
    const value = ask.stated[scenario];
    if (value !== undefined) return { assumption_id: `pe_${scenario}`, scenario, value, attribution };
    return carry?.assumptions.find((assumption) => assumption.scenario === scenario) ?? null;
  });
  if (assumptions.some((assumption) => assumption === null)) return SCENARIO_GAP;
  const carried = assumptions.some((assumption) => assumption!.attribution.ref !== context.origin.ref);
  const period: PeriodSelector = typeof ask.fiscal_year === "number"
    ? { kind: "fiscal_period", fiscal_year: ask.fiscal_year, fiscal_period: "FY" }
    : ask.fiscal_year === null && carried ? carry!.earnings_period : LATEST_FISCAL_YEAR;
  return buildDeterministicPlan(context, {
    subjects: [{ slot_id: "s0", mention: subject.mention }],
    operations: [
      { node_id: "eps", operation: "reported_metric", subject_slot: "s0", metric_key: "eps_diluted", period },
      ...assumptions.map((assumption) => ({ node_id: assumption!.scenario, operation: "scenario_eps_multiple", earnings: "eps", assumption_id: assumption!.assumption_id })),
    ],
    outputs: SCENARIOS.map((scenario) => ({ output_id: `out_${scenario}`, node_id: scenario })),
    thresholds: [],
    assumptions,
  });
}

/**
 * What a P/E scenario answer covers and notes, by its saved plan, as a retry
 * that resumes the run does not plan again: the P/E the question names is
 * answered by the user's multiples, not at the current price, and the note
 * names the multiples carried from the previous answer and the latest fiscal
 * year when the plan reads it. Any other plan keeps the reading as it is.
 */
export function scenarioAnswer(plan: FinancialPlan | null, reading: ScopeProposal | null): Readonly<{ reading: ScopeProposal | null; notes: string[] }> {
  if (plan?.assumptions === undefined) return { reading, notes: [] };
  const carried = plan.assumptions.filter((assumption) => assumption.attribution.ref !== plan.origin.ref).map((assumption) => assumption.scenario);
  const latest = plan.operations.some((node) => node.operation === "reported_metric" && node.period.kind === "latest");
  const list = labelList(carried);
  return {
    reading: reading && { ...reading, metrics: reading.metrics.filter((metric) => metric.metric_key !== "pe_ratio") },
    notes: [
      ...(carried.length === 0 ? [] : [`${list[0]!.toUpperCase()}${list.slice(1)} P/E ${carried.length > 1 ? "are" : "is"} carried from the previous answer.`]),
      ...(latest ? ["The latest fiscal year's diluted EPS is used."] : []),
    ],
  };
}

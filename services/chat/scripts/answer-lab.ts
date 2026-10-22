// Answer lab: re-runs recorded answer turns (services/chat/src/answer-trace.ts)
// through today's post-processing, with the recorded model reply (recorded) or
// fresh replies from the live model (live), and tabulates what the answer shows.
//
//   node --experimental-strip-types scripts/answer-lab.ts recorded <trace dir|files...> [--check | --update] [--judge]
//   node --experimental-strip-types scripts/answer-lab.ts live <trace dir|files...> [--samples K] [--concurrency N] [--against <run.json>] [--judge]
//   node --experimental-strip-types scripts/answer-lab.ts replies <trace dir|files...> --out <file>
//   node --experimental-strip-types scripts/answer-lab.ts judge-mutations <set.json> [--concurrency N]
//
// replies writes the traces' model replies as an LLM_REPLAY_FILE fixture, so the
// no-keys stack (DEV_NO_KEYS=traces) answers each traced question as recorded;
// recorded is deterministic and offline: each trace's answer reply and judge
// reply as recorded; --check exits 1 when a replay's blocks differ from the
// recorded ones; --update writes each replay over its trace (blocks,
// assertions, judge), for a deliberate change to post-processing. live uses the stack's LLM settings
// (LLM_SETTINGS_ENV_FILE, default .env.dev, as dev-shell sets it) and writes
// docs/eval-runs/answer-lab/<stamp>.json. --judge has the judge model
// (JUDGE_LITELLM_MODEL, src/inference-judge.ts) read each answer's accepted
// inferences against what they rest on, as chat does: in recorded mode in place
// of the recorded reply (with --update, recording its reply), in live mode in
// place of none, which shows no inference. Each run summarizes what the judge
// showed and hid. judge-mutations
// judges a set of inferences and their mutations
// (test/answer-lab/judge-mutations.json) and reports how many mutations it
// catches, how many come back at their kind's tier, how many it would show
// that should hide, and how many originals it flags.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";

import { LlmRouterError } from "../../llm/src/index.ts";
import type { LlmReplayFixture } from "../../llm/src/replay-client.ts";
import { assertionList, checkAssertions, type AssertionKind } from "../src/assertions.ts";
import {
  answerMetrics,
  composeTraced,
  inferenceCases,
  judgeAnswer,
  judgedAnswer,
  replayRecorded,
  type AnswerMetrics,
  type ModelExchange,
  type TracedAnswer,
  type TurnTrace,
} from "../src/answer-trace.ts";
import {
  judgeCases,
  judgeInferences,
  shownAs,
  VERDICTS,
  verdictsOf,
  verdictText,
  type InferenceVerdict,
  type JudgeCase,
  type JudgeRecord,
  type ShownAs,
  type Verdict,
} from "../src/inference-judge.ts";
import { turnPacket } from "../src/llm-runtime.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const RUNS_DIR = join(ROOT, "docs/eval-runs/answer-lab");

// key: the turn the trace records, which rows and comparisons match on;
// label: its file name, shown only.
export type LabeledTrace = { key: string; label: string; file: string; trace: TurnTrace };

export function traceKey(trace: Pick<TurnTrace, "thread_id" | "run_id" | "turn_id">): string {
  return `${trace.thread_id}/${trace.run_id}${trace.turn_id ? `.${trace.turn_id}` : ""}`;
}

// Every *.json under each path (a trace or a directory of them). One turn
// given twice is an error rather than a guess at which to keep.
export function readTraces(paths: ReadonlyArray<string>): LabeledTrace[] {
  const files = paths.flatMap((path) =>
    statSync(path).isDirectory()
      ? readdirSync(path, { recursive: true, encoding: "utf8" }).filter((name) => name.endsWith(".json")).sort().map((name) => join(path, name))
      : [path]
  );
  const seen = new Map<string, string>();
  return files.map((file) => {
    const trace = JSON.parse(readFileSync(file, "utf8")) as TurnTrace;
    const id = (value: unknown) => typeof value === "string" && /^[\w-]+$/.test(value);
    if (!id(trace.thread_id) || !id(trace.run_id) || (trace.turn_id !== undefined && !id(trace.turn_id))) {
      throw new Error(`${file} is not a turn trace: it needs thread_id and run_id (services/chat/src/answer-trace.ts)`);
    }
    const key = traceKey(trace);
    const earlier = seen.get(key);
    if (earlier !== undefined) throw new Error(`turn ${key} is given twice: ${earlier} and ${file}`);
    seen.set(key, file);
    return { key, label: basename(file, ".json"), file, trace };
  });
}

type SampleMetrics = AnswerMetrics;
type Column = keyof AnswerMetrics;
type Row = { key: string; label: string } & { [K in Column]?: number };
const COLUMNS: ReadonlyArray<[Column, string]> = [
  ["figure_refs", "refs"],
  ["plain_numbers", "plain#"],
  ["fallback", "fallback"],
  ["accepted", "accepted"],
  ["rejected", "rejected"],
  ["inferences_shown", "inf shown"],
  ["inferences_unverified", "inf unverified"],
  ["inferences_hidden", "inf hidden"],
  ["output_tokens", "out tok"],
  ["latency_ms", "latency ms"],
];

// A trace's row: the mean of its samples.
function meanRow(trace: { key: string; label: string }, samples: ReadonlyArray<SampleMetrics>, columns = COLUMNS): Row {
  const mean = (key: Column) =>
    samples.length === 0 ? 0 : samples.reduce((sum, metrics) => sum + Number(metrics[key] ?? 0), 0) / samples.length;
  return Object.fromEntries([["key", trace.key], ["label", trace.label], ...columns.map(([key]) => [key, mean(key)])]) as Row;
}

// Counts add up across traces; tokens and latency are per answer.
function totalRow(rows: ReadonlyArray<Row>, columns = COLUMNS): Row {
  const total = Object.fromEntries([["key", ""], ["label", "total"], ...columns.map(([key]) => [key, rows.reduce((sum, row) => sum + (row[key] ?? 0), 0)])]) as Row;
  if (rows.length > 0) {
    total.output_tokens = (total.output_tokens ?? 0) / rows.length;
    total.latency_ms = (total.latency_ms ?? 0) / rows.length;
  }
  return total;
}

const format = (n: number | undefined) => (n === undefined ? "" : Number.isInteger(n) ? String(n) : n.toFixed(1));

function table(rows: ReadonlyArray<Row>, extra: (row: Row) => string = () => "", columns = COLUMNS): string {
  const all = [...rows, totalRow(rows, columns)];
  const header = ["trace", ...columns.map(([, title]) => title)];
  const cells = all.map((row) => [row.label, ...columns.map(([key]) => format(row[key]))]);
  const widths = header.map((title, i) => Math.max(title.length, ...cells.map((line) => line[i]!.length)));
  const line = (values: string[]) => values.map((value, i) => (i === 0 ? value.padEnd(widths[i]!) : value.padStart(widths[i]!))).join("  ");
  return [line(header), ...cells.map((values, i) => `${line(values)}${i < rows.length ? extra(all[i]!) : ""}`)].join("\n");
}

function delta(before: Row, after: Row): string {
  return [
    `${"metric".padEnd(14)} ${"before".padStart(7)} ${"after".padStart(8)} ${"delta".padStart(8)}`,
    ...COLUMNS.map(([key, title]) => {
      const change = (after[key] ?? 0) - (before[key] ?? 0);
      return `${title.padEnd(14)} ${format(before[key]).padStart(7)} ${format(after[key]).padStart(8)} ${`${change > 0 ? "+" : ""}${format(change)}`.padStart(8)}`;
    }),
  ].join("\n");
}

// Each trace replayed with its recorded replies, the answer model's and the
// judge's; differs: the blocks are not the recorded ones. judge: the live judge
// reads each replay's inferences instead, and --update records its reply.
// judge_input_changed: today's answer asks the recorded judge something else.
async function recorded(
  traces: ReadonlyArray<LabeledTrace>,
  update = false,
  judge = false,
): Promise<Array<{ key: string; label: string; metrics: SampleMetrics; differs: boolean; judge_input_changed: boolean; judge?: JudgeView }>> {
  const results = [];
  for (const { key, label, file, trace } of traces) {
    const { judge_input_changed, ...replayed } = await replayRecorded(trace, judge ? { env: liveEnv() } : undefined);
    if (update) writeFileSync(file, `${JSON.stringify(replayed, null, 2)}\n`);
    const view = judgeView(replayed);
    results.push({
      key,
      label,
      metrics: answerMetrics(replayed),
      differs: !isDeepStrictEqual(JSON.parse(JSON.stringify(replayed.blocks)), trace.blocks),
      judge_input_changed,
      ...(view ? { judge: view } : {}),
    });
  }
  return results;
}

// The stack's LLM settings, as dev-shell sets them.
function liveEnv(): Record<string, string | undefined> {
  return { ...process.env, LLM_SETTINGS_ENV_FILE: process.env.LLM_SETTINGS_ENV_FILE ?? join(ROOT, ".env.dev") };
}

// flagged: each inference the judge showed as unverified or left out, in
// index order; reason: its verdict and reason, or why no verdict came.
type FlaggedInference = { index: number; as: Exclude<ShownAs, "shown">; text: string; reason: string };
export type JudgeView = { records: ReadonlyArray<JudgeRecord>; flagged: FlaggedInference[] };

function judgeView(answer: Pick<TracedAnswer, "judge" | "assertions">): JudgeView | undefined {
  if (!answer.judge) return undefined;
  const report = answer.assertions;
  const text = (index: number) => [...(report?.accepted ?? []), ...(report?.rejected ?? [])].find((entry) => entry.index === index)?.text ?? "";
  const flagged = (report?.judged ?? []).flatMap((verdict): FlaggedInference[] => {
    const as = shownAs(verdict);
    return as === "shown" ? [] : [{ index: verdict.index, as, text: text(verdict.index), reason: verdictText(verdict) }];
  });
  return { records: answer.judge, flagged };
}

// text: the model's raw reply; answer: the rich_text the user reads, each
// value as displayed; assertions: what rendering accepted, by kind, why the
// rest went, and how many accepted observations a comparison already showed.
type LiveSample = {
  trace: string;
  sample: number;
  deployment?: string;
  metrics?: SampleMetrics;
  text?: string;
  answer?: string;
  assertions?: { rendered: boolean; accepted: AssertionKind[]; rejected: string[]; repeated?: number };
  judge?: JudgeView;
  error?: string;
};
// traces: the turns' keys; labels: their file names, for display.
type LiveRun = {
  run: string;
  samples: number;
  judged?: boolean;
  wall_ms: number;
  traces: string[];
  labels?: Record<string, string>;
  results: LiveSample[];
};

const GOLDEN_REPLIES = fileURLToPath(new URL("../test/golden/llm-replies.json", import.meta.url));

// Each traced question answered by its recorded reply. A reply matches by
// substring, so it keys on the answer request's own `"question":"..."` field:
// the question alone would match a later turn whose history repeats it. The
// golden fixture's thread-title reply goes first, as the title request quotes
// the question too.
export function replyFixture(traces: ReadonlyArray<LabeledTrace>, golden: LlmReplayFixture): LlmReplayFixture {
  const answers = traces.flatMap(({ trace }) =>
    trace.exchange?.text ? [{ match: `"question":${JSON.stringify(trace.question)}`, text: trace.exchange.text }] : []
  );
  return { replies: [...golden.replies.filter((reply) => reply.match.startsWith("Create a short")), ...answers] };
}

// The rich_text blocks as read: text as written, each ref its displayed value.
export function answerText(blocks: ReadonlyArray<Record<string, unknown>>): string {
  return blocks.filter((block) => block.kind === "rich_text")
    .map((block) => (Array.isArray(block.segments) ? block.segments as Array<{ type?: string; text?: string; format?: string }> : [])
      .map((segment) => (segment.type === "text" ? segment.text ?? "" : segment.format ?? "")).join(""))
    .join("\n\n");
}

async function live(traces: ReadonlyArray<LabeledTrace>, samples: number, concurrency: number, judge = false): Promise<LiveRun> {
  const startedAt = Date.now();
  const jobs = traces.flatMap(({ key, label, trace }) => Array.from({ length: samples }, (_, sample) => ({ key, label, trace, sample })));
  const results: LiveSample[] = [];
  const worker = async () => {
    for (let job = jobs.shift(); job; job = jobs.shift()) {
      const { key, label, trace, sample } = job;
      try {
        const env = liveEnv();
        const composed = await composeTraced(trace.input, { env });
        // No deployment configured: the placeholder came back and no model answered.
        if (composed.exchange === null) throw new Error("no model was called (no deployable LLM in the settings)");
        const { cases, companies } = inferenceCases(trace.input, composed.assertions);
        const answer = judgedAnswer(composed, cases, judge ? await judgeAnswer(cases, companies, { env }) : cases.map(() => UNJUDGED));
        const view = judge ? judgeView(answer) : undefined;
        results.push({
          trace: key,
          sample,
          deployment: answer.exchange?.deployment,
          metrics: answerMetrics(answer),
          text: answer.exchange?.text,
          answer: answerText(answer.blocks),
          ...(answer.assertions
            ? {
              assertions: {
                rendered: answer.assertions.rendered === true,
                accepted: answer.assertions.accepted.map((entry) => entry.kind),
                rejected: answer.assertions.rejected.map((entry) => entry.reason),
                ...(answer.assertions.repeated ? { repeated: answer.assertions.repeated.length } : {}),
              },
            }
            : {}),
          ...(view ? { judge: view } : {}),
        });
        console.log(`done  ${label} #${sample}  (${((answer.exchange?.latency_ms ?? 0) / 1000).toFixed(1)}s)`);
      } catch (error) {
        results.push({ trace: key, sample, error: failure(error) });
        console.log(`error ${label} #${sample}: ${failure(error)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  const order = new Map(traces.map(({ key }, i) => [key, i]));
  results.sort((a, b) => order.get(a.trace)! - order.get(b.trace)! || a.sample - b.sample);
  return {
    run: new Date(startedAt).toISOString().slice(0, 19).replace(/:/g, ""),
    samples,
    ...(judge ? { judged: true } : {}),
    wall_ms: Date.now() - startedAt,
    traces: traces.map(({ key }) => key),
    labels: Object.fromEntries(traces.map(({ key, label }) => [key, label])),
    results,
  };
}

// A run without --judge shows what a reader with no judge would: no inference.
const UNJUDGED: JudgeRecord = { outcome: "not_called", reason: "the run was not judged (--judge)" };

// Each attempt's deployment and code: the router's message alone names neither.
function failure(error: unknown): string {
  if (error instanceof LlmRouterError) {
    return `${error.message} (${error.attempts.map((attempt) => `${attempt.deployment.channel}/${attempt.deployment.model}: ${attempt.code}`).join("; ")})`;
  }
  return error instanceof Error ? error.message : String(error);
}

// How many answers were rendered, the kinds rendering accepted, and the
// rejections by reason, most frequent first.
export function assertionSummary(run: Pick<LiveRun, "results">): string {
  const answered = run.results.filter((result) => result.metrics);
  const count = (values: ReadonlyArray<string>) =>
    [...values.reduce((counts, value) => counts.set(value, (counts.get(value) ?? 0) + 1), new Map<string, number>())]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const rendered = answered.filter((result) => result.assertions?.rendered).length;
  const kinds = count(answered.flatMap((result) => result.assertions?.accepted ?? []));
  const reasons = count(answered.flatMap((result) => result.assertions?.rejected ?? []));
  const repeated = answered.reduce((sum, result) => sum + (result.assertions?.repeated ?? 0), 0);
  return [
    `rendered: ${rendered} of ${answered.length} answers`,
    `accepted: ${kinds.map(([kind, n]) => `${n} ${kind}`).join(", ") || "none"}`,
    `repeated: ${repeated} observations a comparison already shows`,
    "rejected:",
    ...reasons.map(([reason, n]) => `  ${String(n).padStart(3)}  ${reason}`),
  ].join("\n");
}

// A row per trace with an answer; a trace whose every sample failed has none.
function liveRows(run: LiveRun, keys: ReadonlyArray<string> = run.traces): Row[] {
  return keys.flatMap((key) => {
    const answered = run.results.flatMap((result) => (result.trace === key && result.metrics ? [result.metrics] : []));
    return answered.length > 0 ? [meanRow({ key, label: run.labels?.[key] ?? key }, answered)] : [];
  });
}

export function judgeSummary(run: Pick<LiveRun, "labels"> & { results: ReadonlyArray<Pick<LiveSample, "trace" | "sample" | "metrics" | "judge">> }): string {
  const judged = run.results.filter((result) => result.judge);
  const records = judged.flatMap((result) => result.judge!.records);
  const outcomes = (outcome: JudgeRecord["outcome"]) => records.filter((record) => record.outcome === outcome).length;
  // A trace from before #376 recorded one call for all its inferences, which
  // replays as each one's record: its cost counts once.
  const replies = [...new Set(records.flatMap((record) => (record.outcome === "replied" ? [record.exchange] : [])))];
  const sum = (key: "inferences_shown" | "inferences_unverified" | "inferences_hidden") => judged.reduce((total, result) => total + (result.metrics?.[key] ?? 0), 0);
  const mean = (values: ReadonlyArray<number>) => (values.length === 0 ? 0 : Math.round(values.reduce((total, value) => total + value, 0) / values.length));
  return [
    `judge: ${sum("inferences_shown")} shown, ${sum("inferences_unverified")} unverified, ${sum("inferences_hidden")} hidden, in ${judged.length} answers (${outcomes("replied")} replied, ${outcomes("failed")} failed, ${outcomes("not_called")} not called)`,
    `judge per reply: ${mean(replies.map((reply) => reply.latency_ms))} ms, ${mean(replies.map((reply) => reply.usage?.input_tokens ?? 0))} in / ${mean(replies.map((reply) => reply.usage?.output_tokens ?? 0))} out tokens, on ${[...new Set(replies.map((reply) => reply.deployment))].join(", ") || "no model"}`,
    ...judged.flatMap((result) => result.judge!.flagged.map((entry) =>
      `  ${entry.as}  ${run.labels?.[result.trace] ?? result.trace} #${result.sample} [${entry.index}] ${entry.text}\n      ${entry.reason}`
    )),
  ].join("\n");
}

// What each kind of mutation must come back as: a worded amount flagged, at
// any verdict, and the others at a verdict, with no worded amount.
type Expected = { worded_amount: true } | { worded_amount: false; verdict: Verdict };
export const MUTATION_TIERS = {
  worded_amount: { worded_amount: true },
  unsupported_claim: { worded_amount: false, verdict: "unsupported" },
  hedged_valuation: { worded_amount: false, verdict: "unsupported" },
  flipped_direction: { worded_amount: false, verdict: "contradicted" },
  contradicted_ranking: { worded_amount: false, verdict: "contradicted" },
} as const satisfies Record<string, Expected>;
type MutationKind = keyof typeof MUTATION_TIERS;
const ORIGINAL: Expected = { worded_amount: false, verdict: "entailed" };
type MutationSet = {
  cases: Array<{
    id: string;
    // Relative to the set's file.
    trace: string;
    // The trace's assertion the case stands in place of.
    index: number;
    supports: number[];
    subject?: string;
    // Inferences its supports back.
    originals: string[];
    mutations: Array<{ kind: MutationKind; text: string }>;
  }>;
};

// One inference of the set as the judge reads it: an original, which its
// supports back, or a mutation, which they do not.
export type MutationVariant = { id: string; kind: "original" | MutationKind; judged: JudgeCase; companies: ReadonlyArray<string> };

function expectedOf(kind: MutationVariant["kind"]): Expected {
  return kind === "original" ? ORIGINAL : MUTATION_TIERS[kind];
}

function verdictsAllowed(expected: Expected): ReadonlyArray<Verdict> {
  return expected.worded_amount ? VERDICTS : [expected.verdict];
}

// Each case's original and mutations on its trace's packet, through the
// turn's own checks. One those checks reject is no gap of theirs, so it fails
// the set rather than inflate the catch rate.
export function mutationVariants(file: string): MutationVariant[] {
  const set = JSON.parse(readFileSync(file, "utf8")) as MutationSet;
  return set.cases.flatMap((entry) => {
    const trace = JSON.parse(readFileSync(resolve(dirname(file), entry.trace), "utf8")) as TurnTrace;
    const packet = turnPacket(trace.input);
    const factBlocks = trace.input.factBlocks ?? [];
    const list = assertionList(trace.exchange?.text ?? "");
    if (!Array.isArray(list) || entry.index >= list.length) throw new Error(`${entry.id}: ${entry.trace} has no assertion ${entry.index}`);
    const variants = [...entry.originals.map((text) => ({ kind: "original" as const, text })), ...entry.mutations];
    return variants.map(({ kind, text }) => {
      if (kind !== "original" && !Object.hasOwn(MUTATION_TIERS, kind)) throw new Error(`${entry.id}: unknown mutation kind ${JSON.stringify(kind)}`);
      const inference = { kind: "analyst_inference", text, evidence: [], supports: entry.supports, ...(entry.subject ? { subject: entry.subject } : {}) };
      const report = checkAssertions(list.with(entry.index, inference), packet);
      const accepted = report.accepted.find((assertion) => assertion.index === entry.index);
      if (accepted?.supports?.length !== entry.supports.length) {
        const reason = report.rejected.find((rejection) => rejection.index === entry.index)?.reason ?? "a support was not accepted";
        throw new Error(`${entry.id} ${kind}: the turn's checks reject it (${reason}); the set holds only inferences they pass`);
      }
      return { id: entry.id, kind, judged: judgeCases(report.accepted, packet, factBlocks).find((judged) => judged.index === entry.index)!, companies: packet.companies };
    });
  });
}

type MutationResult = { id: string; kind: MutationVariant["kind"]; text: string; verdict: InferenceVerdict; deployment: string | null; latency_ms: number; usage?: ModelExchange["usage"] };

// Each inference judged alone, as an answer of one.
async function judgeMutations(variants: ReadonlyArray<MutationVariant>, concurrency: number): Promise<MutationResult[]> {
  const jobs = [...variants];
  const results: MutationResult[] = [];
  const worker = async () => {
    for (let job = jobs.shift(); job; job = jobs.shift()) {
      const { id, kind, judged, companies } = job;
      const record = await judgeInferences({ cases: [judged], companies, env: liveEnv() });
      const verdict = verdictsOf([judged], record)[0]!;
      const cost = record.outcome === "replied"
        ? { deployment: record.exchange.deployment, latency_ms: record.exchange.latency_ms, ...(record.exchange.usage ? { usage: record.exchange.usage } : {}) }
        : { deployment: null, latency_ms: record.outcome === "failed" ? record.latency_ms : 0 };
      results.push({ id, kind, text: judged.text, verdict, ...cost });
      console.log(`${id} ${kind}: ${verdictText(verdict)}`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return variants.map((variant) => results.find((result) => result.id === variant.id && result.text === variant.judged.text)!);
}

// "shown though they should hide" is the safety number: a contradiction or a
// worded amount on the page. An error is neither caught nor at its tier, and
// is counted on its own.
export function mutationSummary(results: ReadonlyArray<Pick<MutationResult, "id" | "kind" | "text" | "verdict">>): string {
  type Row = Pick<MutationResult, "kind" | "verdict">;
  const rate = (rows: ReadonlyArray<Row>, counted: (row: Row) => boolean) => `${rows.filter(counted).length} of ${rows.length}`;
  const errors = (rows: ReadonlyArray<Row>) => rows.filter((row) => row.verdict.verdict === "error").length;
  const flagged = (row: Row) => row.verdict.verdict !== "error" && shownAs(row.verdict) !== "shown";
  const atTier = ({ kind, verdict }: Row) => {
    const expected = expectedOf(kind);
    return verdict.verdict !== "error" && verdict.worded_amount === expected.worded_amount && verdictsAllowed(expected).includes(verdict.verdict);
  };
  const hides = (expected: Expected) =>
    verdictsAllowed(expected).every((verdict) => shownAs({ index: 0, verdict, worded_amount: expected.worded_amount }) === "hidden");
  const mutations = results.filter((result) => result.kind !== "original");
  const originals = results.filter((result) => result.kind === "original");
  const shouldHide = mutations.filter((result) => hides(expectedOf(result.kind)));
  const missed = results.filter((result) => !atTier(result));
  return [
    `caught: ${rate(mutations, flagged)} mutations (${errors(mutations)} errors)`,
    `at their tier: ${rate(mutations, atTier)} mutations`,
    ...Object.entries(MUTATION_TIERS).map(([kind, expected]) =>
      `  ${kind.padEnd(22)} ${(expected.worded_amount ? "worded_amount" : expected.verdict).padEnd(14)}${rate(mutations.filter((result) => result.kind === kind), atTier)}`
    ),
    `shown though they should hide: ${rate(shouldHide, (row) => shownAs(row.verdict) !== "hidden")}`,
    `false alarms: ${rate(originals, flagged)} originals (${errors(originals)} errors)`,
    ...(missed.length > 0 ? ["not at their expected outcome:"] : []),
    ...missed.map((result) => `  ${result.id} ${result.kind}: ${verdictText(result.verdict)}\n      ${result.text}`),
  ].join("\n");
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      check: { type: "boolean", default: false },
      update: { type: "boolean", default: false },
      samples: { type: "string", default: "1" },
      concurrency: { type: "string", default: "2" },
      against: { type: "string" },
      out: { type: "string" },
      judge: { type: "boolean", default: false },
    },
  });
  const [mode, ...paths] = positionals;
  if (
    (mode !== "recorded" && mode !== "live" && mode !== "replies" && mode !== "judge-mutations") || paths.length === 0 ||
    (mode === "replies" && !values.out) || (mode === "judge-mutations" && paths.length !== 1)
  ) {
    console.error("usage: answer-lab.ts recorded <trace dir|files...> [--check | --update] [--judge] | live <trace dir|files...> [--samples K] [--concurrency N] [--against <run.json>] [--judge] | replies <trace dir|files...> --out <file> | judge-mutations <set.json> [--concurrency N]");
    return 2;
  }
  if (mode === "judge-mutations") {
    let variants: MutationVariant[];
    try {
      variants = mutationVariants(paths[0]!);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      return 2;
    }
    const startedAt = Date.now();
    const results = await judgeMutations(variants, Math.max(1, Number.parseInt(values.concurrency, 10) || 1));
    const run = new Date(startedAt).toISOString().slice(0, 19).replace(/:/g, "");
    mkdirSync(RUNS_DIR, { recursive: true });
    const file = join(RUNS_DIR, `${run}.judge-mutations.json`);
    writeFileSync(file, `${JSON.stringify({ run, set: paths[0], wall_ms: Date.now() - startedAt, results }, null, 2)}\n`, { flag: "wx" });
    const called = results.filter((result) => result.deployment !== null);
    const mean = (values: ReadonlyArray<number>) => (values.length === 0 ? 0 : Math.round(values.reduce((sum, value) => sum + value, 0) / values.length));
    console.log(`\n${mutationSummary(results)}\n\njudged on ${[...new Set(called.map((result) => result.deployment))].join(", ") || "no model"}: ${mean(called.map((result) => result.latency_ms))} ms, ${mean(called.map((result) => result.usage?.input_tokens ?? 0))} in / ${mean(called.map((result) => result.usage?.output_tokens ?? 0))} out tokens per inference; ${file}`);
    return results.some((result) => result.verdict.verdict === "error") ? 1 : 0;
  }
  let traces: LabeledTrace[];
  try {
    traces = readTraces(paths);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  if (mode === "replies") {
    const golden = JSON.parse(readFileSync(GOLDEN_REPLIES, "utf8")) as LlmReplayFixture;
    writeFileSync(values.out!, `${JSON.stringify(replyFixture(traces, golden), null, 2)}\n`);
    console.log(`${traces.length} traced replies written to ${values.out}`);
    return 0;
  }
  if (mode === "recorded") {
    const results = await recorded(traces, values.update, values.judge);
    const differs = new Set(results.filter((result) => result.differs).map((result) => result.key));
    const drifted = new Set(results.filter((result) => result.judge_input_changed).map((result) => result.key));
    const flag = (key: string) => `${differs.has(key) ? "  DIFFERS" : ""}${drifted.has(key) ? "  JUDGE INPUT CHANGED" : ""}`;
    console.log(table(results.map((result) => meanRow(result, [result.metrics])), (row) => flag(row.key)));
    console.log(`\n${traces.length - differs.size} of ${traces.length} replayed to the recorded blocks`);
    const run: LiveRun = {
      run: new Date().toISOString().slice(0, 19).replace(/:/g, ""),
      samples: 1,
      ...(values.judge ? { judged: true } : {}),
      wall_ms: 0,
      traces: traces.map(({ key }) => key),
      labels: Object.fromEntries(traces.map(({ key, label }) => [key, label])),
      results: results.map(({ key, metrics, judge }) => ({ trace: key, sample: 0, metrics, ...(judge ? { judge } : {}) })),
    };
    if (run.results.some((result) => result.judge)) console.log(`\n${values.judge ? "judged live" : "as recorded"}, ${judgeSummary(run)}`);
    if (values.judge) {
      mkdirSync(RUNS_DIR, { recursive: true });
      const file = join(RUNS_DIR, `${run.run}.recorded-judge.json`);
      writeFileSync(file, `${JSON.stringify(run, null, 2)}\n`, { flag: "wx" });
      console.log(file);
    }
    return values.check && differs.size > 0 ? 1 : 0;
  }
  const samples = Number.parseInt(values.samples, 10);
  const concurrency = Number.parseInt(values.concurrency, 10);
  if (!(samples > 0) || !(concurrency > 0)) {
    console.error("--samples and --concurrency take a positive integer");
    return 2;
  }
  // Read before the model is called, so a baseline that cannot match costs no run.
  const before = values.against === undefined ? undefined : JSON.parse(readFileSync(values.against, "utf8")) as LiveRun;
  // A run from before traces were keyed by turn names them by file: nothing would match.
  if (before && before.labels === undefined) {
    console.error(`${values.against} is from an older answer-lab whose traces are not keyed by turn; rerun it`);
    return 2;
  }
  const run = await live(traces, samples, concurrency, values.judge);
  mkdirSync(RUNS_DIR, { recursive: true });
  const file = join(RUNS_DIR, `${run.run}.json`);
  writeFileSync(file, `${JSON.stringify(run, null, 2)}\n`, { flag: "wx" });
  const rows = liveRows(run);
  const errors = run.results.filter((result) => result.error).length;
  const unanswered = run.traces.filter((key) => !rows.some((row) => row.key === key)).map((key) => run.labels?.[key] ?? key);
  console.log(`\n${table(rows)}\n\n${assertionSummary(run)}${values.judge ? `\n\n${judgeSummary(run)}` : ""}\n\n${run.results.length - errors} answers, ${errors} errors, ${(run.wall_ms / 1000).toFixed(1)}s wall; ${file}`);
  if (unanswered.length > 0) console.log(`no answer: ${unanswered.join(", ")}`);
  if (before) {
    // Only traces both runs answered, so a failed one does not read as a change.
    const shared = liveRows(before).map((row) => row.key).filter((key) => rows.some((row) => row.key === key));
    console.log(`\nagainst ${values.against}, over the ${shared.length} traces both answered:\n${delta(totalRow(liveRows(before, shared)), totalRow(liveRows(run, shared)))}`);
  }
  return errors > 0 ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main(process.argv.slice(2));
}

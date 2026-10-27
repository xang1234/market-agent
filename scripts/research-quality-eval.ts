// Research-quality eval runner (#124): sends every question in
// research-quality-questions.ts through a running analyst-mode stack (live model, frozen
// data), then writes a dated report for the owner to score and a scores file beside it.
//
//   DEV_PROFILE=chat DEV_MODE=analyst ./scripts/dev-shell.sh up
//   node --experimental-strip-types scripts/research-quality-eval.ts run [base URL] [--stack-dir <checkout>] [--blind]
//   (score: fill in <run>.scores.json)
//   node --experimental-strip-types scripts/research-quality-eval.ts summary
//   node --experimental-strip-types scripts/research-quality-eval.ts pair <baseline.run.json> <candidate.run.json> [--seed N]
//   (score: fill in pairs/<stamp>/pairs.scores.json)
//   node --experimental-strip-types scripts/research-quality-eval.ts reveal <pairs dir> <key file> [--incomplete]
import { execFileSync } from "node:child_process";
import { createHash, randomInt } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import type { Rejection } from "../services/chat/src/assertions.ts";
import { api, runTurn } from "../services/chat/scripts/golden-live-check.ts";
import { QUESTIONS, RUBRIC, type Criterion, type CriterionId, type EvalQuestion } from "./research-quality-questions.ts";

export const RUNS_DIR = fileURLToPath(new URL("../docs/eval-runs/research-quality/", import.meta.url));
export const ROOT = fileURLToPath(new URL("..", import.meta.url));
// A run meant for pairing (#222) stays out of the repo (.dev/ is ignored), so its report
// can't show the scorer which arm wrote which answer.
export const BLIND_RUNS_DIR = join(ROOT, ".dev", "eval-runs", "research-quality");

// An expected refusal (bad input, a mismatched run): printed as its message, exit 1.
// Any other error is a bug and keeps its stack.
export class Refusal extends Error {}

export async function runCli(main: () => void | Promise<void>): Promise<void> {
  try {
    await main();
  } catch (error) {
    const badArgs = typeof (error as { code?: unknown })?.code === "string" && (error as { code: string }).code.startsWith("ERR_PARSE_ARGS");
    if (!(error instanceof Refusal) && !badArgs) throw error;
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}

type Block = Record<string, unknown> & { kind?: string; title?: string };
type Message = { role: string; blocks: Block[]; answered_by?: string | null };
type AnswerUsage = { input_tokens: number; output_tokens: number; reasoning_tokens?: number };
export type Score = 0 | 1 | 2 | "n/a" | null;
export type ScoresFile = {
  run: string;
  model: string;
  scores: Record<string, Record<CriterionId, Score> & { notes: string }>;
};
export type TurnOutcome = "completed" | "timeout" | "provider_error" | "missing_answer" | "skipped";

// runTurn's outcome, or the runner's "skipped" for a turn it didn't send.
type RawOutcome = Awaited<ReturnType<typeof runTurn>> | "skipped";
const OUTCOMES: Record<RawOutcome, TurnOutcome> = {
  "turn.completed": "completed",
  "turn.error": "provider_error",
  timeout: "timeout",
  skipped: "skipped",
};

// A turn that completed without saving an answer has nothing to score.
export function turnOutcome(raw: RawOutcome, saved: boolean): TurnOutcome {
  const outcome = OUTCOMES[raw];
  return outcome === "completed" && !saved ? "missing_answer" : outcome;
}

// A field missing from a turn (a run recorded before it existed) renders unknown;
// null means recorded as none.
export type AnsweredTurn = {
  message: string;
  outcome: TurnOutcome;
  blocks: Block[];
  elapsedMs?: number | null;
  // The deployment that wrote the turn's answer, as chat recorded it (#183). Chat omits it
  // when no model wrote the answer (an engine answer or a fixed reply), so on a completed
  // turn null is "no model"; only a field absent from an older record is unknown.
  answeredBy?: string | null;
  // The answer call's tokens, from turn.completed (#181).
  usage?: AnswerUsage | null;
  // The check of the answer's assertion list, which the answer is rendered from (#208).
  assertions?: AssertionReport | null;
};
export type AnsweredQuestion = {
  question: EvalQuestion;
  threadId: string;
  // The thread's turn traces (services/chat/src/answer-trace.ts), relative to the repo root.
  traces?: string[];
  turns: AnsweredTurn[];
};

// As chat reports it on turn.completed (services/chat/src/assertions.ts), less the
// judge's verdicts and repair indices, which a run doesn't keep.
type AssertionReport = {
  status: "missing" | "malformed" | "checked" | "skipped";
  accepted: Array<{ kind: string; text: string; evidence: string[] }>;
  rejected: Rejection[];
  // The answer was written from the accepted assertions; otherwise it is the fallback sentence.
  rendered?: boolean;
};

// --- provenance ------------------------------------------------------------------

// What a run was measured against: the evaluated stack's checkout (its commit, whether
// tracked files differ from it, and its frozen dataset), the runner's commit, and the
// runner's question set.
export type RunProvenance = { revision: string; runnerRevision: string; dirty: boolean; questionSetDigest: string; datasetRevision: string };

// The machine-readable run, <run>.run.json: the answers and their per-turn facts. It
// holds no environment values, headers, prompts or provider payloads. planned is every
// question the run meant to ask; complete is set only once the last one was asked, so a
// run that stopped early says so. blind: written under .dev/ for pairing.
export type RunRecord = { run: string; model: string; blind: boolean; provenance: RunProvenance; planned: string[]; complete: boolean; questions: AnsweredQuestion[] };

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

export const questionSetDigest = (questions: ReadonlyArray<EvalQuestion> = QUESTIONS, rubric: ReadonlyArray<Criterion> = RUBRIC) =>
  sha256(JSON.stringify({ questions, rubric }));

// What `npm run seed:golden` loads (services/chat/test/golden/dataset.ts seedGoldenDataset):
// the dataset module, the seed SQL it runs, and the issuer ids it imports.
export const DATASET_INPUTS = [
  "services/chat/test/golden/dataset.ts",
  "db/seed/metrics.sql",
  "db/seed/sources.sql",
  "services/shared/src/golden-issuers.ts",
] as const;

// The cutoff the frozen modes answer at lives beside unrelated code, so only its value
// joins the dataset revision.
const FROZEN_AS_OF_FILE = "services/chat/src/ytd-hydration.ts";

function frozenAsOf(stackDir: string): string {
  const file = join(stackDir, FROZEN_AS_OF_FILE);
  const value = existsSync(file) ? /^export const FROZEN_AS_OF = "([^"\n]+)";$/mu.exec(readFileSync(file, "utf8"))?.[1] : undefined;
  if (value === undefined) throw new Refusal(`can't read FROZEN_AS_OF from ${FROZEN_AS_OF_FILE} in ${stackDir}`);
  return value;
}

export function datasetRevision(stackDir: string): string {
  const inputs = DATASET_INPUTS.map((path) => {
    const file = join(stackDir, path);
    if (!existsSync(file)) throw new Refusal(`${stackDir} has no ${path}, so its frozen dataset can't be named; is it the evaluated stack's checkout?`);
    return `${path}\0${readFileSync(file, "utf8")}`;
  });
  return sha256([...inputs, `FROZEN_AS_OF\0${frozenAsOf(stackDir)}`].join("\0"));
}

const git = (dir: string, ...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

// Refuses anything but the top of a git checkout, so a run that can't name what it
// measured sends nothing.
export function runProvenance(stackDir: string, runnerDir = ROOT): RunProvenance {
  if (!existsSync(stackDir)) throw new Refusal(`--stack-dir ${stackDir} does not exist`);
  let top: string;
  try {
    top = git(stackDir, "rev-parse", "--show-toplevel");
  } catch (error) {
    throw new Refusal(`--stack-dir ${stackDir} is not a git checkout (${String((error as { stderr?: unknown }).stderr ?? error).trim()})`);
  }
  if (realpathSync.native(top) !== realpathSync.native(stackDir)) throw new Refusal(`--stack-dir ${stackDir} is inside the checkout ${top}; pass the checkout's top`);
  return {
    revision: git(stackDir, "rev-parse", "HEAD"),
    runnerRevision: git(runnerDir, "rev-parse", "HEAD"),
    // Untracked files are left out: build output and caches would mark every checkout dirty.
    dirty: git(stackDir, "status", "--porcelain", "--untracked-files=no") !== "",
    questionSetDigest: questionSetDigest(),
    datasetRevision: datasetRevision(stackDir),
  };
}

export const serializeRun = (record: RunRecord) => `${JSON.stringify(record, null, 2)}\n`;
export const readRunRecord = (path: string) => JSON.parse(readFileSync(path, "utf8")) as RunRecord;

// --- report ----------------------------------------------------------------------

// Every displayed figure in a block, with its label where it has one.
function figures(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) figures(item, out);
  } else if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.format === "string") {
      const label = record.label ?? record.name;
      out.push(typeof label === "string" ? `${label} ${record.format}` : record.format);
    }
    for (const [key, child] of Object.entries(record)) if (key !== "data_ref") figures(child, out);
  }
  return out;
}

// The engine's certified answer (spec/finance_research_block_schema.json FinancialAnswer).
// Every string in it is the server's, so it is shown as written, never reformatted.
type EngineResult = {
  result_id: string;
  subject_label_id: string | null;
  measure_label_id: string;
  period_label_id: string;
  presented: { kind: string; text: string; reason_code?: string };
};
type EnginePresentation =
  | { kind: "scalar" | "predicate" | "gap"; result_id: string }
  | { kind: "table"; caption: string; columns: Array<{ measure_label_id: string; period_label_id: string | null }>; rows: Array<{ subject_label_id: string; cells: Array<string | null> }> }
  | { kind: "series"; subject_label_id: string; measure_label_id: string; points: Array<{ period_label_id: string; result_id: string }> };
type EngineContent = {
  presentation_version: string;
  coverage: { state: string; requested: number; verified: number };
  labels: Record<string, { text: string }>;
  results: EngineResult[];
  presentations: EnginePresentation[];
};

const ENGINE_VERSIONS = new Set(["financial-presentation.v1", "financial-presentation.v2"]);

function renderEngineAnswer(content: EngineContent): string {
  if (!ENGINE_VERSIONS.has(content.presentation_version)) {
    return `*Engine answer in an unsupported presentation (${content.presentation_version})*`;
  }
  const label = (id: string | null) => (id === null ? null : content.labels[id]?.text ?? id);
  const results = new Map(content.results.map((result) => [result.result_id, result]));
  const shown = (result: EngineResult | undefined) => {
    if (!result) return "—";
    const { kind, text, reason_code } = result.presented;
    return kind === "gap" ? `gap (${reason_code}): ${text}` : text;
  };
  const { state, requested, verified } = content.coverage;
  const lines = [`*Engine answer: ${state === "complete" ? `all ${requested}` : `${verified} of ${requested}`} requested results verified*`];
  for (const presentation of content.presentations) {
    if (presentation.kind === "table") {
      const header = presentation.columns.map((column) => [label(column.measure_label_id), label(column.period_label_id)].filter(Boolean).join(", "));
      lines.push("", `*${presentation.caption}*`, "", `| | ${header.join(" | ")} |`, `|---|${header.map(() => "---").join("|")}|`);
      for (const row of presentation.rows) {
        // A column with no single period names each cell's own.
        const cells = row.cells.map((id, i) => {
          const result = id === null ? undefined : results.get(id);
          return presentation.columns[i]?.period_label_id === null && result ? `${shown(result)} (${label(result.period_label_id)})` : shown(result);
        });
        lines.push(`| ${label(row.subject_label_id)} | ${cells.join(" | ")} |`);
      }
    } else if (presentation.kind === "series") {
      const points = presentation.points.map((point) => `${label(point.period_label_id)} ${shown(results.get(point.result_id))}`);
      lines.push("", `*${label(presentation.subject_label_id)}, ${label(presentation.measure_label_id)}*: ${points.join("; ")}`);
    } else {
      const result = results.get(presentation.result_id);
      if (!lines.at(-1)!.startsWith("- ")) lines.push("");
      const where = result ? [result.subject_label_id, result.measure_label_id, result.period_label_id].map(label).filter(Boolean).join(", ") : "a result not in this answer";
      lines.push(`- ${where}: ${shown(result)}`);
    }
  }
  return lines.join("\n");
}

// ponytail: prose in full, tables as tables, any other block as its title and figures;
// charts and sources are one click away on the thread link.
export function renderBlock(block: Block): string {
  if (block.kind === "rich_text") {
    const segments = (block.segments ?? []) as Array<{ type: string; text?: string; format?: string }>;
    const text = segments.map((s) => (s.type === "text" ? s.text ?? "" : s.type === "ref" ? `**${s.format ?? ""}**` : `[${s.type} segment not shown]`)).join("");
    return block.analyst_commentary === true ? `_Analyst commentary:_ ${text}` : text;
  }
  if (block.kind === "financial_answer") return renderEngineAnswer(block.financial as EngineContent);
  if (block.kind === "disclosure") {
    return ((block.items ?? []) as string[]).map((item) => `> ${item}`).join("\n");
  }
  if (block.kind === "metrics_comparison") {
    const metrics = (block.metrics ?? []) as string[];
    const labels = (block.subject_labels ?? []) as string[];
    const cells = (block.cells ?? []) as Array<Array<{ format?: string }>>;
    return [
      `*${block.title ?? "metrics_comparison"}*`,
      "",
      `| | ${metrics.join(" | ")} |`,
      `|---|${metrics.map(() => "---").join("|")}|`,
      ...labels.map((label, i) => `| ${label} | ${metrics.map((_, j) => cells[i]?.[j]?.format ?? "").join(" | ")} |`),
    ].join("\n");
  }
  const shown = figures(block);
  return `*[${block.kind}] ${block.title ?? ""}*${shown.length > 0 ? `: ${shown.join(", ")}` : ""}`;
}

export const short = (digest: string | undefined) => (digest === undefined ? "unknown" : `\`${digest.slice(0, 12)}\``);

export const rubricLines = () => RUBRIC.map((c) => `- **${c.id}**: ${c.question} 0 = ${c.anchors[0]}; 1 = ${c.anchors[1]}; 2 = ${c.anchors[2]}.`);

export function renderReport(
  run: string,
  model: string,
  base: string,
  answered: ReadonlyArray<AnsweredQuestion>,
  provenance?: RunProvenance,
  progress?: Pick<RunRecord, "planned" | "complete">,
): string {
  const tree = provenance?.dirty === undefined ? "" : provenance.dirty ? " with uncommitted changes" : ", clean";
  const asked = new Set(answered.map(({ question }) => question.id));
  const notAsked = progress?.planned.filter((id) => !asked.has(id)) ?? [];
  const lines = [
    `# Research-quality eval: ${run}`,
    "",
    ...(progress && !progress.complete ? [`**Incomplete run:** ${asked.size} of ${progress.planned.length} planned questions asked${notAsked.length > 0 ? `; not asked: ${notAsked.join(", ")}` : ""}.`, ""] : []),
    `Stack revision: ${short(provenance?.revision)}${tree}. Runner revision: ${short(provenance?.runnerRevision)}. Question set: ${short(provenance?.questionSetDigest)}. Dataset: ${short(provenance?.datasetRevision)}.`,
    "",
    // Which models actually answered, as chat recorded each turn (#183).
    `Answered by: ${answeredBySummary(answered)}.`,
    "",
    `Answer tokens: ${usageSummary(answered)}.`,
    "",
    `Assertions: ${assertionSummary(answered)}.`,
    "",
    `Model: \`${model}\`. Data: frozen golden dataset. Score each question in \`${run}.scores.json\` (rubric below),`,
    "then run `node --experimental-strip-types scripts/research-quality-eval.ts summary`.",
    "Bold figures are cited (linked to a fact); open the thread link for charts and sources.",
    "",
    "## Rubric (0 / 1 / 2)",
    "",
    ...rubricLines(),
  ];
  for (const { question, threadId, turns, traces } of answered) {
    lines.push("", `## ${question.id} (${question.kind})`, "", `Thread: ${base}/chat/${threadId}`);
    if (traces?.length) lines.push(...traces.map((trace) => `Trace: ${trace}`));
    lines.push("", `**Expect:** ${question.expect}`);
    if (question.notApplicable?.length) lines.push("", `N/A: ${question.notApplicable.join(", ")}`);
    for (const [i, turn] of turns.entries()) {
      const subject = question.turns[i]?.subjectText;
      lines.push("", `### Q: ${turn.message}${subject ? ` (opened from the ${subject} page)` : ""}`, "");
      if (turn.outcome === "skipped") lines.push("**Not sent: an earlier turn didn't complete.**", "");
      else if (turn.outcome !== "completed") lines.push(`**Turn ended with ${turn.outcome}.**`, "");
      lines.push(`_${turnFacts(turn)}._`, "");
      if (turn.assertions) lines.push(...renderAssertions(turn.assertions), "");
      lines.push(...turn.blocks.flatMap((block) => [renderBlock(block), ""]));
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

const recorded = <T>(value: T | null | undefined, show: (value: T) => string) =>
  value === undefined ? "unknown" : value === null ? "none" : show(value);

// Rejections by the check they failed (Rejection.check), so a wrong number or citation
// (binding) reads apart from a wrong ranking or trend (comparative) (#221). An accepted
// assertion passed every check that applied to it, so it has no single check.
function byCheck(rejected: ReadonlyArray<Rejection>): string {
  const counts = new Map<string, number>();
  for (const { check } of rejected) counts.set(check, (counts.get(check) ?? 0) + 1);
  return counts.size > 0 ? ` (${[...counts].sort(([a], [b]) => a.localeCompare(b)).map(([check, n]) => `${check} ${n}`).join(", ")})` : "";
}

export const formatChecks = ({ accepted, rejected }: AssertionReport) => `${accepted.length} accepted, ${rejected.length} rejected${byCheck(rejected)}`;

const answeredByShown = (turn: AnsweredTurn) =>
  turn.outcome !== "completed" ? "none"
  : turn.answeredBy === undefined ? "unknown"
  : turn.answeredBy === null ? "none (no model wrote it)"
  : `\`${turn.answeredBy}\``;

function turnFacts(turn: AnsweredTurn): string {
  const tokens = turn.usage ? `; ${turn.usage.input_tokens} input / ${turn.usage.output_tokens} output tokens${turn.usage.reasoning_tokens === undefined ? "" : ` (${turn.usage.reasoning_tokens} reasoning)`}` : "";
  return `Outcome: ${turn.outcome}; time: ${recorded(turn.elapsedMs, (ms) => `${(ms / 1000).toFixed(1)}s`)}; answered by: ${answeredByShown(turn)}; checks: ${recorded(turn.assertions, formatChecks)}${tokens}`;
}

// A turn's assertion check: each accepted assertion with its evidence, each
// rejected one with the check it failed and its reason (#221).
function renderAssertions(report: AssertionReport): string[] {
  if (report.status !== "checked") return [`_Assertions (fallback): ${report.status}._`];
  return [
    `_Assertions (${report.rendered ? "rendered" : "fallback"}): ${report.accepted.length} accepted, ${report.rejected.length} rejected:_`,
    "",
    ...report.accepted.map((entry) => `- ✓ ${entry.kind} [${entry.evidence.join(", ")}]${entry.kind === "analyst_inference" && report.rendered ? "" : " (text not shown)"}: ${entry.text}`),
    ...report.rejected.map((entry) => `- ✗ [${entry.check}] ${entry.reason}${entry.text ? `: ${entry.text}` : ""}`),
  ];
}

// Assertions accepted and rejected over the answered turns, and the turns whose
// answer listed none or a broken list.
export function assertionSummary(answered: ReadonlyArray<AnsweredQuestion>): string {
  const turns = answered.flatMap((question) => question.turns).filter((turn) => turn.outcome === "completed");
  const reports = turns.flatMap((turn) => (turn.assertions ? [turn.assertions] : []));
  if (reports.length === 0) return "not reported";
  const count = (status: AssertionReport["status"]) => reports.filter((report) => report.status === status).length;
  const accepted = reports.reduce((sum, report) => sum + report.accepted.length, 0);
  const rejected = reports.reduce((sum, report) => sum + report.rejected.length, 0);
  const rendered = reports.filter((report) => report.rendered).length;
  return `${accepted} accepted, ${rejected} rejected${byCheck(reports.flatMap((report) => report.rejected))} over ${turns.length} answered turns; ${count("missing")} missing, ${count("malformed")} malformed, ${count("skipped")} with no figures; ${rendered} rendered`;
}

// Each answering model with its turn count; turns whose answer recorded none (no model
// wrote it, or a turn that didn't complete) are counted apart.
export function answeredBySummary(answered: ReadonlyArray<AnsweredQuestion>): string {
  const counts = new Map<string, number>();
  let noModel = 0;
  let unrecorded = 0;
  for (const turn of answered.flatMap((question) => question.turns)) {
    if (turn.outcome === "skipped") continue;
    if (turn.answeredBy) counts.set(turn.answeredBy, (counts.get(turn.answeredBy) ?? 0) + 1);
    else if (turn.outcome === "completed" && turn.answeredBy === null) noModel += 1;
    else unrecorded += 1;
  }
  const turns = (count: number) => `${count} turn${count === 1 ? "" : "s"}`;
  const parts = [...counts].map(([model, count]) => `\`${model}\` (${turns(count)})`);
  if (noModel > 0) parts.push(`no model (${turns(noModel)})`);
  if (unrecorded > 0) parts.push(`not recorded (${turns(unrecorded)})`);
  return parts.length > 0 ? parts.join(", ") : "no turns yet";
}

// Mean tokens per answer call across the turns that reported usage.
export function usageSummary(answered: ReadonlyArray<AnsweredQuestion>): string {
  const usages = answered.flatMap((question) => question.turns).flatMap((turn) => (turn.usage ? [turn.usage] : []));
  if (usages.length === 0) return "not reported";
  const mean = (pick: (usage: AnswerUsage) => number) => Math.round(usages.reduce((sum, usage) => sum + pick(usage), 0) / usages.length);
  const reasoning = usages.filter((usage) => usage.reasoning_tokens !== undefined);
  return `mean ${mean((usage) => usage.input_tokens)} input / ${mean((usage) => usage.output_tokens)} output per turn`
    + (reasoning.length === usages.length ? ` (${mean((usage) => usage.reasoning_tokens!)} reasoning)` : "")
    + ` over ${usages.length} turn${usages.length === 1 ? "" : "s"}`;
}

export function blankScores(run: string, model: string): ScoresFile {
  return {
    run,
    model,
    scores: Object.fromEntries(QUESTIONS.map((q) => [
      q.id,
      {
        ...Object.fromEntries(RUBRIC.map((c) => [c.id, q.notApplicable?.includes(c.id) ? "n/a" : null])),
        notes: "",
      },
    ])) as ScoresFile["scores"],
  };
}

// --- summary ---------------------------------------------------------------------

// A hand-edited cell, checked: its score, null when unscored, or undefined when it
// doesn't apply (notApplicable names why). "n/a" belongs exactly where it doesn't apply.
function readCell(where: string, score: unknown, notApplicable: string | null): 0 | 1 | 2 | null | undefined {
  if (notApplicable !== null) {
    if (score !== undefined && score !== null && score !== "n/a") {
      throw new Error(`${where} is ${JSON.stringify(score)}, but ${notApplicable}; leave it "n/a"`);
    }
    return undefined;
  }
  if (score === "n/a") throw new Error(`${where} is "n/a", but it applies to this question; score it 0, 1 or 2`);
  if (score === null || score === undefined) return null;
  if (score !== 0 && score !== 1 && score !== 2) throw new Error(`${where} is ${JSON.stringify(score)}; use 0, 1, 2 or null`);
  return score;
}

// One line per run, so trends show run to run. Scores are hand-edited, so the file is
// checked against the question set before anything is totalled, and every mistake is an
// error naming where it is: an unknown question, a score other than 0, 1, 2 or null
// (unscored), or "n/a" anywhere but where the question declares it (and only there).
// A question missing from the file counts as unscored, so an incomplete run can't look
// complete. ponytail: a question later removed from QUESTIONS makes older runs error;
// drop it from those files too.
export function summarize(files: ReadonlyArray<ScoresFile>): string {
  const lines = [`run | model | total | ${RUBRIC.map((c) => c.id).join(" | ")} | unscored`];
  const regressions: string[] = [];
  const known = new Set(QUESTIONS.map((q) => q.id));
  for (const file of files) {
    for (const questionId of Object.keys(file.scores)) {
      if (!known.has(questionId)) throw new Refusal(`${file.run}: unknown question '${questionId}'`);
    }
    let total = 0;
    let max = 0;
    let unscored = 0;
    const perCriterion = RUBRIC.map(() => ({ total: 0, max: 0 }));
    for (const question of QUESTIONS) {
      const questionId = question.id;
      const scores = file.scores[questionId];
      RUBRIC.forEach((criterion, i) => {
        const score = readCell(`${file.run}: ${questionId}.${criterion.id}`, scores?.[criterion.id], question.notApplicable?.includes(criterion.id) ? "this question declares it N/A" : null);
        if (score === undefined) return;
        if (score === null) {
          unscored += 1;
          return;
        }
        total += score;
        max += 2;
        perCriterion[i]!.total += score;
        perCriterion[i]!.max += 2;
        if (criterion.id === "no_invented_numbers" && score === 0) regressions.push(`${file.run} ${questionId}`);
      });
    }
    lines.push([
      file.run,
      file.model,
      `${total}/${max}`,
      ...perCriterion.map((c) => `${c.total}/${c.max}`),
      String(unscored),
    ].join(" | "));
  }
  if (regressions.length > 0) {
    lines.push("", "0 on no_invented_numbers (each needs a regression test):", ...regressions.map((r) => `  ${r}`));
  }
  return lines.join("\n");
}

// --- blinded pairs (#222) -----------------------------------------------------------

// Two runs of one question set on one frozen dataset, shown to the owner as answers A
// and B per question, in shuffled order, with which run is which kept in a separate key
// until every applicable cell is scored.
export type Arm = "baseline" | "candidate";
type Side = "A" | "B";
const SIDES: ReadonlyArray<Side> = ["A", "B"];
export const FAILURE_LABELS = [
  "wrong_subject", "wrong_period", "unsupported_figure", "invented_figure",
  "weak_conclusion", "missing_counterpoint", "unstated_gap", "operational_failure",
] as const;
export type FailureLabel = (typeof FAILURE_LABELS)[number];
type TurnFacts = Pick<AnsweredTurn, "outcome" | "answeredBy">;
export type PairKey = {
  seed: number;
  baseline: { run: string; provenance: RunProvenance };
  candidate: { run: string; provenance: RunProvenance };
  // turns: each arm's per-turn outcome and model, for the reveal.
  pairs: Record<string, { A: Arm; B: Arm; confounded: boolean; notApplicable: CriterionId[]; turns: Record<Arm, TurnFacts[]> }>;
};
export type PairScores = {
  pairs: Record<string, Record<Side, Record<CriterionId, Score>> & { labels: Record<Side, FailureLabel[]>; notes: string }>;
};

// mulberry32: a seeded PRNG, so a seed always gives the same packet.
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Only an arm whose every turn completed gave an answer to score.
const answered = (turns: ReadonlyArray<TurnFacts>) => turns.length > 0 && turns.every((turn) => turn.outcome === "completed");

// Where both arms answered a turn, a different (or unrecorded) answering model means the
// pair's delta can't be put down to the change alone.
export function confounded(baseline: ReadonlyArray<TurnFacts>, candidate: ReadonlyArray<TurnFacts>): boolean {
  return baseline.some((turn, i) => {
    const other = candidate[i];
    return turn.outcome === "completed" && other?.outcome === "completed" && (turn.answeredBy === undefined || turn.answeredBy !== other.answeredBy);
  });
}

function renderArm(question: EvalQuestion, turns: ReadonlyArray<AnsweredTurn>): string[] {
  const lines = answered(turns) ? [] : ["_Not scored: a turn didn't complete, so every cell of this answer is n/a._", ""];
  question.turns.forEach((asked, i) => {
    const turn = turns[i];
    lines.push(`**Q:** ${asked.message}${asked.subjectText ? ` (opened from the ${asked.subjectText} page)` : ""}`, "");
    if (turn?.outcome === "completed") lines.push(...turn.blocks.flatMap((block) => [renderBlock(block), ""]));
    else lines.push(`_No answer (${turn?.outcome ?? "not run"})._`, "");
  });
  return lines;
}

export function buildPair(baseline: RunRecord, candidate: RunRecord, seed: number, stamp: string): { packet: string; scores: PairScores; key: PairKey } {
  for (const field of ["questionSetDigest", "datasetRevision"] as const) {
    const [b, c] = [baseline.provenance?.[field], candidate.provenance?.[field]];
    if (!b || !c || b !== c) {
      throw new Error(`can't pair ${baseline.run} with ${candidate.run}: their ${field} differs (${b ?? "unknown"} vs ${c ?? "unknown"}); pair two runs of one question set on one dataset`);
    }
  }
  const byArm: Record<Arm, Map<string, AnsweredQuestion>> = {
    baseline: new Map(baseline.questions.map((q) => [q.question.id, q])),
    candidate: new Map(candidate.questions.map((q) => [q.question.id, q])),
  };
  const ids = [...new Set([...byArm.baseline.keys(), ...byArm.candidate.keys()])];
  const random = seeded(seed);
  for (let i = ids.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  }
  const key: PairKey = {
    seed,
    baseline: { run: baseline.run, provenance: baseline.provenance },
    candidate: { run: candidate.run, provenance: candidate.provenance },
    pairs: {},
  };
  const scores: PairScores = { pairs: {} };
  const lines = [
    `# Blinded answer pairs: ${stamp}`,
    "",
    "Each question has two answers, A and B, from two runs of the same questions on the same frozen data. Which run",
    "wrote which is in a key you don't see. Score every applicable cell of both answers 0, 1 or 2 in `pairs.scores.json`,",
    "add the failure labels that apply, then run `node --experimental-strip-types scripts/research-quality-eval.ts reveal <this",
    "folder> <key file>`.",
    "",
    "## Rubric (0 / 1 / 2)",
    "",
    ...RUBRIC.map((c) => `- **${c.id}**: ${c.question} 0 = ${c.anchors[0]}; 1 = ${c.anchors[1]}; 2 = ${c.anchors[2]}.`),
    "",
    `Failure labels: ${FAILURE_LABELS.map((label) => `\`${label}\``).join(", ")}.`,
  ];
  ids.forEach((id, n) => {
    const A: Arm = random() < 0.5 ? "baseline" : "candidate";
    const arms: Record<Side, Arm> = { A, B: A === "baseline" ? "candidate" : "baseline" };
    const turns = (arm: Arm) => byArm[arm].get(id)?.turns ?? [];
    const question = (byArm.baseline.get(id) ?? byArm.candidate.get(id))!.question;
    const notApplicable = [...(question.notApplicable ?? [])];
    key.pairs[id] = {
      ...arms,
      confounded: confounded(turns("baseline"), turns("candidate")),
      notApplicable,
      turns: { baseline: turns("baseline").map(({ outcome, answeredBy }) => ({ outcome, answeredBy })), candidate: turns("candidate").map(({ outcome, answeredBy }) => ({ outcome, answeredBy })) },
    };
    const blank = (side: Side) => Object.fromEntries(RUBRIC.map((c) => [c.id, notApplicable.includes(c.id) || !answered(turns(arms[side])) ? "n/a" : null])) as Record<CriterionId, Score>;
    const labels = (side: Side): FailureLabel[] => (answered(turns(arms[side])) ? [] : ["operational_failure"]);
    scores.pairs[id] = { A: blank("A"), B: blank("B"), labels: { A: labels("A"), B: labels("B") }, notes: "" };
    lines.push("", `## ${n + 1}. ${id} (${question.kind})`, "", `**Expect:** ${question.expect}`);
    if (notApplicable.length > 0) lines.push("", `N/A: ${notApplicable.join(", ")}`);
    for (const side of SIDES) lines.push("", `### Answer ${side}`, "", ...renderArm(question, turns(arms[side])));
  });
  return { packet: `${lines.join("\n").replace(/\n{3,}/gu, "\n\n").trimEnd()}\n`, scores, key };
}

const ARMS: ReadonlyArray<Arm> = ["baseline", "candidate"];
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
type Sum = { sum: number; cells: number };
const add = (into: Sum, n: number) => {
  into.sum += n;
  into.cells += 1;
};
const showSum = ({ sum, cells }: Sum) => (cells === 0 ? "—" : signed(sum));

// Refuses while an applicable cell is unscored unless incomplete is set, and then says
// so at the top. Totals and deltas are per criterion; no cell is folded into one score.
export function reveal(key: PairKey, scores: PairScores, incomplete = false): string {
  for (const id of Object.keys(scores.pairs)) {
    if (!key.pairs[id]) throw new Error(`pairs.scores.json: unknown question '${id}'`);
  }
  const unscored: string[] = [];
  const totals = Object.fromEntries(ARMS.map((arm) => [arm, RUBRIC.map(() => ({ total: 0, max: 0 }))])) as Record<Arm, Array<{ total: number; max: number }>>;
  const attributed = RUBRIC.map((): Sum => ({ sum: 0, cells: 0 }));
  const confoundedSums = RUBRIC.map((): Sum => ({ sum: 0, cells: 0 }));
  const deltas = new Map<string, Array<number | null>>();
  const labelCounts = Object.fromEntries(ARMS.map((arm) => [arm, new Map(FAILURE_LABELS.map((label) => [label, 0]))])) as Record<Arm, Map<FailureLabel, number>>;
  for (const [id, pair] of Object.entries(key.pairs)) {
    const cells = scores.pairs[id];
    const scored: Record<Arm, Array<0 | 1 | 2 | undefined>> = { baseline: [], candidate: [] };
    for (const side of SIDES) {
      const arm = pair[side];
      for (const label of cells?.labels?.[side] ?? []) {
        const count = labelCounts[arm].get(label);
        if (count === undefined) throw new Error(`${id}.labels.${side}: unknown failure label '${label}'; use one of ${FAILURE_LABELS.join(", ")}`);
        labelCounts[arm].set(label, count + 1);
      }
      RUBRIC.forEach((criterion, i) => {
        const notApplicable = pair.notApplicable.includes(criterion.id) ? "this question declares it N/A" : answered(pair.turns[arm]) ? null : "this answer was not given";
        const score = readCell(`${id}.${side}.${criterion.id}`, cells?.[side]?.[criterion.id], notApplicable);
        if (score === null) unscored.push(`${id} ${side} ${criterion.id}`);
        if (score === null || score === undefined) return;
        scored[arm][i] = score;
        totals[arm][i]!.total += score;
        totals[arm][i]!.max += 2;
      });
    }
    deltas.set(id, RUBRIC.map((_, i) => {
      const [b, c] = [scored.baseline[i], scored.candidate[i]];
      if (b === undefined || c === undefined) return null;
      add((pair.confounded ? confoundedSums : attributed)[i]!, c - b);
      return c - b;
    }));
  }
  if (unscored.length > 0 && !incomplete) {
    throw new Error(`${unscored.length} applicable cell${unscored.length === 1 ? " is" : "s are"} unscored (${unscored.slice(0, 3).join("; ")}${unscored.length > 3 ? "; ..." : ""}); score them, or pass --incomplete to reveal an incomplete review`);
  }

  const short = (digest: string) => `\`${digest.slice(0, 12)}\``;
  const model = (turn: TurnFacts | undefined) => `${turn?.outcome ?? "not run"}, ${recorded(turn?.answeredBy, (m) => `\`${m}\``)}`;
  const deltaRows = (confoundedPairs: boolean) => [...deltas]
    .filter(([id]) => key.pairs[id]!.confounded === confoundedPairs)
    .map(([id, row]) => `| ${id} | ${row.map((d) => (d === null ? "—" : signed(d))).join(" | ")} |`);
  const criteriaHeader = [`| question | ${RUBRIC.map((c) => c.id).join(" | ")} |`, `|---|${RUBRIC.map(() => "---").join("|")}|`];
  const table = (rows: string[]) => (rows.length > 0 ? [...criteriaHeader, ...rows] : ["None."]);
  const notCompared = Object.entries(key.pairs).flatMap(([id, pair]) => ARMS
    .filter((arm) => !answered(pair.turns[arm]))
    .map((arm) => `- ${id}: the ${arm} gave no answer (${pair.turns[arm].map((turn) => turn.outcome).join(", ") || "not run"}).`));
  const lines = [
    `# Blinded comparison: baseline ${key.baseline.run} vs candidate ${key.candidate.run}`,
    ...(unscored.length > 0 ? ["", `**Incomplete review:** ${unscored.length} applicable cell${unscored.length === 1 ? " was" : "s were"} left unscored, so totals and deltas cover the scored cells only.`] : []),
    "",
    "## Runs",
    "",
    "| arm | run | revision | question set | dataset |",
    "|---|---|---|---|---|",
    ...ARMS.map((arm) => {
      const { run, provenance } = key[arm];
      return `| ${arm} | ${run} | ${short(provenance.revision)}${provenance.dirty ? " (uncommitted changes)" : ""} | ${short(provenance.questionSetDigest)} | ${short(provenance.datasetRevision)} |`;
    }),
    "",
    `Seed: ${key.seed}.`,
    "",
    "## Mapping",
    "",
    "| question | A | B | confounded |",
    "|---|---|---|---|",
    ...Object.entries(key.pairs).map(([id, pair]) => `| ${id} | ${pair.A} | ${pair.B} | ${pair.confounded ? "yes" : "no"} |`),
    "",
    "## Totals by criterion",
    "",
    "Deltas are candidate minus baseline over the cells both arms scored: attributed over pairs answered by the same",
    "models, confounded over pairs whose answering models differ.",
    "",
    "| criterion | baseline | candidate | attributed delta | confounded delta |",
    "|---|---|---|---|---|",
    ...RUBRIC.map((c, i) => `| ${c.id} | ${totals.baseline[i]!.total}/${totals.baseline[i]!.max} | ${totals.candidate[i]!.total}/${totals.candidate[i]!.max} | ${showSum(attributed[i]!)} | ${showSum(confoundedSums[i]!)} |`),
    "",
    "## Per-question deltas (candidate minus baseline)",
    "",
    ...table(deltaRows(false)),
    "",
    "## Confounded pairs (not attributed to the change)",
    "",
    ...table(deltaRows(true)),
    "",
    "## Not compared",
    "",
    ...(notCompared.length > 0 ? notCompared : ["None: both arms answered every question."]),
    "",
    "## Unscored cells",
    "",
    ...(unscored.length > 0 ? unscored.map((cell) => `- ${cell}`) : ["None."]),
    "",
    "## Turns",
    "",
    "| question | turn | baseline | candidate |",
    "|---|---|---|---|",
    ...Object.entries(key.pairs).flatMap(([id, pair]) => Array.from(
      { length: Math.max(pair.turns.baseline.length, pair.turns.candidate.length) },
      (_, i) => `| ${id} | ${i + 1} | ${model(pair.turns.baseline[i])} | ${model(pair.turns.candidate[i])} |`,
    )),
    "",
    "## Failure labels",
    "",
    "| label | baseline | candidate |",
    "|---|---|---|",
    ...FAILURE_LABELS.map((label) => `| ${label} | ${labelCounts.baseline.get(label)} | ${labelCounts.candidate.get(label)} |`),
  ];
  return `${lines.join("\n")}\n`;
}

// --- run -------------------------------------------------------------------------

// Scores only compare across runs whose model is known, so a run that can't record it
// stops before any (billed) turn; EVAL_MODEL names it when the settings route can't.
export function modelForRun(primaryModel: string | null | undefined, override: string | undefined, why = "no primary model is set"): string {
  const model = override?.trim() || primaryModel?.trim();
  if (!model) throw new Refusal(`can't record which model answers (${why}); set EVAL_MODEL=<channel/model> to name it`);
  return model;
}

// UTC to the second, e.g. 2026-10-02T045512; files are created exclusively, so a run can
// never overwrite another.
export const runStamp = (date: Date) => date.toISOString().slice(0, 19).replace(/[:]/gu, "");

async function run(base: string, stackDir: string, blind: boolean): Promise<void> {
  const provenance = runProvenance(stackDir);
  type Settings = { primaryModel?: string | null; fallbackModels?: string[] };
  const settings = await api<{ settings?: Settings }>(base, "GET", "/v1/dev/llm-settings")
    .then((read) => ({ primaryModel: read.settings?.primaryModel, fallbackModels: read.settings?.fallbackModels ?? [], why: "no primary model is set" }))
    // Unreadable settings: the fallbacks are unknown (null), not absent.
    .catch((error: unknown) => ({ primaryModel: undefined, fallbackModels: null, why: `reading /v1/dev/llm-settings failed: ${error instanceof Error ? error.message : error}` }));
  // EVAL_MODEL only names the run; the running stack still falls back as configured.
  const model = modelLabel(modelForRun(settings.primaryModel, process.env.EVAL_MODEL, settings.why), settings.fallbackModels);
  const stamp = runStamp(new Date());
  const answered: AnsweredQuestion[] = [];
  const planned = QUESTIONS.map((question) => question.id);
  const traceDir = traceDirFor(stackDir, process.env);
  // Both files exist from the start, created exclusively (a run never overwrites
  // another); the report is rewritten after each question, so an error late in the run
  // keeps every billed answer before it.
  const dir = blind ? BLIND_RUNS_DIR : RUNS_DIR;
  mkdirSync(dir, { recursive: true });
  const report = join(dir, `${stamp}.md`);
  const scores = join(dir, `${stamp}.scores.json`);
  const record = join(dir, `${stamp}.run.json`);
  const save = (complete: boolean, flag?: "wx") => {
    writeFileSync(report, renderReport(stamp, model, base, answered, provenance, { planned, complete }), { flag });
    writeFileSync(record, serializeRun({ run: stamp, model, blind, provenance, planned, complete, questions: answered }), { flag });
  };
  writeFileSync(scores, `${JSON.stringify(blankScores(stamp, model), null, 2)}\n`, { flag: "wx" });
  save(false, "wx");
  console.log(`report: ${report}\nscore:  ${scores}\nrun:    ${record}\n`);
  for (const question of QUESTIONS) {
    const { thread_id: threadId } = await api<{ thread_id: string }>(base, "POST", "/v1/chat/threads", { title: `Eval: ${question.id}` });
    const turns: AnsweredQuestion["turns"] = [];
    let answersSoFar = 0;
    for (const turn of question.turns) {
      // A turn that timed out may still be running on the server and save its answer
      // during the next one, which would then be read as the next answer; don't send it.
      if (turns.some((t) => t.outcome !== "completed")) {
        turns.push({ message: turn.message, outcome: "skipped", blocks: [], elapsedMs: null, answeredBy: null, usage: null, assertions: null });
        continue;
      }
      const startedAt = Date.now();
      let usage: AnswerUsage | null = null;
      let assertions: AssertionReport | null = null;
      const raw = await runTurn(base, threadId, turn.message, 180_000, turn.subjectText, (data) => {
        usage = (data.answer_usage as AnswerUsage | undefined) ?? null;
        const report = data.assertion_report as AssertionReport | undefined;
        assertions = report ? { status: report.status, accepted: report.accepted, rejected: report.rejected, ...(report.rendered === undefined ? {} : { rendered: report.rendered }) } : null;
      });
      const elapsedMs = Date.now() - startedAt;
      const { messages } = await api<{ messages: Message[] }>(base, "GET", `/v1/chat/threads/${threadId}/messages`);
      const answers = messages.filter((m) => m.role === "assistant");
      // A failed turn may have saved no answer: show none rather than the previous one.
      const answer = answers.length > answersSoFar ? answers.at(-1)! : null;
      const outcome = turnOutcome(raw, answer !== null);
      console.log(`${outcome}  ${question.id}: ${turn.message}  (${(elapsedMs / 1000).toFixed(1)}s)`);
      turns.push({
        message: turn.message,
        outcome,
        blocks: answer?.blocks ?? [],
        elapsedMs,
        answeredBy: outcome === "completed" ? answer?.answered_by ?? null : null,
        usage,
        assertions,
      });
      answersSoFar = answers.length;
    }
    answered.push({ question, threadId, turns, traces: threadTraces(traceDir, threadId, stackDir) });
    save(answered.length === planned.length);
  }
  console.log(`\ndone: ${answered.length} questions in ${report}`);
}

// Where the evaluated stack's chat service writes turn traces: dev-shell's default
// unless overridden, relative to the stack's checkout.
export const traceDirFor = (stackDir: string, env: NodeJS.ProcessEnv) => resolve(stackDir, env.CHAT_TRACE_DIR?.trim() || ".dev/traces");

// A thread's trace files, oldest first, relative to root; none when tracing is off.
export function threadTraces(dir: string, threadId: string, root: string): string[] {
  const threadDir = join(dir, threadId);
  if (!existsSync(threadDir)) return [];
  return readdirSync(threadDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => join(threadDir, name))
    .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs)
    .map((path) => relative(root, path));
}

// The run's configured models, for the scores file; the report shows which of them
// actually answered each turn (#183). null means the settings couldn't be read, so
// whether there are fallbacks is unknown.
export function modelLabel(model: string, fallbackModels: ReadonlyArray<string> | null): string {
  if (fallbackModels === null) return `${model} (fallbacks: unknown)`;
  return fallbackModels.length > 0 ? `${model} (fallbacks: ${fallbackModels.join(", ")})` : model;
}

// Every run's scores, oldest first; none yet (no runs folder on a fresh checkout) is [].
export function readRuns(dir: string): ScoresFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".scores.json"))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")) as ScoresFile);
}

// The key stays out of the repo (.dev/ is ignored), so the packet can be committed blind.
const KEYS_DIR = join(ROOT, ".dev", "eval-keys");

function pair(baselineFile: string, candidateFile: string, seedText: string | undefined): void {
  const seed = seedText === undefined ? randomInt(2 ** 31) : Number(seedText);
  if (!Number.isSafeInteger(seed)) throw new Error(`--seed ${seedText} is not an integer`);
  const stamp = runStamp(new Date());
  const { packet, scores, key } = buildPair(readRunRecord(baselineFile), readRunRecord(candidateFile), seed, stamp);
  const dir = join(RUNS_DIR, "pairs", stamp);
  const keyFile = join(KEYS_DIR, `${stamp}.key.json`);
  mkdirSync(dir, { recursive: true });
  mkdirSync(KEYS_DIR, { recursive: true });
  writeFileSync(keyFile, `${JSON.stringify(key, null, 2)}\n`, { flag: "wx" });
  writeFileSync(join(dir, "pairs.scores.json"), `${JSON.stringify(scores, null, 2)}\n`, { flag: "wx" });
  writeFileSync(join(dir, "pairs.md"), packet, { flag: "wx" });
  console.log(`packet: ${join(dir, "pairs.md")}\nscore:  ${join(dir, "pairs.scores.json")}\nkey:    ${keyFile} (don't open it before scoring)`);
}

function revealPair(dir: string, keyFile: string, incomplete: boolean): void {
  const key = JSON.parse(readFileSync(keyFile, "utf8")) as PairKey;
  const scores = JSON.parse(readFileSync(join(dir, "pairs.scores.json"), "utf8")) as PairScores;
  writeFileSync(join(dir, "reveal.md"), reveal(key, scores, incomplete));
  console.log(`reveal: ${join(dir, "reveal.md")}`);
}

function summary(): void {
  const files = readRuns(RUNS_DIR);
  console.log(files.length > 0 ? summarize(files) : `no scored runs in ${RUNS_DIR}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await runCli(async () => {
    const { positionals: [command, first, second], values } = parseArgs({
      allowPositionals: true,
      options: { "stack-dir": { type: "string" }, blind: { type: "boolean", default: false }, seed: { type: "string" }, incomplete: { type: "boolean", default: false } },
    });
    // The checkout the evaluated stack runs from, which may not be the runner's (#222).
    const stackDir = resolve(values["stack-dir"] ?? process.env.EVAL_STACK_DIR ?? ROOT);
    if (command === "run") await run(first ?? process.env.EVAL_BASE_URL ?? "http://127.0.0.1:5173", stackDir, values.blind);
    else if (command === "summary") summary();
    else if (command === "pair" && first && second) pair(first, second, values.seed);
    else if (command === "reveal" && first && second) revealPair(first, second, values.incomplete);
    else {
      console.error([
        "usage: research-quality-eval.ts run [base URL] [--stack-dir <checkout>] [--blind]",
        "       research-quality-eval.ts summary",
        "       research-quality-eval.ts pair <baseline.run.json> <candidate.run.json> [--seed N]",
        "       research-quality-eval.ts reveal <pairs dir> <key file> [--incomplete]",
      ].join("\n"));
      process.exitCode = 2;
    }
  });
}

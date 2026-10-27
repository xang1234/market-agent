// Research-quality eval runner (#124): sends every question in
// research-quality-questions.ts through a running analyst-mode stack (live model, frozen
// data), then writes a dated report for the owner to score and a scores file beside it.
//
//   DEV_PROFILE=chat DEV_MODE=analyst ./scripts/dev-shell.sh up
//   node --experimental-strip-types scripts/research-quality-eval.ts run [base URL] [--stack-dir <checkout>] [--blind]
//   (score: fill in <run>.scores.json)
//   node --experimental-strip-types scripts/research-quality-eval.ts summary
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
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

function summary(): void {
  const files = readRuns(RUNS_DIR);
  console.log(files.length > 0 ? summarize(files) : `no scored runs in ${RUNS_DIR}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await runCli(async () => {
    const { positionals: [command, base], values } = parseArgs({
      allowPositionals: true,
      options: { "stack-dir": { type: "string" }, blind: { type: "boolean", default: false } },
    });
    // The checkout the evaluated stack runs from, which may not be the runner's (#222).
    const stackDir = resolve(values["stack-dir"] ?? process.env.EVAL_STACK_DIR ?? ROOT);
    if (command === "run") await run(base ?? process.env.EVAL_BASE_URL ?? "http://127.0.0.1:5173", stackDir, values.blind);
    else if (command === "summary") summary();
    else {
      console.error("usage: research-quality-eval.ts run [base URL] [--stack-dir <checkout>] [--blind] | summary");
      process.exitCode = 2;
    }
  });
}

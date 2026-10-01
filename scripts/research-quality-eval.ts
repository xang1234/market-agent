// Research-quality eval runner (#124): sends every question in
// research-quality-questions.ts through a running analyst-mode stack (live model, frozen
// data), then writes a dated report for the owner to score and a scores file beside it.
//
//   DEV_PROFILE=chat DEV_MODE=analyst ./scripts/dev-shell.sh up
//   node --experimental-strip-types scripts/research-quality-eval.ts run [base URL]
//   (score: fill in <run>.scores.json)
//   node --experimental-strip-types scripts/research-quality-eval.ts summary
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { api, runTurn } from "../services/chat/scripts/golden-live-check.ts";
import { QUESTIONS, RUBRIC, type CriterionId, type EvalQuestion } from "./research-quality-questions.ts";

export const RUNS_DIR = fileURLToPath(new URL("../docs/eval-runs/research-quality/", import.meta.url));

type Block = Record<string, unknown> & { kind?: string; title?: string };
type Message = { role: string; blocks: Block[] };
export type Score = 0 | 1 | 2 | "n/a" | null;
export type ScoresFile = {
  run: string;
  model: string;
  scores: Record<string, Record<CriterionId, Score> & { notes: string }>;
};
export type AnsweredQuestion = {
  question: EvalQuestion;
  threadId: string;
  turns: Array<{ message: string; outcome: string; blocks: Block[] }>;
};

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

// ponytail: prose in full, tables as tables, any other block as its title and figures;
// charts and sources are one click away on the thread link.
export function renderBlock(block: Block): string {
  if (block.kind === "rich_text") {
    const segments = (block.segments ?? []) as Array<{ type: string; text?: string; format?: string }>;
    return segments.map((s) => (s.type === "text" ? s.text ?? "" : `**${s.format ?? ""}**`)).join("");
  }
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

export function renderReport(run: string, model: string, base: string, answered: ReadonlyArray<AnsweredQuestion>): string {
  const lines = [
    `# Research-quality eval: ${run}`,
    "",
    `Model: \`${model}\`. Data: frozen golden dataset. Score each question in \`${run}.scores.json\` (rubric below),`,
    "then run `node --experimental-strip-types scripts/research-quality-eval.ts summary`.",
    "Bold figures are cited (linked to a fact); open the thread link for charts and sources.",
    "",
    "## Rubric (0 / 1 / 2)",
    "",
    ...RUBRIC.map((c) => `- **${c.id}**: ${c.question} 0 = ${c.anchors[0]}; 1 = ${c.anchors[1]}; 2 = ${c.anchors[2]}.`),
  ];
  for (const { question, threadId, turns } of answered) {
    lines.push("", `## ${question.id} (${question.kind})`, "", `Thread: ${base}/chat/${threadId}`, "", `**Expect:** ${question.expect}`);
    if (question.notApplicable?.length) lines.push("", `N/A: ${question.notApplicable.join(", ")}`);
    for (const [i, turn] of turns.entries()) {
      const subject = question.turns[i]?.subjectText;
      lines.push("", `### Q: ${turn.message}${subject ? ` (opened from the ${subject} page)` : ""}`, "");
      if (turn.outcome !== "turn.completed") lines.push(`**Turn ended with ${turn.outcome}.**`, "");
      lines.push(...turn.blocks.flatMap((block) => [renderBlock(block), ""]));
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
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

// One line per run, so trends show run to run. Scores are hand-edited: anything but
// 0, 1, 2, "n/a" or null (unscored) is an error naming where it is.
export function summarize(files: ReadonlyArray<ScoresFile>): string {
  const lines = [`run | model | total | ${RUBRIC.map((c) => c.id).join(" | ")} | unscored`];
  const regressions: string[] = [];
  for (const file of files) {
    let total = 0;
    let max = 0;
    let unscored = 0;
    const perCriterion = RUBRIC.map(() => ({ total: 0, max: 0 }));
    for (const [questionId, scores] of Object.entries(file.scores)) {
      RUBRIC.forEach((criterion, i) => {
        const score = scores[criterion.id];
        if (score === "n/a") return;
        if (score === null || score === undefined) {
          unscored += 1;
          return;
        }
        if (score !== 0 && score !== 1 && score !== 2) {
          throw new Error(`${file.run}: ${questionId}.${criterion.id} is ${JSON.stringify(score)}; use 0, 1, 2, "n/a" or null`);
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

async function run(base: string): Promise<void> {
  const settings = await api<{ settings?: { primaryModel?: string | null } }>(base, "GET", "/v1/dev/llm-settings")
    .catch(() => ({ settings: undefined }));
  const model = settings.settings?.primaryModel ?? "unknown";
  const stamp = new Date().toISOString().slice(0, 16).replace(":", "");
  const answered: AnsweredQuestion[] = [];
  for (const question of QUESTIONS) {
    const { thread_id: threadId } = await api<{ thread_id: string }>(base, "POST", "/v1/chat/threads", { title: `Eval: ${question.id}` });
    const turns: AnsweredQuestion["turns"] = [];
    let answersSoFar = 0;
    for (const turn of question.turns) {
      const startedAt = Date.now();
      const outcome = await runTurn(base, threadId, turn.message, 180_000, turn.subjectText);
      console.log(`${outcome === "turn.completed" ? "done" : outcome}  ${question.id}: ${turn.message}  (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
      const { messages } = await api<{ messages: Message[] }>(base, "GET", `/v1/chat/threads/${threadId}/messages`);
      const answers = messages.filter((m) => m.role === "assistant");
      // A failed turn may have saved no answer: show none rather than the previous one.
      turns.push({ message: turn.message, outcome, blocks: answers.length > answersSoFar ? answers.at(-1)!.blocks : [] });
      answersSoFar = answers.length;
    }
    answered.push({ question, threadId, turns });
  }
  mkdirSync(RUNS_DIR, { recursive: true });
  const report = join(RUNS_DIR, `${stamp}.md`);
  const scores = join(RUNS_DIR, `${stamp}.scores.json`);
  writeFileSync(report, renderReport(stamp, model, base, answered));
  writeFileSync(scores, `${JSON.stringify(blankScores(stamp, model), null, 2)}\n`);
  console.log(`\nreport: ${report}\nscore:  ${scores}`);
}

function summary(): void {
  const files = readdirSync(RUNS_DIR)
    .filter((name) => name.endsWith(".scores.json"))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(RUNS_DIR, name), "utf8")) as ScoresFile);
  console.log(files.length > 0 ? summarize(files) : `no scored runs in ${RUNS_DIR}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [command, base] = process.argv.slice(2);
  if (command === "run") await run(base ?? process.env.EVAL_BASE_URL ?? "http://127.0.0.1:5173");
  else if (command === "summary") summary();
  else {
    console.error("usage: research-quality-eval.ts run [base URL] | summary");
    process.exitCode = 2;
  }
}

// Blinded pairs (#222): two runs of one question set on one frozen dataset, shown to the
// owner as answers A and B per question, in shuffled order, with which run is which kept
// in a key under .dev/ (gitignored) until every applicable cell is scored.
//
//   node --experimental-strip-types scripts/research-quality-eval.ts run [base URL] --stack-dir <checkout> --blind
//   node --experimental-strip-types scripts/research-quality-pairs.ts pair <baseline.run.json> <candidate.run.json> [--seed N]
//   (score: fill in pairs/<pairing>/pairs.scores.json)
//   node --experimental-strip-types scripts/research-quality-pairs.ts reveal <pairs dir> [key file] [--incomplete]
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash, randomInt } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import {
  ROOT,
  RUNS_DIR,
  Refusal,
  answeredByShown,
  questionSetDigest,
  readCell,
  renderBlock,
  rubricLines,
  runCli,
  runStamp,
  short,
  type AnsweredQuestion,
  type AnsweredTurn,
  type Block,
  type EngineContent,
  type RefSegment,
  type RunProvenance,
  type RunRecord,
  type Score,
} from "./research-quality-eval.ts";
import { RUBRIC, type CriterionId, type EvalQuestion } from "./research-quality-questions.ts";

export type Arm = "baseline" | "candidate";
type Side = "A" | "B";
const ARMS: ReadonlyArray<Arm> = ["baseline", "candidate"];
const SIDES: ReadonlyArray<Side> = ["A", "B"];
export const FAILURE_LABELS = [
  "wrong_subject", "wrong_period", "unsupported_figure", "invented_figure",
  "weak_conclusion", "missing_counterpoint", "unstated_gap", "operational_failure",
] as const;
export type FailureLabel = (typeof FAILURE_LABELS)[number];
type TurnFacts = Pick<AnsweredTurn, "outcome" | "answeredBy">;
// file: the run.json the arm was read from, copied beside the reveal.
type ArmRun = { run: string; file: string; complete: boolean; provenance: RunProvenance };
// pairing names one packet, its scores and its key, so a key can only reveal its own.
export type PairKey = {
  pairing: string;
  seed: number;
  baseline: ArmRun;
  candidate: ArmRun;
  // Planned questions an arm never asked (its run stopped early), so they aren't in the packet.
  missing: Record<string, Arm[]>;
  // turns: each arm's per-turn outcome and model, for the reveal.
  pairs: Record<string, { A: Arm; B: Arm; confounded: boolean; notApplicable: CriterionId[]; turns: Record<Arm, TurnFacts[]> }>;
};
type PairCells = Record<Side, Record<CriterionId, Score>> & { labels: Record<Side, FailureLabel[]>; notes: string };
export type PairScores = { pairing: string; pairs: Record<string, PairCells> };

// The key stays out of the repo (.dev/ is gitignored), so the packet can be committed blind.
export const KEYS_DIR = join(ROOT, ".dev", "eval-keys");
export const keyFileFor = (pairing: string) => join(KEYS_DIR, `${pairing}.key.json`);

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

export function parseSeed(text: string | undefined): number {
  if (text === undefined) return randomInt(2 ** 32);
  if (!/^\d+$/u.test(text) || Number(text) >= 2 ** 32) throw new Refusal(`--seed ${text} is not a whole number below 2^32`);
  return Number(text);
}

// Only an arm whose every turn completed gave an answer to score.
const gaveAnswer = (turns: ReadonlyArray<TurnFacts>) => turns.length > 0 && turns.every((turn) => turn.outcome === "completed");

// A pair both arms answered is confounded when a turn names two different models, or an
// older record lacks the field: its delta can't be put down to the change alone. Null is
// "no model wrote it" (chat omits answered_by then), so a model against null is the change.
export function confounded(baseline: ReadonlyArray<TurnFacts>, candidate: ReadonlyArray<TurnFacts>): boolean {
  if (!gaveAnswer(baseline) || !gaveAnswer(candidate)) return false;
  return baseline.some((turn, i) => {
    const [a, b] = [turn.answeredBy, candidate[i]?.answeredBy];
    return a === undefined || b === undefined || (a !== null && b !== null && a !== b);
  });
}

// --- packet ------------------------------------------------------------------------

type EngineResult = EngineContent["results"][number];

// What a cited figure points at, from the answer's own blocks. Fact and result ids are
// minted per stack, so they'd tell the arms apart; the reference is described instead.
function describeRef(segment: RefSegment, block: Block, results: ReadonlyMap<string, { result: EngineResult; labels: EngineContent["labels"] }>): string {
  if (segment.ref_kind === "result") {
    const found = results.get(segment.ref_id);
    if (!found) return "engine result not among this answer's engine results";
    const { result, labels } = found;
    const where = [result.subject_label_id, result.measure_label_id, result.period_label_id].flatMap((id) => (id === null ? [] : [labels[id]?.text ?? id]));
    return `engine result: ${where.join(", ")}: ${result.presented.text}`;
  }
  if (segment.ref_kind === "fact") {
    const bindings = (block.data_ref as { params?: { fact_bindings?: Array<Record<string, unknown>> } } | undefined)?.params?.fact_bindings ?? [];
    const binding = bindings.find((entry) => entry.fact_id === segment.ref_id);
    if (!binding) return "fact with no binding in its block";
    const period = [binding.fiscal_period, binding.fiscal_year].filter((part) => part !== undefined).join(" ");
    const range = binding.period_start && binding.period_end ? ` (${binding.period_start} to ${binding.period_end})` : "";
    return `fact: ${period}${range}${binding.unit ? `, ${binding.unit}` : ""}${binding.as_of ? `, as of ${binding.as_of}` : ""}`;
  }
  if (segment.ref_kind === "claim") return "filed claim, quoted as shown";
  if (segment.ref_kind === "series") return "price series";
  return `${segment.ref_kind} reference`;
}

// One answer, every turn, with its cited figures numbered [1], [2]... in the order they
// appear and listed after it with what each points at, and each block's own sources as
// S1, S2... in the order they appear, since source ids are minted per stack.
function renderArm(question: EvalQuestion, turns: ReadonlyArray<AnsweredTurn>): string[] {
  const lines = gaveAnswer(turns) ? [] : ["_Not scored: a turn didn't complete, so every cell of this answer is n/a._", ""];
  const results = new Map(turns.flatMap((turn) => turn.blocks).filter((block) => block.kind === "financial_answer").flatMap((block) => {
    const { results: list = [], labels = {} } = (block.financial ?? {}) as Partial<EngineContent>;
    return list.map((result) => [result.result_id, { result, labels }] as const);
  }));
  const cited: string[] = [];
  const cite = (segment: RefSegment, block: Block) => {
    cited.push(`- [${cited.length + 1}] **${segment.format ?? ""}**: ${describeRef(segment, block, results)}`);
    return `[${cited.length}]`;
  };
  const sourceAliases = new Map<unknown, string>();
  const source = (ref: unknown) => {
    if (!sourceAliases.has(ref)) sourceAliases.set(ref, `S${sourceAliases.size + 1}`);
    return sourceAliases.get(ref)!;
  };
  question.turns.forEach((asked, i) => {
    const turn = turns[i];
    lines.push(`**Q:** ${asked.message}${asked.subjectText ? ` (opened from the ${asked.subjectText} page)` : ""}`, "");
    if (turn?.outcome !== "completed") {
      lines.push(`_No answer (${turn?.outcome ?? "not run"})._`, "");
      return;
    }
    for (const block of turn.blocks) {
      lines.push(renderBlock(block, cite), "");
      const sources = Array.isArray(block.source_refs) ? block.source_refs : [];
      if (sources.length > 0) lines.push(`_Block sources: ${sources.map(source).join(", ")}._`, "");
    }
  });
  if (cited.length > 0) lines.push("_Cited:_", "", ...cited, "");
  return lines;
}

// Refuses two runs that didn't run this runner's question set on one dataset. Questions
// only one run asked stay out of the packet and are named in it and in the reveal.
export function buildPair(baseline: RunRecord, candidate: RunRecord, seed: number, pairing: string, files: Record<Arm, string>): { packet: string; scores: PairScores; key: PairKey } {
  for (const record of [baseline, candidate]) {
    if (record.blind !== true) throw new Refusal(`can't pair ${record.run}: it wasn't run with --blind, so its report may have been read; rerun it with --blind`);
  }
  for (const field of ["questionSetDigest", "datasetRevision"] as const) {
    const [b, c] = [baseline.provenance[field], candidate.provenance[field]];
    if (b !== c) throw new Refusal(`can't pair ${baseline.run} with ${candidate.run}: their ${field} differs (${b} vs ${c}); pair two runs of one question set on one dataset`);
  }
  const current = questionSetDigest();
  if (baseline.provenance.questionSetDigest !== current) {
    throw new Refusal(`can't pair ${baseline.run} with ${candidate.run}: they ran question set ${baseline.provenance.questionSetDigest}, but this runner's is ${current}; pair them from the runner revision that ran them`);
  }
  const byArm: Record<Arm, Map<string, AnsweredQuestion>> = {
    baseline: new Map(baseline.questions.map((q) => [q.question.id, q])),
    candidate: new Map(candidate.questions.map((q) => [q.question.id, q])),
  };
  const planned = [...new Set([...baseline.planned, ...candidate.planned])];
  const missing = Object.fromEntries(planned.flatMap((id) => {
    const arms = ARMS.filter((arm) => !byArm[arm].has(id));
    return arms.length > 0 ? [[id, arms]] : [];
  }));
  const ids = planned.filter((id) => !(id in missing));
  const random = seeded(seed);
  for (let i = ids.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  }
  const arm = (record: RunRecord, file: string): ArmRun => ({ run: record.run, file, complete: record.complete, provenance: record.provenance });
  const key: PairKey = { pairing, seed, baseline: arm(baseline, files.baseline), candidate: arm(candidate, files.candidate), missing, pairs: {} };
  const scores: PairScores = { pairing, pairs: {} };
  const lines = [
    `# Blinded answer pairs: ${pairing}`,
    "",
    "Each question has two answers, A and B, from two runs of the same questions on the same frozen data. Which run",
    "wrote which is in a key you don't see. Score every applicable cell of both answers 0, 1 or 2 in `pairs.scores.json`,",
    "add the failure labels that apply, then run `node --experimental-strip-types scripts/research-quality-pairs.ts reveal",
    "<this folder>`. Each cited figure carries a number; the list after the answer says what it points at.",
    ...(baseline.complete && candidate.complete ? [] : ["", "**Incomplete runs:** one run or both stopped before their last question."]),
    ...(Object.keys(missing).length > 0 ? ["", `Not in this packet, because a run never asked them: ${Object.keys(missing).join(", ")}.`] : []),
    "",
    "## Rubric (0 / 1 / 2)",
    "",
    ...rubricLines(),
    "",
    `Failure labels: ${FAILURE_LABELS.map((label) => `\`${label}\``).join(", ")}. An answer that wasn't given is labelled`,
    "`operational_failure` at the reveal.",
  ];
  ids.forEach((id, n) => {
    const A: Arm = random() < 0.5 ? "baseline" : "candidate";
    const arms: Record<Side, Arm> = { A, B: A === "baseline" ? "candidate" : "baseline" };
    const turns = (arm: Arm) => byArm[arm].get(id)!.turns;
    const question = byArm.baseline.get(id)!.question;
    const notApplicable = [...(question.notApplicable ?? [])];
    key.pairs[id] = {
      ...arms,
      confounded: confounded(turns("baseline"), turns("candidate")),
      notApplicable,
      turns: { baseline: turns("baseline").map(({ outcome, answeredBy }) => ({ outcome, answeredBy })), candidate: turns("candidate").map(({ outcome, answeredBy }) => ({ outcome, answeredBy })) },
    };
    const blank = (side: Side) => Object.fromEntries(RUBRIC.map((c) => [c.id, notApplicable.includes(c.id) || !gaveAnswer(turns(arms[side])) ? "n/a" : null])) as Record<CriterionId, Score>;
    scores.pairs[id] = { A: blank("A"), B: blank("B"), labels: { A: [], B: [] }, notes: "" };
    lines.push("", `## ${n + 1}. ${id} (${question.kind})`, "", `**Expect:** ${question.expect}`);
    if (notApplicable.length > 0) lines.push("", `N/A: ${notApplicable.join(", ")}`);
    for (const side of SIDES) lines.push("", `### Answer ${side}`, "", ...renderArm(question, turns(arms[side])));
  });
  return { packet: `${lines.join("\n").replace(/\n{3,}/gu, "\n\n").trimEnd()}\n`, scores, key };
}

// --- reveal ------------------------------------------------------------------------

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
type Sum = { sum: number; pairs: number };
const showSum = ({ sum, pairs }: Sum) => (pairs === 0 ? "— (no pairs)" : `${signed(sum)} over ${pairs} pair${pairs === 1 ? "" : "s"}`);

// Refuses another pairing's key, and while an applicable cell is unscored unless
// incomplete is set, and then says so at the top. Totals and deltas are per criterion;
// no cell is folded into one score. complete: every applicable cell was scored.
export function reveal(key: PairKey, scores: PairScores, incomplete = false): { report: string; complete: boolean } {
  if (key.pairing !== scores.pairing) {
    throw new Refusal(`this key is pairing ${key.pairing}'s, but the scores are pairing ${scores.pairing}'s; reveal a packet with its own key`);
  }
  for (const id of Object.keys(scores.pairs)) {
    if (!key.pairs[id]) throw new Refusal(`pairs.scores.json: unknown question '${id}'`);
  }
  const compared = (id: string) => ARMS.every((arm) => gaveAnswer(key.pairs[id]!.turns[arm]));
  const unscored: string[] = [];
  const totals = Object.fromEntries(ARMS.map((arm) => [arm, RUBRIC.map(() => ({ total: 0, max: 0 }))])) as Record<Arm, Array<{ total: number; max: number }>>;
  const attributed = RUBRIC.map((): Sum => ({ sum: 0, pairs: 0 }));
  const confoundedSums = RUBRIC.map((): Sum => ({ sum: 0, pairs: 0 }));
  const deltas = new Map<string, Array<number | null>>();
  const labels = new Map<string, Record<Side, FailureLabel[]>>();
  for (const [id, pair] of Object.entries(key.pairs)) {
    const cells = scores.pairs[id];
    const scored: Record<Arm, Array<0 | 1 | 2 | undefined>> = { baseline: [], candidate: [] };
    const sideLabels = {} as Record<Side, FailureLabel[]>;
    for (const side of SIDES) {
      const arm = pair[side];
      for (const label of cells?.labels[side] ?? []) {
        if (!(FAILURE_LABELS as ReadonlyArray<string>).includes(label)) throw new Refusal(`${id}.labels.${side}: unknown failure label '${label}'; use one of ${FAILURE_LABELS.join(", ")}`);
      }
      const derived: FailureLabel[] = gaveAnswer(pair.turns[arm]) ? [] : ["operational_failure"];
      sideLabels[side] = FAILURE_LABELS.filter((label) => derived.includes(label) || (cells?.labels[side] ?? []).includes(label));
      RUBRIC.forEach((criterion, i) => {
        const notApplicable = pair.notApplicable.includes(criterion.id) ? "this question declares it N/A" : gaveAnswer(pair.turns[arm]) ? null : "this answer was not given";
        const score = readCell(`${id}.${side}.${criterion.id}`, cells?.[side]?.[criterion.id], notApplicable);
        if (score === null) unscored.push(`${id} ${side} ${criterion.id}`);
        if (score === null || score === undefined) return;
        scored[arm][i] = score;
        totals[arm][i]!.total += score;
        totals[arm][i]!.max += 2;
      });
    }
    labels.set(id, sideLabels);
    if (!compared(id)) continue;
    deltas.set(id, RUBRIC.map((_, i) => {
      const [b, c] = [scored.baseline[i], scored.candidate[i]];
      if (b === undefined || c === undefined) return null;
      const into = (pair.confounded ? confoundedSums : attributed)[i]!;
      into.sum += c - b;
      into.pairs += 1;
      return c - b;
    }));
  }
  if (unscored.length > 0 && !incomplete) {
    throw new Refusal(`${unscored.length} applicable cell${unscored.length === 1 ? " is" : "s are"} unscored (${unscored.slice(0, 3).join("; ")}${unscored.length > 3 ? "; ..." : ""}); score them, or pass --incomplete to reveal an incomplete review`);
  }

  const turnShown = (turn: TurnFacts | undefined) => (turn ? `${turn.outcome}, ${answeredByShown(turn)}` : "not run");
  const deltaRows = (confoundedPairs: boolean) => [...deltas]
    .filter(([id]) => key.pairs[id]!.confounded === confoundedPairs)
    .map(([id, row]) => `| ${id} | ${row.map((d) => (d === null ? "—" : signed(d))).join(" | ")} |`);
  const criteriaHeader = [`| question | ${RUBRIC.map((c) => c.id).join(" | ")} |`, `|---|${RUBRIC.map(() => "---").join("|")}|`];
  const table = (rows: string[]) => (rows.length > 0 ? [...criteriaHeader, ...rows] : ["None."]);
  const notCompared = [
    ...Object.entries(key.missing).map(([id, arms]) => `- ${id}: ${arms.length === 2 ? "neither run asked it" : `the ${arms[0]} never asked it`} (stopped early).`),
    ...Object.entries(key.pairs).flatMap(([id, pair]) => ARMS
      .filter((arm) => !gaveAnswer(pair.turns[arm]))
      .map((arm) => `- ${id}: the ${arm} gave no answer (${pair.turns[arm].map((turn) => turn.outcome).join(", ")}).`)),
  ];
  const notes = Object.entries(key.pairs).flatMap(([id, pair]) => {
    const sideLabels = labels.get(id)!;
    const note = (scores.pairs[id]?.notes ?? "").split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).join(" ");
    if (note === "" && SIDES.every((side) => sideLabels[side].length === 0)) return [];
    const shown = SIDES.map((side) => `${side} (${pair[side]}): ${sideLabels[side].join(", ") || "none"}`).join("; ");
    return [`- **${id}**: ${shown}.${note ? ` Notes: ${note}` : ""}`];
  });
  const lines = [
    `# Blinded comparison ${key.pairing}: baseline ${key.baseline.run} vs candidate ${key.candidate.run}`,
    ...(unscored.length > 0 ? ["", `**Incomplete review:** ${unscored.length} applicable cell${unscored.length === 1 ? " was" : "s were"} left unscored, so totals and deltas cover the scored cells only.`] : []),
    "",
    "## Runs",
    "",
    "| arm | run | complete | revision | runner | question set | dataset |",
    "|---|---|---|---|---|---|---|",
    ...ARMS.map((arm) => {
      const { run, complete, provenance } = key[arm];
      return `| ${arm} | ${run} | ${complete ? "yes" : "no"} | ${short(provenance.revision)}${provenance.dirty ? " (uncommitted changes)" : ""} | ${short(provenance.runnerRevision)} | ${short(provenance.questionSetDigest)} | ${short(provenance.datasetRevision)} |`;
    }),
    "",
    `Seed: ${key.seed}.`,
    "",
    "## Mapping",
    "",
    "| question | A | B | confounded |",
    "|---|---|---|---|",
    ...Object.entries(key.pairs).map(([id, pair]) => `| ${id} | ${pair.A} | ${pair.B} | ${compared(id) ? (pair.confounded ? "yes" : "no") : "not compared"} |`),
    "",
    "## Totals by criterion",
    "",
    "Each arm's total covers that arm's own scored cells, including questions the other arm didn't answer. Deltas are",
    "candidate minus baseline over the pairs both arms answered and scored: confounded over pairs where a turn names a",
    "different model in each arm or an arm's model wasn't recorded, attributed over the rest.",
    "",
    "| criterion | baseline (own scored cells) | candidate (own scored cells) | attributed delta | confounded delta |",
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
    ...(notCompared.length > 0 ? notCompared : ["None: both arms answered every planned question."]),
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
      (_, i) => `| ${id} | ${i + 1} | ${turnShown(pair.turns.baseline[i])} | ${turnShown(pair.turns.candidate[i])} |`,
    )),
    "",
    "## Failure labels",
    "",
    "Questions carrying each label, per arm; `operational_failure` is set wherever an arm gave no answer.",
    "",
    "| label | baseline | candidate |",
    "|---|---|---|",
    ...FAILURE_LABELS.map((label) => {
      const count = (arm: Arm) => Object.entries(key.pairs).filter(([id, pair]) => SIDES.some((side) => pair[side] === arm && labels.get(id)![side].includes(label))).length;
      return `| ${label} | ${count("baseline")} | ${count("candidate")} |`;
    }),
    "",
    "## Labels and notes per question",
    "",
    ...(notes.length > 0 ? notes : ["None."]),
  ];
  return { report: `${lines.join("\n")}\n`, complete: unscored.length === 0 };
}

// --- files -------------------------------------------------------------------------

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isArm = (value: unknown) => value === "baseline" || value === "candidate";

function readJson(path: string, what: string, valid: (value: Record<string, unknown>) => boolean): unknown {
  if (!existsSync(path)) throw new Refusal(`${path} does not exist`);
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new Refusal(`${path} is not JSON: ${error.message}`);
  }
  if (!isObject(value) || !valid(value)) throw new Refusal(`${path} is not ${what}`);
  return value;
}

export const readRun = (path: string) => readJson(path, "a run record (research-quality-eval.ts run writes <run>.run.json)", (run) =>
  typeof run.run === "string" && isObject(run.provenance) && typeof run.provenance.questionSetDigest === "string"
  && typeof run.provenance.datasetRevision === "string" && Array.isArray(run.planned) && typeof run.complete === "boolean" && Array.isArray(run.questions)) as RunRecord;

const isArmRun = (value: unknown) => isObject(value) && typeof value.run === "string" && typeof value.file === "string" && typeof value.complete === "boolean"
  && isObject(value.provenance) && typeof value.provenance.dirty === "boolean"
  && (["revision", "runnerRevision", "questionSetDigest", "datasetRevision"] as const).every((field) => typeof (value.provenance as Record<string, unknown>)[field] === "string");
const isTurnFacts = (value: unknown) => isObject(value) && typeof value.outcome === "string" && (value.answeredBy === undefined || value.answeredBy === null || typeof value.answeredBy === "string");
const isArrayOf = (value: unknown, valid: (item: unknown) => boolean) => Array.isArray(value) && value.every(valid);

export const readKey = (path: string) => readJson(path, "a pairing key", (key) =>
  typeof key.pairing === "string" && typeof key.seed === "number" && ARMS.every((arm) => isArmRun(key[arm]))
  && isObject(key.missing) && Object.values(key.missing).every((arms) => Array.isArray(arms) && arms.length >= 1 && arms.every(isArm) && new Set(arms).size === arms.length)
  && isObject(key.pairs) && Object.values(key.pairs).every((pair) => isObject(pair) && isArm(pair.A) && isArm(pair.B) && pair.A !== pair.B
    && typeof pair.confounded === "boolean" && isArrayOf(pair.notApplicable, (id) => typeof id === "string")
    && isObject(pair.turns) && ARMS.every((arm) => isArrayOf((pair.turns as Record<string, unknown>)[arm], isTurnFacts)))) as PairKey;

export const readScores = (path: string) => readJson(path, "a pairs.scores.json", (scores) =>
  typeof scores.pairing === "string" && isObject(scores.pairs)
  && Object.values(scores.pairs).every((pair) => isObject(pair) && isObject(pair.A) && isObject(pair.B) && typeof pair.notes === "string"
    && isObject(pair.labels) && SIDES.every((side) => Array.isArray((pair.labels as Record<string, unknown>)[side])))) as PairScores;

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const DIGEST_LINE = /^Scores digest: `([0-9a-f]{64})`\.$/u;

export function writePairing(dir: string, keyFile: string, pairing: string, { packet, scores, key }: { packet: string; scores: PairScores; key: PairKey }): void {
  mkdirSync(dir, { recursive: true });
  mkdirSync(dirname(keyFile), { recursive: true });
  // The key goes last and nothing of this pairing stays on a failure, so no key points at another packet.
  const written: string[] = [];
  try {
    for (const [path, text] of [
      [join(dir, "pairs.md"), packet],
      [join(dir, "pairs.scores.json"), `${JSON.stringify(scores, null, 2)}\n`],
      [keyFile, `${JSON.stringify(key, null, 2)}\n`],
    ] as const) {
      writeFileSync(path, text, { flag: "wx" });
      written.push(path);
    }
  } catch (error) {
    for (const path of written) unlinkSync(path);
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    throw new Refusal(`a pairing with id ${pairing} already exists; wait a second and retry`);
  }
}

function pair(baselineFile: string, candidateFile: string, seedText: string | undefined): void {
  const seed = parseSeed(seedText);
  const files = { baseline: resolve(baselineFile), candidate: resolve(candidateFile) };
  const pairing = runStamp(new Date());
  const dir = join(RUNS_DIR, "pairs", pairing);
  writePairing(dir, keyFileFor(pairing), pairing, buildPair(readRun(files.baseline), readRun(files.candidate), seed, pairing, files));
  console.log(`packet: ${join(dir, "pairs.md")}\nscore:  ${join(dir, "pairs.scores.json")}\nkey:    ${keyFileFor(pairing)} (don't open it before scoring)`);
}

// Each arm's run.json and report beside the reveal, so the pairing outlives .dev/. A copy
// already there must match its run; one that's missing is copied again.
function keepRunCopies(dir: string, key: PairKey): void {
  const copies = ARMS.flatMap((arm) => [
    [key[arm].file, join(dir, `${arm}.run.json`)] as const,
    [key[arm].file.replace(/\.run\.json$/u, ".md"), join(dir, `${arm}.md`)] as const,
  ]);
  for (const [from, to] of copies) {
    if (!existsSync(to) && !existsSync(from)) throw new Refusal(`${from} is gone, so the reveal can't keep a copy of it beside the scores`);
    if (existsSync(to) && existsSync(from) && !readFileSync(from).equals(readFileSync(to))) {
      throw new Refusal(`${to} differs from ${from}, the run it copies; put the run's copy back`);
    }
  }
  for (const [from, to] of copies) {
    if (!existsSync(to)) copyFileSync(from, to, constants.COPYFILE_EXCL);
  }
}

// A reveal locks its scores in .reveal-scores-digest before it copies an arm's run, since
// the copies already tell the arms apart; reveal.md, written once, is the last write. Once
// either exists, scores changed since aren't blind, so the reveal is refused rather than
// redone, a complete one after an --incomplete one included. Unchanged scores point at
// reveal.md, or finish the reveal an interruption stopped, restoring any missing run copy.
export function revealPair(dir: string, keyFile: string | undefined, incomplete: boolean): string {
  const folder = basename(resolve(dir));
  const scoresFile = join(dir, "pairs.scores.json");
  const scores = readScores(scoresFile);
  const key = readKey(keyFile ?? keyFileFor(folder));
  if (key.pairing !== scores.pairing || key.pairing !== folder) {
    throw new Refusal(`this key is pairing ${key.pairing}'s, but ${scoresFile} is pairing ${scores.pairing}'s in folder ${folder}; reveal a packet with its own key`);
  }
  const digest = sha256(JSON.stringify(scores));
  const out = join(dir, "reveal.md");
  const lock = join(dir, ".reveal-scores-digest");
  const revealed = existsSync(out);
  if (revealed) {
    // Only the last line is the reveal's own; a note above it could look like a digest.
    const then = DIGEST_LINE.exec(readFileSync(out, "utf8").trimEnd().split("\n").at(-1) ?? "")?.[1];
    if (then !== digest) {
      throw new Refusal(`${out} already revealed this pairing, and ${scoresFile} changed since (${then ?? "no digest"} then, ${digest} now); scores entered after the reveal aren't blind`);
    }
  }
  const locked = existsSync(lock) ? readFileSync(lock, "utf8").trim() : undefined;
  if (locked !== undefined && locked !== digest) {
    throw new Refusal(`a reveal of this pairing began with other scores (${lock}: ${locked} then, ${digest} now), so the mapping may have been seen; scores entered after a reveal began aren't blind`);
  }
  const report = revealed ? undefined : reveal(key, scores, incomplete).report;
  if (locked === undefined) writeFileSync(lock, `${digest}\n`, { flag: "wx" });
  keepRunCopies(dir, key);
  if (report !== undefined) writeFileSync(out, `${report}\nScores digest: \`${digest}\`.\n`, { flag: "wx" });
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await runCli(() => {
    const { positionals: [command, first, second], values } = parseArgs({
      allowPositionals: true,
      options: { seed: { type: "string" }, incomplete: { type: "boolean", default: false } },
    });
    if (command === "pair" && first && second) pair(first, second, values.seed);
    else if (command === "reveal" && first) console.log(`reveal: ${revealPair(first, second, values.incomplete)}`);
    else {
      console.error([
        "usage: research-quality-pairs.ts pair <baseline.run.json> <candidate.run.json> [--seed N]",
        "       research-quality-pairs.ts reveal <pairs dir> [key file] [--incomplete]",
      ].join("\n"));
      process.exitCode = 2;
    }
  });
}

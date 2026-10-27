import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { Refusal, questionSetDigest, type AnsweredTurn, type RunRecord, type Score } from "./research-quality-eval.ts";
import {
  buildPair,
  confounded,
  parseSeed,
  readRun,
  readScores,
  reveal,
  revealPair,
  writePairing,
  type Arm,
  type PairKey,
  type PairScores,
} from "./research-quality-pairs.ts";
import { QUESTIONS, RUBRIC } from "./research-quality-questions.ts";

const said = (text: string, answeredBy: string | null = "a/m"): AnsweredTurn =>
  ({ message: "m", outcome: "completed", blocks: [{ kind: "rich_text", segments: [{ type: "text", text }] }], elapsedMs: 1000, answeredBy, assertions: null });
const failed = (outcome: AnsweredTurn["outcome"]): AnsweredTurn => ({ message: "m", outcome, blocks: [], elapsedMs: 180_000, answeredBy: null, assertions: null });
const IDS = ["single-latest-quarter", "peer-two", "missing-cash-flow", "ticker-page-compare"];
const runOf = (run: string, revision: string, turns: Record<string, AnsweredTurn[]>, complete = true): RunRecord => ({
  run,
  model: `${run}-route/model`,
  blind: true,
  provenance: { revision, runnerRevision: "runner0000000000cccc", dirty: false, questionSetDigest: questionSetDigest(), datasetRevision: "2".repeat(64) },
  planned: IDS,
  complete,
  questions: Object.entries(turns).map(([id, t]) => ({ question: QUESTIONS.find((q) => q.id === id)!, threadId: `thread-${run}-${id}`, turns: t })),
});
const baselineRun = runOf("2026-10-01T000000", "baserev0000000000aaaa", {
  "single-latest-quarter": [said("Ottawa on the latest quarter.")],
  "peer-two": [said("Ottawa on NVDA and AMD.")],
  "missing-cash-flow": [said("Ottawa: cash flow is not available.")],
  "ticker-page-compare": [said("Ottawa on AAPL and NVDA.")],
});
const candidateRun = runOf("2026-10-02T000000", "candrev1111111111bbbb", {
  "single-latest-quarter": [said("Lisbon on the latest quarter.")],
  "peer-two": [said("Lisbon on NVDA and AMD.", "fallback/other")],
  "missing-cash-flow": [failed("timeout")],
  "ticker-page-compare": [said("Lisbon on AAPL and NVDA.")],
});
const FILES = { baseline: "/runs/base.run.json", candidate: "/runs/cand.run.json" };
const paired = (seed = 7, pairing = "2026-10-03T000000", baseline = baselineRun, candidate = candidateRun) => buildPair(baseline, candidate, seed, pairing, FILES);
const ORDER_7 = ["missing-cash-flow", "peer-two", "ticker-page-compare", "single-latest-quarter"];
const SIDES_7 = [["missing-cash-flow", "candidate"], ["peer-two", "candidate"], ["ticker-page-compare", "baseline"], ["single-latest-quarter", "baseline"]];
const ORDER_8 = ["missing-cash-flow", "ticker-page-compare", "peer-two", "single-latest-quarter"];
const packetOrder = (packet: string) => [...packet.matchAll(/^## \d+\. (\S+)/gmu)].map((match) => match[1]);
const sideOf = (key: PairKey, id: string, arm: Arm) => (key.pairs[id]!.A === arm ? "A" : "B");
const refusal = (pattern: RegExp) => (error: unknown) => error instanceof Refusal && pattern.test(error.message);

test("a seed fixes the packet's question order and A/B sides, and another seed shuffles differently (#222)", () => {
  const first = paired();
  assert.deepEqual(paired(), first);
  assert.deepEqual(packetOrder(first.packet), ORDER_7);
  assert.deepEqual(Object.entries(first.key.pairs).map(([id, pair]) => [id, pair.A]), SIDES_7);
  assert.deepEqual(packetOrder(paired(8).packet), ORDER_8);
  assert.equal(first.key.seed, 7);
});

test("a seed is a whole number below 2^32 (#222)", () => {
  assert.equal(parseSeed("7"), 7);
  assert.equal(parseSeed("4294967295"), 4294967295);
  for (const bad of ["4294967296", "-1", "1e3", "7x", "", "1.5"]) {
    assert.throws(() => parseSeed(bad), refusal(/^--seed .* is not a whole number below 2\^32$/u), bad);
  }
});

test("two runs of different question sets or datasets, or of another question set than this runner's, are not paired (#222)", async () => {
  const otherQuestions = { ...candidateRun, provenance: { ...candidateRun.provenance, questionSetDigest: "3".repeat(64) } };
  assert.throws(() => paired(7, "p", baselineRun, otherQuestions), refusal(/^can't pair 2026-10-01T000000 with 2026-10-02T000000: their questionSetDigest differs/u));
  const otherData = { ...candidateRun, provenance: { ...candidateRun.provenance, datasetRevision: "3".repeat(64) } };
  assert.throws(() => paired(7, "p", baselineRun, otherData), refusal(/their datasetRevision differs/u));
  const old = (run: RunRecord) => ({ ...run, provenance: { ...run.provenance, questionSetDigest: "1".repeat(64) } });
  assert.throws(() => paired(7, "p", old(baselineRun), old(candidateRun)), refusal(new RegExp(`they ran question set 1{64}, but this runner's is ${questionSetDigest()}`, "u")));
  const seen = /^can't pair 2026-10-02T000000: it wasn't run with --blind, so its report may have been read; rerun it with --blind$/u;
  assert.throws(() => paired(7, "p", baselineRun, { ...candidateRun, blind: false }), refusal(seen));
  const { blind: _blind, ...unmarked } = candidateRun;
  assert.throws(() => paired(7, "p", baselineRun, unmarked as RunRecord), refusal(seen));

  const { planned: _, ...legacy } = candidateRun;
  const path = join(await mkdtemp(join(tmpdir(), "eval-pair-")), "legacy.run.json");
  await writeFile(path, JSON.stringify(legacy));
  assert.throws(() => readRun(path), refusal(/legacy\.run\.json is not a run record/u));
  await writeFile(path, JSON.stringify(candidateRun));
  assert.equal(readRun(path).run, "2026-10-02T000000");
});

test("the packet shows both answers and never which run, revision or model wrote them (#222)", () => {
  const { packet, scores, key } = paired();
  for (const answer of ["Ottawa on NVDA and AMD.", "Lisbon on NVDA and AMD.", "Ottawa: cash flow is not available."]) assert.match(packet, new RegExp(answer));
  assert.match(packet, /^# Blinded answer pairs: 2026-10-03T000000\n/u);
  assert.match(packet, /\*\*Expect:\*\* Side-by-side latest fiscal year/);
  assert.match(packet, /N\/A: comparable_periods, figures_match_sources, conclusions_justified, counterarguments/);
  assert.match(packet, /- \*\*no_invented_numbers\*\*: Is missing data stated honestly/);
  assert.match(packet, /\*\*Q:\*\* Compare with NVDA\. \(opened from the AAPL page\)/);
  assert.doesNotMatch(packet, /Incomplete runs|Not in this packet/u);
  for (const hidden of ["baserev", "candrev", "runner0", "2026-10-01T000000", "2026-10-02T000000", "route/model", "a/m", "fallback/other", "thread-", "baseline", "candidate"]) {
    assert.doesNotMatch(packet, new RegExp(hidden, "i"), hidden);
  }

  // A turn that timed out is no answer, and its cells are not scored.
  const side = sideOf(key, "missing-cash-flow", "candidate");
  assert.match(packet, /_Not scored: a turn didn't complete, so every cell of this answer is n\/a\._\n\n\*\*Q:\*\* What is AMD's free cash flow\?\n\n_No answer \(timeout\)\._/);
  assert.deepEqual(Object.values(scores.pairs["missing-cash-flow"]![side]), ["n/a", "n/a", "n/a", "n/a", "n/a", "n/a"]);
  assert.deepEqual(scores.pairs["missing-cash-flow"]!.labels, { A: [], B: [] });
  assert.equal(scores.pairing, "2026-10-03T000000");
  assert.equal(key.pairing, "2026-10-03T000000");
  assert.deepEqual(scores.pairs["peer-two"]!.A, { correct_companies: null, comparable_periods: null, figures_match_sources: null, conclusions_justified: null, counterarguments: null, no_invented_numbers: null });
});

test("each cited figure carries a packet-local number that says what it points at, with each block's sources (#222)", () => {
  const FACT = "5939e2b9-4381-40b5-a08f-376ec2b9a3f8";
  const RESULT = "91111111-1111-4111-9111-111111111111";
  const cited: AnsweredTurn = {
    message: "m",
    outcome: "completed",
    answeredBy: "a/m",
    blocks: [
      {
        kind: "financial_answer",
        source_refs: ["44444444-4444-4444-9444-444444444444"],
        financial: {
          presentation_version: "financial-presentation.v2",
          coverage: { state: "complete", requested: 1, verified: 1 },
          labels: { "subject:a": { text: "NVDA" }, "measure:m": { text: "Revenue" }, "period:p": { text: "FY2026" } },
          results: [{ result_id: RESULT, subject_label_id: "subject:a", measure_label_id: "measure:m", period_label_id: "period:p", presented: { kind: "value", text: "USD 130.5B" } }],
          presentations: [],
        },
      },
      {
        kind: "rich_text",
        source_refs: ["00000000-0000-4000-a000-000000000001"],
        data_ref: { kind: "facts", id: "x", params: { fact_bindings: [{ fact_id: FACT, unit: "currency", period_kind: "fiscal_q", period_start: "2025-10-27", period_end: "2026-01-25", as_of: "2026-09-01T00:00:00.000Z", fiscal_year: 2026, fiscal_period: "Q4" }] } },
        segments: [
          { type: "text", text: "Revenue was " },
          { type: "ref", ref_kind: "result", ref_id: RESULT, format: "USD 130.5B", period: "FY2026" },
          { type: "text", text: "; the quarter's was " },
          { type: "ref", ref_kind: "fact", ref_id: FACT, format: "$57.0B" },
          { type: "text", text: ". AMD said " },
          { type: "ref", ref_kind: "claim", ref_id: "6d499c74-bc94-43d6-8468-ae34d0becda2", format: "export controls cost $800M" },
          { type: "text", text: "; " },
          { type: "ref", ref_kind: "fact", ref_id: "aaaaaaaa-0000-4000-8000-000000000000", format: "$1B" },
          { type: "text", text: "." },
        ],
      },
    ],
  };
  const baseline = runOf("2026-10-01T000000", "baserev0000000000aaaa", { "single-latest-quarter": [cited] });
  const candidate = runOf("2026-10-02T000000", "candrev1111111111bbbb", { "single-latest-quarter": [cited] });
  const { packet } = paired(7, "p", { ...baseline, planned: ["single-latest-quarter"] }, { ...candidate, planned: ["single-latest-quarter"] });
  const answer = [
    "Revenue was **USD 130.5B**[1]; the quarter's was **$57.0B**[2]. AMD said **export controls cost $800M**[3]; **$1B**[4].",
    "",
    "_Block sources: S2._",
    "",
    "_Cited:_",
    "",
    "- [1] **USD 130.5B**: engine result: NVDA, Revenue, FY2026: USD 130.5B",
    "- [2] **$57.0B**: fact: Q4 2026 (2025-10-27 to 2026-01-25), currency, as of 2026-09-01T00:00:00.000Z",
    "- [3] **export controls cost $800M**: filed claim, quoted as shown",
    "- [4] **$1B**: fact with no binding in its block",
  ].join("\n");
  for (const side of ["A", "B"]) {
    assert.ok(packet.includes(`### Answer ${side}\n\n**Q:** Analyze NVDA's latest quarter.\n\n*Engine answer: all 1 requested results verified*\n\n_Block sources: S1._\n\n${answer}\n`), packet);
  }
  for (const id of [FACT, RESULT, "6d499c74", "44444444", "00000000-0000"]) assert.doesNotMatch(packet, new RegExp(id), id);
});

test("block sources are named per answer in order of appearance, so a source id minted per stack can't tell the answers apart (#222)", () => {
  const SHARED = "00000000-0000-4000-a000-000000000001";
  const answered = (claimSource: string): AnsweredTurn => ({
    ...said(""),
    blocks: [
      { kind: "rich_text", source_refs: [claimSource, SHARED], segments: [{ type: "text", text: "AMD said " }, { type: "ref", ref_kind: "claim", ref_id: claimSource, format: "export controls cost $800M" }, { type: "text", text: "." }] },
      { kind: "rich_text", source_refs: [SHARED], segments: [{ type: "text", text: "Revenue grew " }, { type: "mention", format: "NVDA" }, { type: "text", text: "." }] },
    ],
  });
  const one = (run: RunRecord) => ({ ...run, planned: ["single-latest-quarter"] });
  const { packet } = paired(7, "p",
    one(runOf("2026-10-01T000000", "baserev0000000000aaaa", { "single-latest-quarter": [answered("aaaaaaaa-1111-4111-8111-111111111111")] })),
    one(runOf("2026-10-02T000000", "candrev1111111111bbbb", { "single-latest-quarter": [answered("bbbbbbbb-2222-4222-8222-222222222222")] })));
  const [, a, b] = packet.split(/^### Answer [AB]\n/mu);
  const answer = [
    "",
    "**Q:** Analyze NVDA's latest quarter.",
    "",
    "AMD said **export controls cost $800M**[1].",
    "",
    "_Block sources: S1, S2._",
    "",
    "Revenue grew [mention segment not shown].",
    "",
    "_Block sources: S2._",
    "",
    "_Cited:_",
    "",
    "- [1] **export controls cost $800M**: filed claim, quoted as shown",
  ].join("\n");
  assert.equal(a!.trimEnd(), answer);
  assert.equal(b!.trimEnd(), answer);
});

test("a pair both arms answered is confounded when a turn names two different models or lacks the field (#222)", () => {
  const { key } = paired();
  assert.deepEqual(Object.fromEntries(Object.entries(key.pairs).map(([id, pair]) => [id, pair.confounded])), {
    "missing-cash-flow": false,
    "peer-two": true,
    "ticker-page-compare": false,
    "single-latest-quarter": false,
  });
  const unrecorded: AnsweredTurn = { message: "m", outcome: "completed", blocks: [] };
  assert.equal(confounded([said("x", "a/m")], [said("y", "a/m")]), false);
  // Chat omits answered_by when no model wrote the answer, and the runner records that as null.
  assert.equal(confounded([said("x", null)], [said("y", null)]), false);
  assert.equal(confounded([said("x", null)], [said("y", "a/m")]), false);
  assert.equal(confounded([said("x", "a/m")], [said("y", "b/m")]), true);
  assert.equal(confounded([unrecorded], [said("y", "a/m")]), true);
  assert.equal(confounded([said("x", "a/m")], [unrecorded]), true);
  // A failed arm is not compared, so it is never confounded.
  assert.equal(confounded([said("x", "a/m")], [failed("provider_error")]), false);
  assert.equal(confounded([said("x", "a/m"), said("x2", "a/m")], [said("y", "b/m"), failed("timeout")]), false);
});

function scoreArm(scores: PairScores, key: PairKey, id: string, arm: Arm, values: number[]): void {
  const side = sideOf(key, id, arm);
  RUBRIC.forEach((criterion, i) => {
    if (scores.pairs[id]![side][criterion.id] !== "n/a") scores.pairs[id]![side][criterion.id] = values[i] as Score;
  });
}

const scoreAll = (scores: PairScores) => {
  for (const cells of Object.values(scores.pairs)) {
    for (const side of ["A", "B"] as const) for (const criterion of RUBRIC) if (cells[side][criterion.id] === null) cells[side][criterion.id] = 2;
  }
};

test("reveal refuses while a cell is unscored, unless the review is named incomplete (#222)", () => {
  const { scores, key } = paired();
  assert.throws(() => reveal(key, scores), refusal(/^38 applicable cells are unscored \(.*\); score them, or pass --incomplete/u));
  const partial = reveal(key, scores, true);
  assert.equal(partial.complete, false);
  assert.match(partial.report, /^# Blinded comparison 2026-10-03T000000: baseline 2026-10-01T000000 vs candidate 2026-10-02T000000\n\n\*\*Incomplete review:\*\* 38 applicable cells were left unscored/u);
  assert.match(partial.report, /## Unscored cells\n\n- [a-z-]+ [AB] correct_companies\n/u);

  // A cell of an answer that wasn't given stays n/a.
  const side = sideOf(key, "missing-cash-flow", "candidate");
  scores.pairs["missing-cash-flow"]![side].correct_companies = 2;
  assert.throws(() => reveal(key, scores, true), refusal(new RegExp(`missing-cash-flow\\.${side}\\.correct_companies is 2, but this answer was not given`, "u")));
});

test("reveal refuses another pairing's key (#222)", () => {
  const mine = paired(7, "2026-10-03T000000");
  const theirs = paired(7, "2026-10-04T000000");
  scoreAll(mine.scores);
  assert.throws(() => reveal(theirs.key, mine.scores), refusal(/^this key is pairing 2026-10-04T000000's, but the scores are pairing 2026-10-03T000000's/u));
  assert.equal(reveal(mine.key, mine.scores).complete, true);
});

test("reveal totals each arm per criterion and compares only pairs both arms answered (#222)", () => {
  const { scores, key } = paired();
  scoreArm(scores, key, "single-latest-quarter", "baseline", [1, 1, 1, 1, 1, 1]);
  scoreArm(scores, key, "single-latest-quarter", "candidate", [2, 2, 2, 2, 2, 2]);
  scoreArm(scores, key, "peer-two", "baseline", [2, 2, 2, 2, 2, 2]);
  scoreArm(scores, key, "peer-two", "candidate", [0, 2, 2, 2, 2, 2]);
  scoreArm(scores, key, "missing-cash-flow", "baseline", [2, 0, 0, 0, 0, 2]);
  scoreArm(scores, key, "ticker-page-compare", "baseline", [2, 0, 2, 1, 1, 2]);
  scoreArm(scores, key, "ticker-page-compare", "candidate", [2, 2, 2, 1, 0, 2]);
  scores.pairs["peer-two"]!.labels[sideOf(key, "peer-two", "candidate")] = ["wrong_subject"];
  scores.pairs["peer-two"]!.notes = "Fallback answered.";
  scores.pairs["missing-cash-flow"]!.labels[sideOf(key, "missing-cash-flow", "candidate")] = ["unstated_gap", "operational_failure", "unstated_gap"];

  const { report, complete } = reveal(key, scores);
  assert.equal(complete, true);
  assert.doesNotMatch(report, /Incomplete/);
  assert.match(report, /\| baseline \| 2026-10-01T000000 \| yes \| `baserev00000` \| `runner000000` \| `[0-9a-f]{12}` \| `222222222222` \|/u);
  assert.ok(report.includes([
    "| criterion | baseline (own scored cells) | candidate (own scored cells) | attributed delta | confounded delta |",
    "|---|---|---|---|---|",
    "| correct_companies | 7/8 | 4/6 | +1 over 2 pairs | -2 over 1 pair |",
    "| comparable_periods | 3/6 | 6/6 | +3 over 2 pairs | 0 over 1 pair |",
    "| figures_match_sources | 5/6 | 6/6 | +1 over 2 pairs | 0 over 1 pair |",
    "| conclusions_justified | 4/6 | 5/6 | +1 over 2 pairs | 0 over 1 pair |",
    "| counterarguments | 4/6 | 4/6 | 0 over 2 pairs | 0 over 1 pair |",
    "| no_invented_numbers | 7/8 | 6/6 | +1 over 2 pairs | 0 over 1 pair |",
  ].join("\n")), report);
  assert.match(report, /## Per-question deltas \(candidate minus baseline\)\n\n\| question[^\n]*\n\|---[^\n]*\n\| ticker-page-compare \| 0 \| \+2 \| 0 \| 0 \| -1 \| 0 \|\n\| single-latest-quarter \| \+1 \| \+1 \| \+1 \| \+1 \| \+1 \| \+1 \|\n\n/u);
  assert.match(report, /## Confounded pairs \(not attributed to the change\)\n\n\| question[^\n]*\n\|---[^\n]*\n\| peer-two \| -2 \| 0 \| 0 \| 0 \| 0 \| 0 \|\n\n/u);
  assert.match(report, /\| missing-cash-flow \| candidate \| baseline \| not compared \|/u);
  assert.match(report, /## Not compared\n\n- missing-cash-flow: the candidate gave no answer \(timeout\)\.\n\n/u);
  assert.match(report, /## Unscored cells\n\nNone\./);
  assert.match(report, /\| peer-two \| 1 \| completed, `a\/m` \| completed, `fallback\/other` \|/);
  assert.match(report, /\| missing-cash-flow \| 1 \| completed, `a\/m` \| timeout, none \|/);
  assert.match(report, /\| wrong_subject \| 0 \| 1 \|\n\| wrong_period \| 0 \| 0 \|\n/);
  assert.match(report, /\| unstated_gap \| 0 \| 1 \|\n\| operational_failure \| 0 \| 1 \|\n/);
  assert.match(report, /## Labels and notes per question\n\n- \*\*missing-cash-flow\*\*: A \(candidate\): unstated_gap, operational_failure; B \(baseline\): none\.\n- \*\*peer-two\*\*: A \(candidate\): wrong_subject; B \(baseline\): none\. Notes: Fallback answered\.\n$/u);
});

test("a completed turn no model wrote leaves its pair attributed, and a turn missing the field confounds it (#222)", () => {
  const candidate = runOf("2026-10-02T000000", "candrev1111111111bbbb", {
    "single-latest-quarter": [said("Lisbon.", null)],
    "peer-two": [said("Lisbon.")],
    "missing-cash-flow": [said("Lisbon.")],
    "ticker-page-compare": [said("Lisbon.")],
  });
  const { scores, key } = paired(7, "p", baselineRun, candidate);
  assert.equal(key.pairs["single-latest-quarter"]!.confounded, false);
  scoreAll(scores);
  const { report } = reveal(key, scores);
  assert.match(report, /\| single-latest-quarter \| 1 \| completed, `a\/m` \| completed, none \(no model wrote it\) \|/u);
  assert.match(report, /## Per-question deltas \(candidate minus baseline\)\n\n\| question[^\n]*\n\|---[^\n]*\n(\|[^\n]*\n)*\| single-latest-quarter \| 0 \| 0 \| 0 \| 0 \| 0 \| 0 \|\n/u);
  const legacy = runOf("2026-10-02T000000", "candrev1111111111bbbb", {
    "single-latest-quarter": [{ message: "m", outcome: "completed", blocks: [{ kind: "rich_text", segments: [{ type: "text", text: "Lisbon." }] }] }],
    "peer-two": [said("Lisbon.")],
    "missing-cash-flow": [said("Lisbon.")],
    "ticker-page-compare": [said("Lisbon.")],
  });
  assert.equal(paired(7, "p", baselineRun, legacy).key.pairs["single-latest-quarter"]!.confounded, true);
});

test("two runs that both stopped early pair only the questions both asked, and say what they left out (#222)", () => {
  const baseline = runOf("2026-10-01T000000", "baserev0000000000aaaa", {
    "single-latest-quarter": [said("Ottawa.")],
    "peer-two": [said("Ottawa.")],
    "missing-cash-flow": [said("Ottawa.")],
  }, false);
  const candidate = runOf("2026-10-02T000000", "candrev1111111111bbbb", {
    "single-latest-quarter": [said("Lisbon.")],
    "peer-two": [said("Lisbon.")],
  }, false);
  const { packet, scores, key } = paired(7, "p", baseline, candidate);
  assert.deepEqual(packetOrder(packet).sort(), ["peer-two", "single-latest-quarter"]);
  assert.match(packet, /\n\n\*\*Incomplete runs:\*\* one run or both stopped before their last question\.\n\nNot in this packet, because a run never asked them: missing-cash-flow, ticker-page-compare\.\n/u);
  assert.deepEqual(Object.keys(scores.pairs).sort(), ["peer-two", "single-latest-quarter"]);
  scoreAll(scores);
  const { report } = reveal(key, scores);
  assert.match(report, /## Not compared\n\n- missing-cash-flow: the candidate never asked it \(stopped early\)\.\n- ticker-page-compare: neither run asked it \(stopped early\)\.\n\n/u);
  assert.match(report, /\| baseline \| 2026-10-01T000000 \| no \|/u);
});

async function pairsOnDisk(pairing: string) {
  const root = await mkdtemp(join(tmpdir(), "eval-reveal-"));
  const runs = join(root, "runs");
  const dir = join(root, "pairs", pairing);
  await mkdir(runs);
  await mkdir(dir, { recursive: true });
  const files = { baseline: join(runs, "2026-10-01T000000.run.json"), candidate: join(runs, "2026-10-02T000000.run.json") };
  for (const arm of ["baseline", "candidate"] as const) {
    await writeFile(files[arm], `{"arm":"${arm}"}\n`);
    await writeFile(files[arm].replace(/\.run\.json$/u, ".md"), `# ${arm} report\n`);
  }
  const { scores, key } = buildPair(baselineRun, candidateRun, 7, pairing, files);
  const keyFile = join(root, "key.json");
  await writeFile(keyFile, JSON.stringify(key));
  const writeScores = (value: PairScores) => writeFile(join(dir, "pairs.scores.json"), JSON.stringify(value, null, 2));
  await writeScores(scores);
  return { dir, keyFile, scores, writeScores };
}

test("a reveal is written once, keeps the runs beside it, and refuses scores changed after it (#222)", async () => {
  const { dir, keyFile, scores, writeScores } = await pairsOnDisk("2026-10-03T000000");
  scoreAll(scores);
  await writeScores(scores);
  const out = revealPair(dir, keyFile, false);
  assert.equal(out, join(dir, "reveal.md"));
  const revealed = await readFile(out, "utf8");
  assert.match(revealed, /^# Blinded comparison 2026-10-03T000000:/u);
  assert.match(revealed, /\nScores digest: `[0-9a-f]{64}`\.\n$/u);
  assert.equal(await readFile(join(dir, "baseline.md"), "utf8"), "# baseline report\n");
  assert.equal(await readFile(join(dir, "candidate.run.json"), "utf8"), '{"arm":"candidate"}\n');

  // The same scores again point at the reveal and leave it as it was.
  assert.equal(revealPair(dir, keyFile, false), out);
  assert.equal(await readFile(out, "utf8"), revealed);

  scores.pairs["peer-two"]!.A.correct_companies = 0;
  await writeScores(scores);
  assert.throws(() => revealPair(dir, keyFile, false), refusal(/reveal\.md already revealed this pairing, and .*pairs\.scores\.json changed since/u));
  assert.equal(await readFile(out, "utf8"), revealed);
});

test("an incomplete reveal keeps the runs beside it too, and a later complete one is refused (#222)", async () => {
  const { dir, keyFile, scores, writeScores } = await pairsOnDisk("2026-10-03T000000");
  const out = revealPair(dir, keyFile, true);
  assert.match(readFileSync(out, "utf8"), /\*\*Incomplete review:\*\* 38 applicable cells were left unscored/u);
  assert.equal(await readFile(join(dir, "baseline.md"), "utf8"), "# baseline report\n");
  assert.equal(await readFile(join(dir, "candidate.run.json"), "utf8"), '{"arm":"candidate"}\n');
  scoreAll(scores);
  await writeScores(scores);
  assert.throws(() => revealPair(dir, keyFile, false), refusal(/already revealed this pairing/u));
});

test("a reveal retried with the same scores restores a missing run copy and refuses one that differs from its run (#222)", async () => {
  const { dir, keyFile, scores, writeScores } = await pairsOnDisk("2026-10-03T000000");
  scoreAll(scores);
  await writeScores(scores);
  const out = revealPair(dir, keyFile, false);
  await unlink(join(dir, "baseline.md"));
  assert.equal(revealPair(dir, keyFile, false), out);
  assert.equal(await readFile(join(dir, "baseline.md"), "utf8"), "# baseline report\n");

  await writeFile(join(dir, "candidate.run.json"), '{"arm":"edited"}\n');
  assert.throws(() => revealPair(dir, keyFile, false), refusal(/candidate\.run\.json differs from .*runs\/2026-10-02T000000\.run\.json, the run it copies; put the run's copy back$/u));
});

test("a note across lines stays on its question's line, and a digest-like note is never read as the reveal's digest (#222)", async () => {
  const { dir, keyFile, scores, writeScores } = await pairsOnDisk("2026-10-03T000000");
  scoreAll(scores);
  scores.pairs["peer-two"]!.notes = `Fine.\nScores digest: \`${"0".repeat(64)}\`.\n  Second line.`;
  await writeScores(scores);
  const out = revealPair(dir, keyFile, false);
  assert.match(readFileSync(out, "utf8"), new RegExp(`\\n- \\*\\*peer-two\\*\\*: A \\(candidate\\): none; B \\(baseline\\): none\\. Notes: Fine\\. Scores digest: \`0{64}\`\\. Second line\\.\\n`, "u"));
  assert.equal(revealPair(dir, keyFile, false), out);
});

test("a second pairing in the same second is refused in one line, not overwritten (#222)", async () => {
  const root = await mkdtemp(join(tmpdir(), "eval-pairing-"));
  const files = { packet: "# p\n", scores: { pairing: "2026-10-03T000000", pairs: {} }, key: paired().key };
  const at = { dir: join(root, "pairs", "2026-10-03T000000"), keyFile: join(root, "keys", "2026-10-03T000000.key.json") };
  writePairing(at.dir, at.keyFile, "2026-10-03T000000", files);
  assert.throws(() => writePairing(at.dir, at.keyFile, "2026-10-03T000000", { ...files, packet: "# other\n" }), refusal(/^a pairing with id 2026-10-03T000000 already exists; wait a second and retry$/u));
  assert.equal(await readFile(join(at.dir, "pairs.md"), "utf8"), "# p\n");
});

test("a pairing that collides with a packet or a key already there leaves no file of its own (#222)", async () => {
  const root = await mkdtemp(join(tmpdir(), "eval-pairing-"));
  const files = { packet: "# p\n", scores: { pairing: "2026-10-03T000000", pairs: {} }, key: paired().key };
  const at = { dir: join(root, "pairs", "2026-10-03T000000"), keyFile: join(root, "keys", "2026-10-03T000000.key.json") };
  await mkdir(at.dir, { recursive: true });
  await writeFile(join(at.dir, "pairs.md"), "# theirs\n");
  assert.throws(() => writePairing(at.dir, at.keyFile, "2026-10-03T000000", files), refusal(/^a pairing with id 2026-10-03T000000 already exists/u));
  assert.deepEqual([existsSync(at.keyFile), existsSync(join(at.dir, "pairs.scores.json"))], [false, false]);
  assert.equal(await readFile(join(at.dir, "pairs.md"), "utf8"), "# theirs\n");

  await unlink(join(at.dir, "pairs.md"));
  await writeFile(at.keyFile, "theirs\n");
  assert.throws(() => writePairing(at.dir, at.keyFile, "2026-10-03T000000", files), refusal(/^a pairing with id 2026-10-03T000000 already exists/u));
  assert.deepEqual(readdirSync(at.dir), []);
  assert.equal(await readFile(at.keyFile, "utf8"), "theirs\n");
});

const filesIn = (dir: string) => Object.fromEntries(readdirSync(dir).sort().map((name) => [name, readFileSync(join(dir, name), "utf8")]));

test("an already-revealed pairing refuses another pairing's key before writing anything (#222)", async () => {
  const p1 = await pairsOnDisk("2026-10-03T000000");
  scoreAll(p1.scores);
  await p1.writeScores(p1.scores);
  revealPair(p1.dir, p1.keyFile, false);
  for (const arm of ["baseline", "candidate"]) {
    await unlink(join(p1.dir, `${arm}.run.json`));
    await unlink(join(p1.dir, `${arm}.md`));
  }
  const before = filesIn(p1.dir);
  const p2 = await pairsOnDisk("2026-10-04T000000");
  assert.throws(() => revealPair(p1.dir, p2.keyFile, false), refusal(/^this key is pairing 2026-10-04T000000's, but .*pairs\.scores\.json is pairing 2026-10-03T000000's/u));
  assert.deepEqual(filesIn(p1.dir), before);
});

test("a key and scores of one pairing are refused in another pairing's folder (#222)", async () => {
  const p1 = await pairsOnDisk("2026-10-03T000000");
  const p2 = await pairsOnDisk("2026-10-04T000000");
  scoreAll(p2.scores);
  await p2.writeScores(p2.scores);
  await writeFile(join(p1.dir, "pairs.scores.json"), JSON.stringify(p2.scores));
  assert.throws(() => revealPair(p1.dir, p2.keyFile, false), refusal(/in folder 2026-10-03T000000/u));
  assert.deepEqual(Object.keys(filesIn(p1.dir)), ["pairs.scores.json"]);
});

test("a reveal that stops after it began locks its scores, so a retry with changed scores is refused (#222)", async () => {
  const { dir, keyFile, scores, writeScores } = await pairsOnDisk("2026-10-03T000000");
  scoreAll(scores);
  await writeScores(scores);
  await writeFile(join(dir, "candidate.run.json"), '{"arm":"edited"}\n');
  assert.throws(() => revealPair(dir, keyFile, false), refusal(/candidate\.run\.json differs from/u));
  assert.equal(existsSync(join(dir, "reveal.md")), false);
  await unlink(join(dir, "candidate.run.json"));

  scores.pairs["peer-two"]!.A.correct_companies = 0;
  await writeScores(scores);
  assert.throws(() => revealPair(dir, keyFile, false), refusal(/^a reveal of this pairing began with other scores \(.*\.reveal-scores-digest: [0-9a-f]{64} then, [0-9a-f]{64} now\)/u));
  assert.deepEqual(Object.keys(filesIn(dir)), [".reveal-scores-digest", "pairs.scores.json"]);
});

test("a reveal refused for an unscored cell locks nothing (#222)", async () => {
  const { dir, keyFile, scores, writeScores } = await pairsOnDisk("2026-10-03T000000");
  assert.throws(() => revealPair(dir, keyFile, false), refusal(/unscored/u));
  assert.deepEqual(Object.keys(filesIn(dir)), ["pairs.scores.json"]);
  scoreAll(scores);
  await writeScores(scores);
  assert.equal(revealPair(dir, keyFile, false), join(dir, "reveal.md"));
});

test("a run copy that differs from its run is refused before any missing copy is made (#222)", async () => {
  const { dir, keyFile, scores, writeScores } = await pairsOnDisk("2026-10-03T000000");
  scoreAll(scores);
  await writeScores(scores);
  revealPair(dir, keyFile, false);
  await unlink(join(dir, "baseline.md"));
  await writeFile(join(dir, "candidate.run.json"), '{"arm":"edited"}\n');
  assert.throws(() => revealPair(dir, keyFile, false), refusal(/candidate\.run\.json differs from/u));
  assert.equal(existsSync(join(dir, "baseline.md")), false);
});

test("a key missing what the reveal reads is refused in one line (#222)", async () => {
  const { dir, keyFile, scores, writeScores } = await pairsOnDisk("2026-10-03T000000");
  scoreAll(scores);
  await writeScores(scores);
  const { key } = buildPair(baselineRun, candidateRun, 7, "2026-10-03T000000", FILES);
  const broken = [
    { ...key, baseline: { file: key.baseline.file } },
    { ...key, candidate: { ...key.candidate, provenance: { revision: "r" } } },
    { ...key, pairs: { ...key.pairs, "peer-two": { ...key.pairs["peer-two"]!, turns: { baseline: [{}], candidate: [] } } } },
    { ...key, missing: { "peer-two": "baseline" } },
    { ...key, missing: { "peer-two": [] } },
    { ...key, missing: { "peer-two": ["baseline", "baseline"] } },
  ];
  for (const value of broken) {
    await writeFile(keyFile, JSON.stringify(value));
    assert.throws(() => revealPair(dir, keyFile, false), refusal(/key\.json is not a pairing key$/u), JSON.stringify(value).slice(0, 120));
  }
  assert.equal(existsSync(join(dir, "reveal.md")), false);
});

test("a scores file of the wrong shape is refused before anything is revealed (#222)", async () => {
  const { dir, keyFile, scores, writeScores } = await pairsOnDisk("2026-10-03T000000");
  const path = join(dir, "pairs.scores.json");
  await writeFile(path, JSON.stringify({ pairing: "2026-10-03T000000", pairs: { "peer-two": { A: {}, B: {}, notes: "" } } }));
  assert.throws(() => readScores(path), refusal(/pairs\.scores\.json is not a pairs\.scores\.json/u));
  await writeFile(path, "{ not json");
  assert.throws(() => revealPair(dir, keyFile, false), refusal(/pairs\.scores\.json is not JSON/u));
  await writeScores(scores);
  assert.throws(() => revealPair(dir, join(dir, "no-key.json"), false), refusal(/no-key\.json does not exist$/u));
  await writeFile(keyFile, JSON.stringify({ pairing: "2026-10-03T000000", seed: 7 }));
  assert.throws(() => revealPair(dir, keyFile, false), refusal(/key\.json is not a pairing key$/u));
  assert.equal(existsSync(join(dir, "reveal.md")), false);
});

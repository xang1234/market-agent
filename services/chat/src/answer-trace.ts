// One answer turn as recorded: what the answer model was given, what it wrote
// raw, what the checks did, what the judge did with its inferences, and the
// blocks the reader ended with, after one repair round for the inferences
// it hid (inference-repair.ts). Written under CHAT_TRACE_DIR; replayed by
// scripts/answer-lab.ts.
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { loadLlmSettingsFromEnv, type LlmChatClient, type LlmChatMessage, type LlmSettingsLoaderEnv } from "../../llm/src/index.ts";
import { isRecord } from "../../shared/src/http.ts";
import { assertionList, checkAssertions, type AssertionReport } from "./assertions.ts";
import { judgeCases, judgeInferences, judgeMessages, verdictsOf, type JudgeCase, type JudgeRecord, type ModelRecord } from "./inference-judge.ts";
import { repairRequests, repairRound, requestRepair, type RepairRequest, type RepairTrace } from "./inference-repair.ts";
import { sentToRepair, shownAs, verdictText, type InferenceVerdict, type ShownAs } from "./verdicts.ts";
import { composeAnalystBlocksWithLlm, renderedAnswer, turnPacket, type AnswerBlocks, type AnswerUsage, type InferenceState, type ModelDeadlines } from "./llm-runtime.ts";

export type AnswerTraceInput = Omit<
  Parameters<typeof composeAnalystBlocksWithLlm>[0],
  "env" | "createClient" | "deadlines" | `on${string}`
>;

export type ModelExchange = {
  messages: ReadonlyArray<{ role: string; content: string }>;
  text: string;
  truncated: boolean;
  deployment: string;
  latency_ms: number;
  usage?: AnswerUsage;
};

export type TurnTrace = {
  version: 2;
  thread_id: string;
  run_id: string;
  turn_id?: string;
  question: string;
  recorded_at: string;
  input: AnswerTraceInput;
  // Null when no model was called.
  exchange: ModelExchange | null;
  // The checks' report, with each judged inference's verdict (judged); each
  // inference the judge hid is a rejection with check "judge", so the accepted
  // inferences are those shown.
  assertions: AssertionReport | null;
  // What the judge did with the answer's inferences, a call per inference in
  // their order; null when it showed none to judge. Absent from traces
  // recorded before the judge gated them, and one record (one call for them
  // all) in those recorded before #376 (recordedJudge).
  judge?: ReadonlyArray<JudgeRecord> | JudgeRecord | null;
  // The repair round for the inferences the checks or the judge hid; null
  // when none was asked for. Absent from traces recorded before it, which
  // replay with none.
  repair?: RepairTrace | null;
  blocks: ReadonlyArray<Record<string, unknown>>;
};

export type TracedAnswer = Pick<TurnTrace, "exchange" | "assertions" | "blocks"> & { judge: ReadonlyArray<JudgeRecord> | null; repair: RepairTrace | null };

// The answer as composed, its inferences not yet judged.
export type ComposedAnswer = Pick<TurnTrace, "exchange" | "assertions"> & { blocks: AnswerBlocks };

export async function composeTraced(
  input: AnswerTraceInput,
  options: {
    env: LlmSettingsLoaderEnv & Record<string, string | undefined>;
    createClient?: () => Promise<LlmChatClient> | LlmChatClient;
    onAnswered?: (deployment: string) => void;
  },
): Promise<ComposedAnswer> {
  let exchange: ModelExchange | null = null;
  let assertions: AssertionReport | null = null;
  const blocks = await composeAnalystBlocksWithLlm({
    ...input,
    ...options,
    onModelExchange: (sent) => {
      exchange = sent;
    },
    onAssertions: (report) => {
      assertions = report;
    },
  });
  return { exchange, assertions, blocks };
}

// The inferences a rendered answer would show, each beside what it rests on,
// as the judge reads them; the fallback sentence shows none.
export function inferenceCases(input: AnswerTraceInput, report: AssertionReport | null): { cases: JudgeCase[]; companies: ReadonlyArray<string> } {
  if (report?.rendered !== true) return { cases: [], companies: [] };
  const packet = input.packet ?? turnPacket(input);
  return { cases: judgeCases(report.accepted, packet, input.factBlocks ?? []), companies: packet.companies };
}

// What the reader ends with: each inference as its verdict shows it
// (shownAs).
// records: the judge's, one per case.
export function judgedAnswer(answer: ComposedAnswer, cases: ReadonlyArray<JudgeCase>, records: ReadonlyArray<JudgeRecord>): TracedAnswer {
  return { ...withVerdicts(answer, verdictsFor(cases, records)), judge: cases.length === 0 ? null : records, repair: null };
}

function verdictsFor(cases: ReadonlyArray<JudgeCase>, records: ReadonlyArray<ModelRecord>): InferenceVerdict[] {
  return cases.flatMap((inference, i) => verdictsOf([inference], records[i] ?? NO_RECORD));
}

function withVerdicts(answer: ComposedAnswer, judged: ReadonlyArray<InferenceVerdict>): Pick<TracedAnswer, "exchange" | "assertions" | "blocks"> {
  if (judged.length === 0) return { exchange: answer.exchange, assertions: answer.assertions, blocks: answer.blocks(new Map()) };
  const shown = new Map(judged.flatMap((verdict) => {
    const as = shownAs(verdict);
    return as === "hidden" ? [] : [[verdict.index, as] as const];
  }));
  const hidden = judged.filter((verdict) => !shown.has(verdict.index));
  const report = answer.assertions!;
  return {
    exchange: answer.exchange,
    assertions: {
      ...report,
      accepted: report.accepted.filter((entry) => !hidden.some((verdict) => verdict.index === entry.index)),
      rejected: [
        ...report.rejected,
        // One a check rejected after its verdict (a failed repair) keeps that rejection.
        ...hidden.flatMap((verdict) => {
          const entry = report.accepted.find((accepted) => accepted.index === verdict.index);
          return entry ? [{ index: verdict.index, text: entry.text, check: "judge" as const, reason: verdictText(verdict) }] : [];
        }),
      ].sort((a, b) => a.index - b.index),
      judged,
    },
    blocks: answer.blocks(shown),
  };
}

// The inferences a rendered answer would send to repair once these verdicts
// are in.
function repairsFor(answer: ComposedAnswer, verdicts: ReadonlyArray<InferenceVerdict>): RepairRequest[] {
  if (answer.assertions?.rendered !== true || answer.exchange === null) return [];
  return repairRequests(assertionList(answer.exchange.text) ?? [], answer.assertions, verdicts);
}

type RepairCalls = {
  repair: (messages: LlmChatMessage[]) => Promise<ModelRecord>;
  judge: (inference: JudgeCase, i: number) => Promise<ModelRecord>;
};

// The answer as its verdicts leave it, then as one repair round leaves it:
// each repaired inference's verdict in place of its first, and the rest as
// they were. A repair never leaves the reader worse off: one whose first
// verdict showed it keeps its first text and verdict when the repair left it
// out, failed the checks or was judged hidden. calls: none when no repair may
// run. merged hears the repaired answer's blocks before its inferences are
// judged.
async function repairedAnswer(
  input: AnswerTraceInput,
  answer: ComposedAnswer,
  cases: ReadonlyArray<JudgeCase>,
  records: ReadonlyArray<ModelRecord>,
  calls: RepairCalls | null,
  merged?: (blocks: AnswerBlocks) => void,
): Promise<TracedAnswer> {
  const first = judgedAnswer(answer, cases, records);
  const verdicts = first.assertions?.judged ?? [];
  const requests = calls ? repairsFor(answer, verdicts) : [];
  if (!calls || requests.length === 0) return first;
  const packet = input.packet ?? turnPacket(input);
  const round = await repairRound({
    messages: answer.exchange!.messages,
    list: assertionList(answer.exchange!.text) ?? [],
    requests,
    packet,
    factBlocks: input.factBlocks ?? [],
    repair: calls.repair,
    judge: calls.judge,
    checked: (report) => merged?.(renderedAnswer(input, packet, report).blocks),
  });
  const repair = { requests, record: round.record, judge: round.records };
  if (round.repaired.length === 0) return { ...first, repair };
  // A repair that failed the checks has no verdict of its own: its first
  // still counts it, hidden unless it showed.
  const judged = verdictsFor(round.cases, round.records);
  const restored = round.repaired.filter((index) => {
    const before = verdicts.find((verdict) => verdict.index === index);
    const after = judged.find((verdict) => verdict.index === index);
    return before !== undefined && shownAs(before) !== "hidden" && (after === undefined || shownAs(after) === "hidden");
  });
  const original = assertionList(answer.exchange!.text) ?? [];
  const rendering = renderedAnswer(input, packet, restored.length === 0
    ? round.report
    : checkAssertions(round.list.map((entry, index) => (restored.includes(index) ? original[index] : entry)), packet));
  const second = judged.filter((verdict) => !restored.includes(verdict.index));
  const final = withVerdicts({ exchange: answer.exchange, assertions: rendering.report, blocks: rendering.blocks }, [
    ...verdicts.filter((verdict) => !second.some((repaired) => repaired.index === verdict.index)),
    ...second,
  ].sort((a, b) => a.index - b.index));
  const repaired = round.repaired.filter((index) => !restored.includes(index));
  return { ...final, assertions: { ...final.assertions!, ...(repaired.length > 0 ? { repaired } : {}) }, judge: first.judge, repair };
}

function liveRepairCalls(companies: ReadonlyArray<string>, options: JudgeOptions, judged: (inference: JudgeCase, record: ModelRecord) => void = () => {}): RepairCalls {
  return {
    repair: (messages) => requestRepair({
      messages,
      env: options.env,
      ...(options.createClient ? { createClient: options.createClient } : {}),
      ...(options.repairDeadlines ? { deadlines: options.repairDeadlines } : {}),
    }),
    judge: async (inference) => {
      const record = await judgeOne(inference, companies, options);
      judged(inference, record);
      return record;
    },
  };
}

// An answer judged and repaired live, as a chat turn's is, its verdicts all
// in at once.
export async function judgedLive(input: AnswerTraceInput, answer: ComposedAnswer, options: JudgeOptions): Promise<TracedAnswer> {
  const { cases, companies } = inferenceCases(input, answer.assertions);
  const records = await judgeAnswer(cases, companies, options);
  return repairedAnswer(input, answer, cases, records, (await judgeConfigured(options.env)) ? liveRepairCalls(companies, options) : null);
}

// A recorded judge with fewer calls than today's inferences: those past its
// end show nothing.
const NO_RECORD: JudgeRecord = { outcome: "not_called", reason: "no judge record for this inference" };

type JudgeOptions = {
  env: LlmSettingsLoaderEnv & Record<string, string | undefined>;
  createClient?: () => Promise<LlmChatClient> | LlmChatClient;
  judgeDeadlines?: ModelDeadlines;
  repairDeadlines?: ModelDeadlines;
};

// Only on JUDGE_LITELLM_MODEL: unset, judge calls fall back to the primary
// model, which was not approved for every turn, so no inference shows.
const NO_JUDGE: JudgeRecord = { outcome: "not_called", reason: "no judge model is configured" };

async function judgeConfigured(env: JudgeOptions["env"]): Promise<boolean> {
  return (await loadLlmSettingsFromEnv(env)).judgeModel !== null;
}

// Each inference in a call of its own, all at once (#376).
export async function judgeAnswer(cases: ReadonlyArray<JudgeCase>, companies: ReadonlyArray<string>, options: JudgeOptions): Promise<JudgeRecord[]> {
  if (!(await judgeConfigured(options.env))) return cases.map(() => NO_JUDGE);
  return Promise.all(cases.map((inference) => judgeOne(inference, companies, options)));
}

function judgeOne(inference: JudgeCase, companies: ReadonlyArray<string>, options: JudgeOptions): Promise<JudgeRecord> {
  return judgeInferences({
    cases: [inference],
    companies,
    env: options.env,
    ...(options.createClient ? { createClient: options.createClient } : {}),
    ...(options.judgeDeadlines ? { deadlines: options.judgeDeadlines } : {}),
  });
}

type TurnIds = Pick<TurnTrace, "thread_id" | "run_id" | "turn_id">;

export type AnsweredTurn = Pick<TracedAnswer, "exchange" | "assertions" | "blocks"> & {
  // Present while the judge reads the answer's inferences, or the repair round
  // runs: `blocks` then hold a line in each judged one's place, and each takes
  // its line, as shown or unverified, or drops it, as its own verdict settles.
  // One sent to repair keeps its line until its repaired verdict settles, so
  // no repaired text shows unjudged; done restores a failed repair's first.
  judging?: {
    // Called at once with the blocks as the verdicts so far leave them, then
    // again as each later verdict settles.
    watch(listener: (blocks: TracedAnswer["blocks"]) => void): void;
    // What the reader ends with, once every verdict is in, the repair round
    // with them, and the trace is written. It never rejects.
    done: Promise<Pick<TracedAnswer, "assertions" | "blocks">>;
  };
};

// A chat turn's answer, gated by the judge, and its trace.
export async function answerTurn(
  input: AnswerTraceInput,
  turn: TurnIds & Pick<TurnTrace, "question">,
  options: JudgeOptions & { onAnswered?: (deployment: string) => void; traceDir?: string },
): Promise<AnsweredTurn> {
  const answer = await composeTraced(input, {
    env: options.env,
    ...(options.createClient ? { createClient: options.createClient } : {}),
    ...(options.onAnswered ? { onAnswered: options.onAnswered } : {}),
  });
  const recorded_at = new Date().toISOString();
  const { cases, companies } = inferenceCases(input, answer.assertions);
  const finish = async (traced: TracedAnswer): Promise<TracedAnswer> => {
    const records = traced.judge ?? [];
    if (cases.length > 0) {
      const { inferences_shown: shown, inferences_unverified: unverified, inferences_hidden: hidden } = inferenceCounts(traced.assertions);
      const deployments = [...new Set(records.flatMap((record) => (record.outcome === "replied" ? [record.exchange.deployment] : [])))];
      const reasons = [...new Set(records.flatMap((record) => (record.outcome === "replied" ? [] : [record.reason])))];
      console.info(`[chat] judge ${traceIds(turn)}${deployments.length > 0 ? ` on ${deployments.join(", ")}` : ""}: ${shown} shown, ${unverified} unverified, of ${shown + unverified + hidden} inferences${reasons.length > 0 ? ` (${reasons.join("; ")})` : ""}`);
    }
    if (traced.repair) {
      const { inferences_sent_to_repair, inferences_repaired, inferences_recovered } = repairCounts(traced);
      const failed = traced.repair.record.outcome === "replied" ? "" : ` (${traced.repair.record.reason})`;
      console.info(`[chat] repair ${traceIds(turn)}: ${inferences_sent_to_repair} sent, ${inferences_repaired} repaired, ${inferences_recovered} recovered${failed}`);
    }
    await writeTurnTrace(options.traceDir, { version: 2, ...turn, recorded_at, input, ...traced });
    return traced;
  };
  if (cases.length === 0 && repairsFor(answer, []).length === 0) return finish(judgedAnswer(answer, cases, []));
  if (!(await judgeConfigured(options.env))) return finish(judgedAnswer(answer, cases, cases.map(() => NO_JUDGE)));
  const inferences = new Map<number, InferenceState>(cases.map(({ index }) => [index, "pending"]));
  // The first answer's blocks, then the repaired answer's once it is checked.
  let blocksOf = answer.blocks;
  const listeners: Array<(blocks: TracedAnswer["blocks"]) => void> = [];
  const settle = (inference: JudgeCase, record: ModelRecord, repaired: boolean) => {
    const verdict = verdictsOf([inference], record)[0]!;
    const as = !repaired && sentToRepair(verdict) ? "pending" : shownAs(verdict);
    if (as === "hidden") inferences.delete(inference.index);
    else inferences.set(inference.index, as);
    const blocks = blocksOf(inferences);
    // A listener that throws stops hearing verdicts; the answer is still saved.
    for (const listener of [...listeners]) {
      try {
        listener(blocks);
      } catch (error) {
        console.warn(`[chat] judge ${traceIds(turn)}: a verdict listener failed and was dropped`, error);
        listeners.splice(listeners.indexOf(listener), 1);
      }
    }
  };
  const records = cases.map(async (inference) => {
    const record = await judgeOne(inference, companies, options);
    settle(inference, record, false);
    return record;
  });
  const done = Promise.all(records)
    .then((settled) => repairedAnswer(input, answer, cases, settled, liveRepairCalls(companies, options, (inference, record) => settle(inference, record, true)), (blocks) => {
      blocksOf = blocks;
    }))
    .then(finish);
  return {
    exchange: answer.exchange,
    assertions: answer.assertions,
    blocks: answer.blocks(inferences),
    judging: {
      watch: (listener) => {
        listeners.push(listener);
        listener(blocksOf(inferences));
      },
      done: done.then(({ assertions, blocks }) => ({ assertions, blocks })),
    },
  };
}

function traceIds(turn: TurnIds): string {
  return `thread=${turn.thread_id} run=${turn.run_id}${turn.turn_id ? ` turn=${turn.turn_id}` : ""}`;
}

// A recorded turn's input through today's post-processing, with the answer
// model's reply, the judge's records and the repair round's replaced by the
// ones recorded, so no model is called; a trace with no repair recorded
// replays with none. Given live options, rerun "judge" has the judge and the
// repair round run live, and rerun "repair" keeps the recorded verdicts and
// runs only the repair round live. The recorded answer exchange is kept: its
// output, latency and tokens are what was recorded. judge_input_changed:
// today's answer would send the judge, for some inference, something other
// than its recorded reply answered; repair_input_changed: the same for the
// recorded repair round, its call or a repaired inference's judge.
export type LiveReplay = JudgeOptions & { rerun: "judge" | "repair" };

export async function replayRecorded(
  trace: TurnTrace,
  live?: LiveReplay,
): Promise<TurnTrace & Pick<TracedAnswer, "judge" | "repair"> & { judge_input_changed: boolean; repair_input_changed: boolean }> {
  const { exchange } = trace;
  const answer = await composeTraced(trace.input, {
    env: exchange === null ? {} : RECORDED_CHANNEL,
    createClient: () => async () => ({
      text: exchange?.text ?? "",
      truncated: exchange?.truncated,
      ...(exchange?.usage
        ? {
          usage: {
            inputTokens: exchange.usage.input_tokens,
            outputTokens: exchange.usage.output_tokens,
            totalTokens: exchange.usage.input_tokens + exchange.usage.output_tokens,
            ...(exchange.usage.reasoning_tokens === undefined ? {} : { reasoningTokens: exchange.usage.reasoning_tokens }),
          },
        }
        : {}),
    }),
  });
  const { cases, companies } = inferenceCases(trace.input, answer.assertions);
  const records = live?.rerun === "judge" ? await judgeAnswer(cases, companies, live) : recordedJudge(trace, cases);
  const asked = (record: ModelRecord, messages: ReadonlyArray<LlmChatMessage>) =>
    record.outcome === "replied" && !isDeepStrictEqual(record.exchange.messages, messages);
  const recordedRepair = repairRecorded(trace.repair);
  let repairChanged = false;
  const calls: RepairCalls | null = live
    ? (await judgeConfigured(live.env)) ? liveRepairCalls(companies, live) : null
    : recordedRepair && {
      repair: async (messages) => {
        repairChanged ||= asked(recordedRepair.record, messages);
        return recordedRepair.record;
      },
      judge: async (inference, i) => {
        const record = recordedRepair.judge[i] ?? NO_RECORD;
        repairChanged ||= asked(record, judgeMessages([inference], companies));
        return record;
      },
    };
  const replayed = await repairedAnswer(trace.input, answer, cases, records, calls);
  const unrecorded = () => repairsFor(answer, judgedAnswer(answer, cases, records).assertions?.judged ?? []).length > 0;
  return {
    ...trace,
    version: 2,
    ...replayed,
    exchange,
    judge_input_changed: records.some((record, i) => asked(record, judgeMessages([cases[i]!], companies))),
    repair_input_changed: !live && (recordedRepair === null
      ? unrecorded()
      : repairChanged || !isDeepStrictEqual(replayed.repair?.requests ?? [], recordedRepair.requests)),
  };
}

// The recorded judge's record for each case: the one at its place. A trace
// from before #376 recorded one call for every case, and each reads its own
// verdict from it; one from before the judge gated inferences recorded no
// judge reply (or only the shadow judge's verdicts), and its inferences replay
// hidden.
function recordedJudge(trace: TurnTrace, cases: ReadonlyArray<JudgeCase>): JudgeRecord[] {
  const judge: unknown = trace.judge;
  const recorded = (record: unknown): JudgeRecord =>
    isModelRecord(record) ? record : { outcome: "not_called", reason: "this trace recorded no judge reply" };
  return cases.map((_, i) => recorded(Array.isArray(judge) ? judge[i] : judge));
}

// A recorded call's record, in a shape replay can read: a reply with its
// exchange, or a reason none came.
function isModelRecord(record: unknown): record is ModelRecord {
  if (!isRecord(record)) return false;
  if (record.outcome === "replied") return isRecord(record.exchange) && Array.isArray(record.exchange.messages) && typeof record.exchange.text === "string";
  return (record.outcome === "not_called" || record.outcome === "failed") && typeof record.reason === "string";
}

// The recorded repair round, or null when none was recorded or what was
// recorded is not one: either replays as no repair.
function repairRecorded(repair: unknown): RepairTrace | null {
  return isRecord(repair) && Array.isArray(repair.requests) && isModelRecord(repair.record) &&
      Array.isArray(repair.judge) && repair.judge.every(isModelRecord)
    ? repair as RepairTrace
    : null;
}

const RECORDED_CHANNEL = {
  LLM_CHANNELS: "recorded",
  LLM_RECORDED_PROTOCOL: "openai",
  LLM_RECORDED_MODELS: "reply",
  LITELLM_MODEL: "recorded/reply",
};

// Written only when CHAT_TRACE_DIR is set; a failed write never fails the turn,
// and a stalled one holds it at most waitMs (the write carries on behind it).
export async function writeTurnTrace(dir: string | undefined, trace: TurnTrace, waitMs = 2_000): Promise<void> {
  if (!dir) return;
  const ids = traceIds(trace);
  // The ids come from the request; none may leave the trace directory.
  if (![trace.thread_id, trace.run_id, trace.turn_id ?? "-"].every((id) => /^[\w-]+$/.test(id))) {
    console.warn(`[chat] trace not written: ${ids} is not a safe file name`);
    return;
  }
  // One run can carry several turns (coordinator.ts), each its own file.
  const path = join(dir, trace.thread_id, `${trace.run_id}${trace.turn_id ? `.${trace.turn_id}` : ""}.json`);
  const write = (async () => {
    try {
      await mkdir(dirname(path), { recursive: true });
      // Written aside, then renamed: a reader never sees half a trace.
      const partial = `${path}.partial`;
      await writeFile(partial, `${JSON.stringify(trace, null, 2)}\n`);
      await rename(partial, path);
      console.info(`[chat] trace ${ids} ${path}`);
    } catch (error) {
      console.warn(`[chat] trace not written: ${ids}`, error);
    }
  })();
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[chat] trace write still pending after ${waitMs} ms: ${ids}`);
      resolve();
    }, waitMs);
  });
  await Promise.race([write, late]);
  clearTimeout(timer);
}

export type AnswerMetrics = {
  // Figures in the answer as refs: facts, price returns as series, and engine results.
  figure_refs: number;
  // Digit runs in its plain text, figures or not ("Q1", "2025", "$4.2").
  plain_numbers: number;
  // A model answered, and no assertion rendered.
  fallback: boolean;
  accepted: number;
  rejected: number;
  // The answer's inferences the judge entailed, those it found unsupported
  // (shown as unverified), and those it left out.
  inferences_shown: number;
  inferences_unverified: number;
  inferences_hidden: number;
  // Inferences sent to the repair round, those its reply replaced with an
  // entry that passed the checks, and those of them that end shown or
  // unverified on their repaired verdict; one kept as its first verdict
  // showed it, after a failed repair, is neither. The repair call's cost.
  inferences_sent_to_repair: number;
  inferences_repaired: number;
  inferences_recovered: number;
  repair_latency_ms: number;
  repair_input_tokens: number;
  repair_output_tokens: number;
  output_tokens: number;
  latency_ms: number;
};

type Segment = { type?: string; ref_kind?: string; text?: string };

const FIGURE_REFS: ReadonlySet<string> = new Set(["fact", "series", "result"]);

export function answerMetrics(trace: Pick<TurnTrace, "blocks" | "assertions" | "exchange" | "repair">): AnswerMetrics {
  const narrative = trace.blocks.filter((block) => block.kind === "rich_text")
    .map((block) => (Array.isArray(block.segments) ? block.segments as Segment[] : []));
  const text = (segments: ReadonlyArray<Segment>) =>
    segments.map((segment) => (segment.type === "text" ? segment.text ?? "" : "")).join("");
  return {
    figure_refs: narrative.flat().filter((segment) => segment.type === "ref" && FIGURE_REFS.has(segment.ref_kind ?? "")).length,
    plain_numbers: narrative.flatMap((segments) => text(segments).match(/\d+(?:[.,]\d+)*/g) ?? []).length,
    fallback: trace.exchange !== null && trace.assertions?.rendered !== true,
    accepted: trace.assertions?.accepted.length ?? 0,
    rejected: trace.assertions?.rejected.length ?? 0,
    ...inferenceCounts(trace.assertions),
    ...repairCounts(trace),
    output_tokens: trace.exchange?.usage?.output_tokens ?? 0,
    latency_ms: trace.exchange?.latency_ms ?? 0,
  };
}

function inferenceCounts(report: AssertionReport | null): Pick<AnswerMetrics, "inferences_shown" | "inferences_unverified" | "inferences_hidden"> {
  const shown = (report?.judged ?? []).map(shownAs);
  const count = (as: ShownAs) => shown.filter((entry) => entry === as).length;
  return { inferences_shown: count("shown"), inferences_unverified: count("unverified"), inferences_hidden: count("hidden") };
}

function repairCounts(trace: Pick<TurnTrace, "assertions" | "repair">): Pick<AnswerMetrics, "inferences_sent_to_repair" | "inferences_repaired" | "inferences_recovered" | "repair_latency_ms" | "repair_input_tokens" | "repair_output_tokens"> {
  const repair = repairRecorded(trace.repair);
  const record = repair?.record;
  const report = trace.assertions;
  const replaced = repair ? report?.repaired ?? [] : [];
  // Past the checks: accepted, or hidden by the judge after them.
  const passed = replaced.filter((index) =>
    report!.accepted.some((entry) => entry.index === index) || report!.rejected.some((entry) => entry.index === index && entry.check === "judge")
  );
  return {
    inferences_sent_to_repair: repair?.requests.length ?? 0,
    inferences_repaired: passed.length,
    inferences_recovered: (report?.judged ?? []).filter((verdict) => passed.includes(verdict.index) && shownAs(verdict) !== "hidden").length,
    repair_latency_ms: record?.outcome === "replied" ? record.exchange.latency_ms : record?.outcome === "failed" ? record.latency_ms : 0,
    repair_input_tokens: record?.outcome === "replied" ? record.exchange.usage?.input_tokens ?? 0 : 0,
    repair_output_tokens: record?.outcome === "replied" ? record.exchange.usage?.output_tokens ?? 0 : 0,
  };
}

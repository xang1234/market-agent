// One answer turn as recorded: what the answer model was given, what it wrote
// raw, what the checks did, what the judge did with its inferences, and the
// blocks the reader ended with. Written under CHAT_TRACE_DIR; replayed by
// scripts/answer-lab.ts.
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { loadLlmSettingsFromEnv, type LlmChatClient, type LlmSettingsLoaderEnv } from "../../llm/src/index.ts";
import type { AssertionReport } from "./assertions.ts";
import { judgeCases, judgeInferences, judgeMessages, shownAs, verdictsOf, verdictText, type JudgeCase, type JudgeRecord, type ShownAs } from "./inference-judge.ts";
import { composeAnalystBlocksWithLlm, turnPacket, type AnswerBlocks, type AnswerUsage, type InferenceState, type ModelDeadlines } from "./llm-runtime.ts";

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
  blocks: ReadonlyArray<Record<string, unknown>>;
};

export type TracedAnswer = Pick<TurnTrace, "exchange" | "assertions" | "blocks"> & { judge: ReadonlyArray<JudgeRecord> | null };

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
  const packet = turnPacket(input);
  return { cases: judgeCases(report.accepted, packet, input.factBlocks ?? []), companies: packet.companies };
}

// What the reader ends with: each inference as its verdict shows it
// (shownAs).
// records: the judge's, one per case.
export function judgedAnswer(answer: ComposedAnswer, cases: ReadonlyArray<JudgeCase>, records: ReadonlyArray<JudgeRecord>): TracedAnswer {
  if (cases.length === 0) return { ...answer, judge: null, blocks: answer.blocks(new Map()) };
  const judged = cases.flatMap((inference, i) => verdictsOf([inference], records[i]!));
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
        ...hidden.map((verdict) => ({
          index: verdict.index,
          text: report.accepted.find((entry) => entry.index === verdict.index)!.text,
          check: "judge" as const,
          reason: verdictText(verdict),
        })),
      ].sort((a, b) => a.index - b.index),
      judged,
    },
    judge: records,
    blocks: answer.blocks(shown),
  };
}

type JudgeOptions = {
  env: LlmSettingsLoaderEnv & Record<string, string | undefined>;
  createClient?: () => Promise<LlmChatClient> | LlmChatClient;
  judgeDeadlines?: ModelDeadlines;
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
  // Present while the judge reads the answer's inferences: `blocks` then hold a
  // line in each one's place, and each inference takes its line, as shown or
  // unverified, or drops it, as its own verdict settles.
  judging?: {
    // Called at once with the blocks as the verdicts so far leave them, then
    // again as each later verdict settles.
    watch(listener: (blocks: TracedAnswer["blocks"]) => void): void;
    // What the reader ends with, once every verdict is in and the trace is
    // written. It never rejects.
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
  const finish = async (records: ReadonlyArray<JudgeRecord>): Promise<TracedAnswer> => {
    const traced = judgedAnswer(answer, cases, records);
    if (cases.length > 0) {
      const { inferences_shown: shown, inferences_unverified: unverified } = inferenceCounts(traced.assertions);
      const deployments = [...new Set(records.flatMap((record) => (record.outcome === "replied" ? [record.exchange.deployment] : [])))];
      const reasons = [...new Set(records.flatMap((record) => (record.outcome === "replied" ? [] : [record.reason])))];
      console.info(`[chat] judge ${traceIds(turn)}${deployments.length > 0 ? ` on ${deployments.join(", ")}` : ""}: ${shown} shown, ${unverified} unverified, of ${cases.length} inferences${reasons.length > 0 ? ` (${reasons.join("; ")})` : ""}`);
    }
    await writeTurnTrace(options.traceDir, { version: 2, ...turn, recorded_at, input, ...traced });
    return traced;
  };
  if (cases.length === 0) return finish([]);
  if (!(await judgeConfigured(options.env))) return finish(cases.map(() => NO_JUDGE));
  const inferences = new Map<number, InferenceState>(cases.map(({ index }) => [index, "pending"]));
  const listeners: Array<(blocks: TracedAnswer["blocks"]) => void> = [];
  const records = cases.map((inference) =>
    judgeOne(inference, companies, options).then((record) => {
      const as = shownAs(verdictsOf([inference], record)[0]!);
      if (as === "hidden") inferences.delete(inference.index);
      else inferences.set(inference.index, as);
      const blocks = answer.blocks(inferences);
      // A listener that throws stops hearing verdicts; the answer is still saved.
      for (const listener of [...listeners]) {
        try {
          listener(blocks);
        } catch (error) {
          console.warn(`[chat] judge ${traceIds(turn)}: a verdict listener failed and was dropped`, error);
          listeners.splice(listeners.indexOf(listener), 1);
        }
      }
      return record;
    })
  );
  return {
    exchange: answer.exchange,
    assertions: answer.assertions,
    blocks: answer.blocks(inferences),
    judging: {
      watch: (listener) => {
        listeners.push(listener);
        listener(answer.blocks(inferences));
      },
      done: Promise.all(records).then(finish).then(({ assertions, blocks }) => ({ assertions, blocks })),
    },
  };
}

function traceIds(turn: TurnIds): string {
  return `thread=${turn.thread_id} run=${turn.run_id}${turn.turn_id ? ` turn=${turn.turn_id}` : ""}`;
}

// A recorded turn's input through today's post-processing, with the answer
// model's reply and the judge's record replaced by the ones recorded, so no
// model is called; or, given a judge, with its live verdicts in place of the
// recorded ones. The recorded answer exchange is kept: its output, latency and
// tokens are what was recorded. judge_input_changed: today's answer would send
// the judge, for some inference, something other than its recorded reply
// answered.
export async function replayRecorded(trace: TurnTrace, judge?: JudgeOptions): Promise<TurnTrace & Pick<TracedAnswer, "judge"> & { judge_input_changed: boolean }> {
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
  const records = judge ? await judgeAnswer(cases, companies, judge) : recordedJudge(trace, cases);
  return {
    ...trace,
    version: 2,
    ...judgedAnswer(answer, cases, records),
    exchange,
    judge_input_changed: records.some((record, i) =>
      record.outcome === "replied" && !isDeepStrictEqual(record.exchange.messages, judgeMessages([cases[i]!], companies))
    ),
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
    record !== null && typeof record === "object" && "outcome" in record
      ? record as JudgeRecord
      : { outcome: "not_called", reason: "this trace recorded no judge reply" };
  return cases.map((_, i) => recorded(Array.isArray(judge) ? judge[i] : judge));
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
  // Figures in the answer as sealed refs: facts, and price returns as series.
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
  output_tokens: number;
  latency_ms: number;
};

type Segment = { type?: string; ref_kind?: string; text?: string };

export function answerMetrics(trace: Pick<TurnTrace, "blocks" | "assertions" | "exchange">): AnswerMetrics {
  const narrative = trace.blocks.filter((block) => block.kind === "rich_text")
    .map((block) => (Array.isArray(block.segments) ? block.segments as Segment[] : []));
  const text = (segments: ReadonlyArray<Segment>) =>
    segments.map((segment) => (segment.type === "text" ? segment.text ?? "" : "")).join("");
  return {
    figure_refs: narrative.flat().filter((segment) => segment.type === "ref" && (segment.ref_kind === "fact" || segment.ref_kind === "series")).length,
    plain_numbers: narrative.flatMap((segments) => text(segments).match(/\d+(?:[.,]\d+)*/g) ?? []).length,
    fallback: trace.exchange !== null && trace.assertions?.rendered !== true,
    accepted: trace.assertions?.accepted.length ?? 0,
    rejected: trace.assertions?.rejected.length ?? 0,
    ...inferenceCounts(trace.assertions),
    output_tokens: trace.exchange?.usage?.output_tokens ?? 0,
    latency_ms: trace.exchange?.latency_ms ?? 0,
  };
}

function inferenceCounts(report: AssertionReport | null): Pick<AnswerMetrics, "inferences_shown" | "inferences_unverified" | "inferences_hidden"> {
  const shown = (report?.judged ?? []).map(shownAs);
  const count = (as: ShownAs) => shown.filter((entry) => entry === as).length;
  return { inferences_shown: count("shown"), inferences_unverified: count("unverified"), inferences_hidden: count("hidden") };
}

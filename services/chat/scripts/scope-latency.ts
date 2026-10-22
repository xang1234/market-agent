// Time to a follow-up's first block ("Compare it with AMD" after an answer on
// NVDA), with stubbed timings, at the coordinator a path names, to compare two
// commits:
//
//   node --experimental-strip-types scripts/scope-latency.ts [path/to/coordinator.ts]
//
// A coordinator with no shared reading gets one per lane.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SCALE = 10;
const PRIOR_MS = 20;
const RESOLVE_MS = 20;
const ANSWER_MS = 3_000;
const PLANNER_MS = 2_000;
const READING_MS = [1_000, 3_000, 9_000];

const coordinatorPath = resolve(process.argv[2] ?? resolve(import.meta.dirname, "../src/coordinator.ts"));
const { createChatCoordinator } = await import(pathToFileURL(coordinatorPath).href);

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms / SCALE));
const company = (ticker: string) => {
  const subject_ref = { kind: "listing", id: `listing-${ticker}` };
  return {
    status: "resolved", input_text: ticker, normalized_input: ticker, subject_ref, identity_level: "listing", display_label: ticker,
    resolution_path: "auto_advanced", confidence: 1,
    handoff: { subject_ref, identity_level: "listing", display_label: ticker, display_labels: { ticker }, normalized_input: ticker, resolution_path: "auto_advanced", confidence: 1, context: {} },
  };
};
const reading = (ms: number) => async () => {
  await sleep(ms);
  return {
    metrics: [], asks: new Set(), turns_off: { facets: new Set(), metrics: new Set() }, income_items: [], period: { kind: "latest" },
    companies: { kind: "compare", add: ["AMD"] },
  };
};

async function firstBlockMs(readingMs: number, lane: "analyst" | "financial"): Promise<{ ms: number; tickers: string[]; readings: number }> {
  let readings = 0;
  const read = reading(readingMs);
  const counted = () => {
    readings += 1;
    return read();
  };
  const started = performance.now();
  let ms = 0;
  let tickers: string[] = [];
  const turn = createChatCoordinator({
    preResolveSubject: async ({ text }: { text: string }) => {
      await sleep(RESOLVE_MS);
      return /^[A-Z]{2,5}$/.test(text) ? company(text) : { status: "not_found", input_text: text, normalized_input: text, message: "none" };
    },
    loadPriorSubjects: async () => {
      await sleep(PRIOR_MS);
      return [company("NVDA")];
    },
    readQuestion: counted,
    runner: async (context: { reading?: () => Promise<unknown>; subjectPreResolutions?: Array<{ input_text: string }>; emit: (type: string, payload?: object) => void }) => {
      tickers = (context.subjectPreResolutions ?? []).map((subject) => subject.input_text);
      const shared = context.reading ?? counted;
      if (lane === "analyst") {
        await shared();
        await sleep(ANSWER_MS);
      } else {
        await Promise.all([shared(), sleep(PLANNER_MS)]);
      }
      ms = (performance.now() - started) * SCALE;
      context.emit("block.began", { block_id: "b1", kind: "rich_text" });
      context.emit("turn.completed", { message_id: "m1" });
    },
  }).getOrCreateTurn({ threadId: "thread-1", runId: "run-1", userIntent: "Compare it with AMD" });
  await turn.completed;
  return { ms: Math.round(ms), tickers, readings };
}

console.log(`coordinator: ${coordinatorPath}`);
console.log(`stubbed: prior ${PRIOR_MS} ms, each name ${RESOLVE_MS} ms, answer model ${ANSWER_MS} ms, planner ${PLANNER_MS} ms (run at 1/${SCALE} speed)`);
for (const lane of ["analyst", "financial"] as const) {
  for (const readingMs of READING_MS) {
    const { ms, tickers, readings } = await firstBlockMs(readingMs, lane);
    console.log(`${lane.padEnd(9)} reading ${String(readingMs).padStart(5)} ms: first block at ${String(ms).padStart(6)} ms, companies ${tickers.join(", ")}, ${readings} reading call(s)`);
  }
}

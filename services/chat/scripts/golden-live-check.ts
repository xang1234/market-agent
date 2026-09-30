// Data mode (#123): the golden conversation (#118) against a live stack, as an opt-in
// check. Live figures and model wording vary, so this checks structure only (turns
// complete; the charts and tables the frozen golden test pins appear), never values.
// Prerequisite: NVDA's and AMD's live identities and SEC facts are already in the
// database (chat reads persisted facts only); a fresh database fails until #152.
//
//   npm run golden:live -- [base URL, default http://127.0.0.1:5173]
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

type Block = { id?: string; kind?: string };
type TurnOutcome = "turn.completed" | "turn.error" | "timeout";
export type GoldenTurn = { question: string; check: (kinds: ReadonlySet<string>) => { failures: string[]; notes: string[] } };

export const GOLDEN_TURNS: ReadonlyArray<GoldenTurn> = [
  {
    question: "Analyze NVDA",
    check: (kinds) => ({
      failures: (kinds.has("revenue_bars") || kinds.has("line_chart")) && kinds.has("metric_row")
        ? []
        : ["expected a chart (revenue_bars or line_chart) and a metric_row"],
      notes: [],
    }),
  },
  {
    question: "Compare it with AMD",
    check: (kinds) => ({
      failures: kinds.has("metrics_comparison") ? [] : ["expected a metrics_comparison"],
      // A missing live bar range degrades to no price chart by design (#133).
      notes: kinds.has("perf_comparison") ? [] : ["no perf_comparison (live price bars missing?)"],
    }),
  },
  { question: "Explain the differences and show the evidence", check: () => ({ failures: [], notes: [] }) },
];

export function evaluateGoldenTurn(
  turn: GoldenTurn,
  result: { outcome: TurnOutcome; blocks: ReadonlyArray<Block> },
): { failures: string[]; notes: string[] } {
  if (result.outcome !== "turn.completed") return { failures: [`turn ended with ${result.outcome}`], notes: [] };
  const kinds = new Set(result.blocks.map((block) => String(block.kind)));
  const { failures, notes } = turn.check(kinds);
  return {
    failures: failures.map((failure) => `${failure}; got [${[...kinds].join(", ")}]`),
    notes,
  };
}

const USER_ID = "00000000-0000-4000-8000-000000000001";

async function api<T>(base: string, method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "x-user-id": USER_ID, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}

// As the web client does: save the user's message, then stream the turn until it ends.
export async function runTurn(
  base: string,
  threadId: string,
  question: string,
  timeoutMs = 180_000,
): Promise<TurnOutcome> {
  const messageId = randomUUID();
  await api(base, "POST", `/v1/chat/threads/${threadId}/messages`, {
    message_id: messageId,
    snapshot_id: randomUUID(),
    content: question,
  });
  const params = new URLSearchParams({ run_id: randomUUID(), turn_id: messageId, user_intent: question, user_id: USER_ID });
  // The signal also rejects a pending body read, so a stream that goes silent (server
  // crash, half-open connection) still ends at the deadline instead of hanging.
  const signal = AbortSignal.timeout(timeoutMs);
  const decoder = new TextDecoder();
  let transcript = "";
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(`${base}/v1/chat/threads/${threadId}/stream?${params}`, {
      headers: { "x-user-id": USER_ID },
      signal,
    });
    reader = response.body!.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return "timeout"; // the server closed the stream before the turn ended
      transcript += decoder.decode(value, { stream: true });
      if (/event: turn\.completed/.test(transcript)) return "turn.completed";
      if (/event: turn\.error/.test(transcript)) return "turn.error";
    }
  } catch (error) {
    if (signal.aborted) return "timeout";
    throw error;
  } finally {
    await reader?.cancel().catch(() => {});
  }
}

async function main(base: string): Promise<number> {
  const thread = await api<{ thread_id: string }>(base, "POST", "/v1/chat/threads", { title: "Golden (live data)" });
  let failed = 0;
  for (const turn of GOLDEN_TURNS) {
    const startedAt = Date.now();
    const outcome = await runTurn(base, thread.thread_id, turn.question);
    const { messages } = await api<{ messages: Array<{ role: string; blocks: Block[] }> }>(
      base, "GET", `/v1/chat/threads/${thread.thread_id}/messages`,
    );
    const answer = messages.filter((message) => message.role === "assistant").at(-1);
    const { failures, notes } = evaluateGoldenTurn(turn, { outcome, blocks: answer?.blocks ?? [] });
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`${failures.length === 0 ? "PASS" : "FAIL"}  ${turn.question}  (${seconds}s)`);
    for (const line of [...failures, ...notes.map((note) => `note: ${note}`)]) console.log(`      ${line}`);
    failed += failures.length === 0 ? 0 : 1;
  }
  console.log(`thread: ${base}/chat/${thread.thread_id}`);
  if (failed > 0) {
    console.log(
      "hint: on a fresh database NVDA/AMD live identities and SEC facts aren't ingested yet; " +
        "chat reads persisted facts only (see #152).",
    );
  }
  return failed === 0 ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main(process.argv[2] ?? process.env.GOLDEN_BASE_URL ?? "http://127.0.0.1:5173");
}

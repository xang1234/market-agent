import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { GOLDEN_TURNS, evaluateGoldenTurn, runGoldenLiveCheck, runTurn } from "../scripts/golden-live-check.ts";

test("every request the check makes is bounded: a server that never answers fails it, not hangs it", async (t) => {
  // Accepts connections, never responds: thread creation is the first request to hang.
  const server = createServer(() => {});
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const startedAt = Date.now();
  await assert.rejects(() => runGoldenLiveCheck(base, { requestTimeoutMs: 300, turnTimeoutMs: 300, warmup: async () => [] }), /timeout|aborted/i);
  assert.ok(Date.now() - startedAt < 5_000, "failed near the deadline, not hung");
});

test("runTurn gives up at its deadline when the stream goes silent", async (t) => {
  // Accepts the user's message, then opens the turn stream and never writes to it.
  const server = createServer((req, res) => {
    if (req.method === "POST") {
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.flushHeaders();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const startedAt = Date.now();
  assert.equal(await runTurn(base, "thread-1", "Analyze NVDA", 300), "timeout");
  assert.ok(Date.now() - startedAt < 5_000, "returned near the deadline, not hung");
});

test("runTurn hands turn.completed's data to its caller, even split across chunks (#181)", async (t) => {
  const server = createServer((req, res) => {
    if (req.method === "POST") {
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write("id: 9\nevent: turn.completed\n");
    setTimeout(() => res.end('data: {"answered_by":"a/b","answer_usage":{"input_tokens":5,"output_tokens":2}}\n\n'), 20);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let data: Record<string, unknown> | undefined;
  assert.equal(await runTurn(base, "thread-1", "Analyze NVDA", 5_000, undefined, (completed) => { data = completed; }), "turn.completed");
  assert.deepEqual(data, { answered_by: "a/b", answer_usage: { input_tokens: 5, output_tokens: 2 } });
});

test("runTurn ends at its deadline even when the stream ignores the abort (#185)", async (t) => {
  // An open SSE stream that keeps the turn going and never ends, and that the deadline's
  // abort doesn't reach: in the eval run a 180 s turn waited 460 s, until the server closed it.
  const keepAlive = setInterval(() => {}, 1_000);
  t.after(() => clearInterval(keepAlive));
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  globalThis.fetch = async (input) => {
    if (String(input).includes("/messages")) return new Response("{}", { status: 200 });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("event: turn.started\ndata: {}\n\n"));
      },
      cancel: () => new Promise<void>(() => {}), // cancelling never settles either
    });
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
  };

  const startedAt = Date.now();
  assert.equal(await runTurn("http://stack.test", "thread-1", "Compare NVDA with AMD.", 300), "timeout");
  assert.ok(Date.now() - startedAt < 2_000, "returned at the deadline, not when the stream ended");
});

const blocks = (...kinds: string[]) => kinds.map((kind, index) => ({ id: `b${index}`, kind }));

test("runTurn's deadline also covers a message POST that never answers", async (t) => {
  // Accepts the connection, then never responds to anything.
  const server = createServer(() => {});
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const startedAt = Date.now();
  assert.equal(await runTurn(base, "thread-1", "Analyze NVDA", 300), "timeout");
  assert.ok(Date.now() - startedAt < 5_000, "returned near the deadline, not hung");
});

test("the live check asks the golden conversation's three questions, in order", () => {
  assert.deepEqual(GOLDEN_TURNS.map((turn) => turn.question), [
    "Analyze NVDA",
    "Compare it with AMD",
    "Explain the differences and show the evidence",
  ]);
});

test("turn 1 needs a completed turn with a chart and a metric row", () => {
  const [analyze] = GOLDEN_TURNS;
  assert.deepEqual(evaluateGoldenTurn(analyze!, { outcome: "turn.completed", blocks: blocks("rich_text", "metric_row", "revenue_bars") }), { failures: [], notes: [] });
  assert.deepEqual(evaluateGoldenTurn(analyze!, { outcome: "turn.completed", blocks: blocks("rich_text", "line_chart", "metric_row") }).failures, []);
  assert.match(
    evaluateGoldenTurn(analyze!, { outcome: "turn.completed", blocks: blocks("rich_text") }).failures.join(" "),
    /chart.*metric_row/,
  );
  assert.match(evaluateGoldenTurn(analyze!, { outcome: "turn.error", blocks: [] }).failures.join(" "), /turn\.error/);
});

test("turn 2 needs a metrics comparison; a missing price chart is only a note", () => {
  const compare = GOLDEN_TURNS[1]!;
  const withoutChart = evaluateGoldenTurn(compare, { outcome: "turn.completed", blocks: blocks("rich_text", "metrics_comparison") });
  assert.deepEqual(withoutChart.failures, []);
  assert.match(withoutChart.notes.join(" "), /perf_comparison/);
  assert.match(
    evaluateGoldenTurn(compare, { outcome: "turn.completed", blocks: blocks("rich_text") }).failures.join(" "),
    /metrics_comparison/,
  );
});

test("turn 3 only needs to complete", () => {
  const explain = GOLDEN_TURNS[2]!;
  assert.deepEqual(evaluateGoldenTurn(explain, { outcome: "turn.completed", blocks: blocks("rich_text") }).failures, []);
  assert.match(evaluateGoldenTurn(explain, { outcome: "timeout", blocks: [] }).failures.join(" "), /timeout/);
});

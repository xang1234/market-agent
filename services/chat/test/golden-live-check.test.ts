import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { GOLDEN_TURNS, evaluateGoldenTurn, runTurn } from "../scripts/golden-live-check.ts";

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

const blocks = (...kinds: string[]) => kinds.map((kind, index) => ({ id: `b${index}`, kind }));

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

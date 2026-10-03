// Golden chat conversation (#118): the finish line for the chat-recovery epic (#125).
//
// Drives the default chat server the way the web client does — create a thread,
// save each user message, open the turn stream, reload the thread — against the
// frozen dataset in test/golden/, with recorded model replies (no provider
// keys). Three turns: "Analyze NVDA" (chart + metric row, #120), then the
// follow-ups "Compare it with AMD" and "Explain the differences and show the
// evidence" (both companies side by side, #121). Every subtest is strict.

import assert from "node:assert/strict";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { randomUUID } from "node:crypto";

import {
  bootstrapDatabase,
  connectedClient,
  connectedPool,
  dockerAvailable,
  registerLifoCleanup,
} from "../../../db/test/docker-pg.ts";
import { loadEvidenceInspection } from "../../evidence/src/inspector.ts";
import { createChatServer } from "../src/http.ts";
import { closeLocalRuntimePoolForTests } from "../src/local-runtime.ts";
import { loadChatServerOptionsFromEnv } from "../src/runtime.ts";
import { GOLDEN_COMPANIES, seedGoldenDataset } from "./golden/dataset.ts";
import { parseSseEvents, type ParsedSseEvent } from "./sse-helpers.ts";
import type { AddressInfo } from "node:net";

const USER_ID = "70000000-0000-4000-8000-000000000001";
const NVDA = GOLDEN_COMPANIES.find((company) => company.ticker === "NVDA")!;
const AMD = GOLDEN_COMPANIES.find((company) => company.ticker === "AMD")!;
const BOTH_LISTINGS = [
  { kind: "listing", id: NVDA.listing_id },
  { kind: "listing", id: AMD.listing_id },
];
const CHART_KINDS = new Set(["revenue_bars", "line_chart"]);

const GOLDEN_ENV: Record<string, string> = {
  LLM_CHANNELS: "fixture",
  LLM_FIXTURE_PROTOCOL: "openai",
  LLM_FIXTURE_MODELS: "recorded",
  LITELLM_MODEL: "fixture/recorded",
  LLM_REPLAY_FILE: join(import.meta.dirname, "golden", "llm-replies.json"),
  // The finish line is always judged strictly, whatever the developer has set locally.
  CHAT_VERIFICATION_MODE: "strict",
};

type Block = Record<string, unknown> & { id?: string; kind?: string };
type ChatMessage = { message_id: string; role: string; snapshot_id: string; blocks: Block[] };

test("golden conversation: Analyze NVDA", { skip: !dockerAvailable(), timeout: 180_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "chat-golden");
  withEnv(t, { ...GOLDEN_ENV, CHAT_DATABASE_URL: databaseUrl });
  registerLifoCleanup(t, () => closeLocalRuntimePoolForTests());

  const client = await connectedClient(t, databaseUrl);
  await client.query(`insert into users (user_id, email) values ($1::uuid, 'golden@chat.example.test')`, [USER_ID]);
  await seedGoldenDataset(client);

  const base = await startGoldenServer(t, databaseUrl);
  const thread = await api<{ thread_id: string }>(base, "POST", "/v1/chat/threads", { title: "Golden" });
  const events = await runTurn(base, thread.thread_id, "Analyze NVDA");
  const messages = (await api<{ messages: ChatMessage[] }>(
    base, "GET", `/v1/chat/threads/${thread.thread_id}/messages`,
  )).messages;
  const assistant = messages.find((message) => message.role === "assistant");

  await t.test("turn completes on NVDA and the answer is persisted", () => {
    const error = events.find((event) => event.event === "turn.error");
    assert.equal(error, undefined, `turn.error: ${JSON.stringify(error?.data)}`);
    const completed = events.find((event) => event.event === "turn.completed");
    assert.ok(completed, `no turn.completed; events: ${events.map((event) => event.event).join(", ")}`);
    assert.deepEqual(
      completed.data.subject_ref,
      { kind: "listing", id: NVDA.listing_id },
      "the turn should resolve 'NVDA' to the seeded listing",
    );
    assert.ok(assistant, "assistant message missing from the reloaded thread");
    assert.equal(assistant.message_id, completed.data.message_id);
    // The narrative comes from the recorded model reply, so the LLM step really ran.
    assert.match(JSON.stringify(assistant.blocks), /NVIDIA's reported revenue rose in every quarter shown/);
  });

  await t.test("reload returns the streamed blocks", () => {
    const streamedIds = events
      .filter((event) => event.event === "block.completed")
      .map((event) => event.data.block_id);
    assert.ok(streamedIds.length > 0, "no blocks were streamed");
    assert.deepEqual(assistant?.blocks.map((block) => block.id), streamedIds);
  });

  await t.test("every cited fact resolves to its source in the evidence inspector", async () => {
    assert.ok(assistant);
    const { rows } = await client.query<{ fact_refs: string[] }>(
      `select fact_refs from snapshots where snapshot_id = $1::uuid`,
      [assistant.snapshot_id],
    );
    const factRefs = rows[0]?.fact_refs ?? [];
    assert.ok(factRefs.length > 0, "the answer's snapshot cites no facts");
    for (const factId of factRefs) {
      const inspection = await loadEvidenceInspection(client, {
        user_id: USER_ID,
        snapshot_id: assistant.snapshot_id,
        ref: { kind: "fact", id: factId },
      });
      assert.ok(
        inspection.related_refs.some((ref) => ref.kind === "source"),
        `fact ${factId} does not link to a source`,
      );
    }
  });

  await t.test("answer includes a chart and a metric row bound to cited facts", async () => {
    assert.ok(assistant);
    const kinds = assistant.blocks.map((block) => block.kind);
    const chart = assistant.blocks.find((block) => CHART_KINDS.has(String(block.kind)));
    const metricRow = assistant.blocks.find((block) => block.kind === "metric_row");
    assert.ok(chart && metricRow, `expected a chart (revenue_bars or line_chart) and a metric_row; got [${kinds.join(", ")}]`);

    const { rows } = await client.query<{ fact_refs: string[] }>(
      `select fact_refs from snapshots where snapshot_id = $1::uuid`,
      [assistant.snapshot_id],
    );
    const cited = new Set(rows[0]?.fact_refs ?? []);
    for (const block of [chart, metricRow]) {
      const refs = valueRefs(block);
      assert.ok(refs.length > 0, `${block.kind} carries no value_ref`);
      for (const ref of refs) assert.ok(cited.has(ref), `${block.kind} value_ref ${ref} is not a cited fact`);
    }
    // No margin trend was asked for, so only the latest quarter's margins and growth
    // are minted: unused historical ones would cost lookups and inserts every turn.
    const minted = await client.query<{ quarter: string }>(
      `select distinct fiscal_year::text || fiscal_period as quarter from facts
        where method = 'derived' and period_kind = 'fiscal_q' and subject_id = $1::uuid`,
      [NVDA.issuer_id],
    );
    assert.equal(minted.rows.length, 1, `derived facts minted for quarters ${minted.rows.map((row) => row.quarter).join(", ")}`);
  });

  await t.test("follow-up 'Compare it with AMD' sets both companies side by side", async () => {
    const turnEvents = await runTurn(base, thread.thread_id, "Compare it with AMD");
    const completed = completedTurn(turnEvents);
    assert.deepEqual(completed.data.subject_refs, BOTH_LISTINGS, "'it' should carry NVDA forward and add AMD");

    const answer = await latestAssistantMessage(base, thread.thread_id);
    const comparison = comparisonBlock(answer);
    assert.deepEqual(
      (comparison.subjects as Array<{ id: string }>).map((subject) => subject.id),
      [NVDA.issuer_id, AMD.issuer_id],
    );
    // Rows are labelled for people, not by reference id.
    assert.deepEqual(comparison.subject_labels, ["NVDA", "AMD"]);
    const cited = await citedFacts(answer);
    const refs = valueRefs(comparison);
    assert.ok(refs.length >= 2, "the comparison shows too few figures");
    for (const ref of refs) assert.ok(cited.has(ref), `metrics_comparison value_ref ${ref} is not a cited fact`);

    // Price performance alongside, drawn only from series the snapshot sealed (#133).
    const performance = answer.blocks.find((block) => block.kind === "perf_comparison");
    assert.ok(performance, `expected a perf_comparison; got [${answer.blocks.map((b) => b.kind).join(", ")}]`);
    assert.deepEqual(performance.subject_labels, ["NVDA", "AMD"]);
    const series = performance.series as Array<{ name: string; points: unknown[] }>;
    assert.deepEqual(series.map((line) => line.name), ["NVDA", "AMD"]);
    assert.ok(series.every((line) => line.points.length > 1), "each company needs a price line");
    const { rows } = await client.query<{
      series_specs: Array<{ series_ref: string; bar_range_id: string; as_of: string; adjustment_basis: string }>;
      basis: string;
      normalization: string;
    }>(
      `select series_specs, basis, normalization from snapshots where snapshot_id = $1::uuid`,
      [answer.snapshot_id],
    );
    // End-of-day prices are disclosed as such, and split-adjusted returns as
    // price returns without dividends (#191).
    const disclosure = answer.blocks.find((block) => block.kind === "disclosure");
    assert.ok(disclosure, `expected a pricing disclosure; got [${answer.blocks.map((b) => b.kind).join(", ")}]`);
    const items = (disclosure.items as string[]).join(" ");
    assert.match(items, /end-of-day/);
    assert.match(items, /split-adjusted price returns; dividends are not included/);
    assert.equal(performance.title, "Price return (split-adjusted, excluding dividends)");
    // The seal describes the chart's data: split-adjusted prices as percent returns.
    assert.equal(rows[0]?.basis, "split_adjusted");
    assert.ok((rows[0]?.series_specs ?? []).every((spec) => spec.adjustment_basis === "split_adjusted"));
    assert.equal(rows[0]?.normalization, "pct_return");
    const sealed = new Set((rows[0]?.series_specs ?? []).map((spec) => spec.series_ref));
    const seriesRefs = (performance.data_ref as { params: { series_refs: string[] } }).params.series_refs;
    assert.equal(seriesRefs.length, 2);
    for (const ref of seriesRefs) assert.ok(sealed.has(ref), `series ${ref} is not sealed in the snapshot`);
    // The chart is dated by its stored prices, not the answer time.
    const oldest = (rows[0]?.series_specs ?? []).map((spec) => spec.as_of).sort()[0];
    assert.equal(performance.as_of, oldest);
  });

  await t.test("'Explain the differences and show the evidence' keeps both companies and cites facts from each", async () => {
    const derivedFacts = async () =>
      (await client.query<{ n: number }>(`select count(*)::int as n from facts where method = 'derived'`)).rows[0]!.n;
    const derivedBefore = await derivedFacts();
    const turnEvents = await runTurn(base, thread.thread_id, "Explain the differences and show the evidence");
    assert.deepEqual(completedTurn(turnEvents).data.subject_refs, BOTH_LISTINGS);
    // The same comparison reuses turn 2's derived facts instead of re-minting them (#134).
    assert.equal(await derivedFacts(), derivedBefore, "turn 3 added derived facts");

    const answer = await latestAssistantMessage(base, thread.thread_id);
    assert.match(JSON.stringify(answer.blocks), /each figure links to its filing/);
    comparisonBlock(answer);
    const { rows } = await client.query<{ subject_id: string }>(
      `select distinct subject_id::text as subject_id from facts where fact_id = any($1::uuid[])`,
      [[...(await citedFacts(answer))]],
    );
    assert.deepEqual(
      rows.map((row) => row.subject_id).sort(),
      [NVDA.issuer_id, AMD.issuer_id].sort(),
      "the answer should cite facts about both companies",
    );
  });

  await t.test("'How does NVDA compare with its peers?' brings in its industry peers", async () => {
    const peersThread = await api<{ thread_id: string }>(base, "POST", "/v1/chat/threads", { title: "Peers" });
    const turnEvents = await runTurn(base, peersThread.thread_id, "How does NVDA compare with its peers?");
    assert.deepEqual(completedTurn(turnEvents).data.subject_refs, [{ kind: "listing", id: NVDA.listing_id }]);

    const comparison = comparisonBlock(await latestAssistantMessage(base, peersThread.thread_id));
    // AMD shares NVDA's industry; AAPL does not. The auto-selected peer is labelled too.
    assert.deepEqual(
      (comparison.subjects as Array<{ id: string }>).map((subject) => subject.id),
      [NVDA.issuer_id, AMD.issuer_id],
    );
    assert.deepEqual(comparison.subject_labels, ["NVDA", "AMD"]);
  });

  await t.test("'Break down NVDA's revenue by segment' shows each segment from cited facts (#157)", async () => {
    const segmentsThread = await api<{ thread_id: string }>(base, "POST", "/v1/chat/threads", { title: "Segments" });
    completedTurn(await runTurn(base, segmentsThread.thread_id, "Break down NVDA's revenue by segment"));

    const answer = await latestAssistantMessage(base, segmentsThread.thread_id);
    const breakdown = answer.blocks.find((block) => block.kind === "metric_row" && /by segment/.test(String(block.title)));
    assert.ok(breakdown, `expected a segment breakdown; got [${answer.blocks.map((b) => `${b.kind}:${b.title}`).join(", ")}]`);
    assert.equal(breakdown.title, "Revenue by segment (Q4 2026)");
    const items = breakdown.items as Array<{ label: string; format: string }>;
    assert.deepEqual(items.map((item) => item.label), ["Data Center", "Gaming", "OEM & Other", "Professional Visualization", "Automotive"]);
    assert.equal(items[0].format, "$55.2B");
    const cited = await citedFacts(answer);
    for (const ref of valueRefs(breakdown)) assert.ok(cited.has(ref), `segment value_ref ${ref} is not a cited fact`);
  });

  await t.test("a company with no segment facts gets no breakdown block", async () => {
    const amdThread = await api<{ thread_id: string }>(base, "POST", "/v1/chat/threads", { title: "AMD segments" });
    completedTurn(await runTurn(base, amdThread.thread_id, "Break down AMD's revenue by segment"));
    const answer = await latestAssistantMessage(base, amdThread.thread_id);
    assert.equal(answer.blocks.some((block) => /by segment/.test(String(block.title))), false);
  });

  await t.test("'Compare NVDA with AMD YTD' seals the year-to-date window from the seeded bars (#192)", async () => {
    const ytdThread = await api<{ thread_id: string }>(base, "POST", "/v1/chat/threads", { title: "YTD" });
    const turnEvents = await runTurn(base, ytdThread.thread_id, "Compare NVDA with AMD YTD");
    assert.deepEqual(completedTurn(turnEvents).data.subject_refs, BOTH_LISTINGS);
    const answer = await latestAssistantMessage(base, ytdThread.thread_id);
    const performance = answer.blocks.find((block) => block.kind === "perf_comparison");
    assert.ok(performance, `expected a perf_comparison; got [${answer.blocks.map((b) => b.kind).join(", ")}]`);
    // The requested year, baseline and end sessions, and the actual basis are shown.
    assert.equal(performance.title, "Price return YTD 2026 (split-adjusted, excluding dividends)");
    assert.equal(performance.default_range, "YTD 2026: 2025-12-31 close to 2026-08-31 close");
    const series = performance.series as Array<{ points: Array<{ x: string; y: number }> }>;
    assert.ok(series.every((line) => line.points[0].x === "2025-12-31" && line.points[0].y === 0));
    const { rows } = await client.query<{ series_specs: Array<{ window: unknown; bars_sha256: string }> }>(
      `select series_specs from snapshots where snapshot_id = $1::uuid`,
      [answer.snapshot_id],
    );
    const specs = rows[0]?.series_specs ?? [];
    assert.equal(specs.length, 2);
    for (const spec of specs) {
      assert.deepEqual(spec.window, { kind: "ytd", year: 2026, baseline_date: "2025-12-31", end_date: "2026-08-31" });
      assert.match(spec.bars_sha256, /^[0-9a-f]{64}$/);
    }
    // Reload returns the same dates, values, and references.
    const reloaded = await latestAssistantMessage(base, ytdThread.thread_id);
    assert.deepEqual(reloaded.blocks.find((block) => block.kind === "perf_comparison"), performance);
  });

  function completedTurn(turnEvents: ParsedSseEvent[]): ParsedSseEvent {
    const error = turnEvents.find((event) => event.event === "turn.error");
    assert.equal(error, undefined, `turn.error: ${JSON.stringify(error?.data)}`);
    const completed = turnEvents.find((event) => event.event === "turn.completed");
    assert.ok(completed, `no turn.completed; events: ${turnEvents.map((event) => event.event).join(", ")}`);
    return completed;
  }

  async function citedFacts(message: ChatMessage): Promise<Set<string>> {
    const { rows } = await client.query<{ fact_refs: string[] }>(
      `select fact_refs from snapshots where snapshot_id = $1::uuid`,
      [message.snapshot_id],
    );
    return new Set(rows[0]?.fact_refs ?? []);
  }
});

async function latestAssistantMessage(base: string, threadId: string): Promise<ChatMessage> {
  const { messages } = await api<{ messages: ChatMessage[] }>(base, "GET", `/v1/chat/threads/${threadId}/messages`);
  const answer = messages.filter((message) => message.role === "assistant").at(-1);
  assert.ok(answer, "no assistant message in the thread");
  return answer;
}

function comparisonBlock(message: ChatMessage): Block {
  const block = message.blocks.find((candidate) => candidate.kind === "metrics_comparison");
  assert.ok(block, `expected a metrics_comparison; got [${message.blocks.map((b) => b.kind).join(", ")}]`);
  return block;
}

async function startGoldenServer(t: TestContext, databaseUrl: string): Promise<string> {
  const pool = await connectedPool(t, databaseUrl);
  const server = createChatServer({ ...(await loadChatServerOptionsFromEnv()), threadsDb: pool });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  registerLifoCleanup(t, () => new Promise<void>((resolve) => server.close(() => resolve())));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function api<T>(base: string, method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "x-user-id": USER_ID, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert.ok(response.ok, `${method} ${path} -> ${response.status} ${await response.clone().text()}`);
  return response.json() as Promise<T>;
}

// Reads the turn's SSE stream until it completes or errors; the server keeps the
// connection open for reconnects, so the reader is cancelled once the turn ends.
async function runTurn(base: string, threadId: string, userIntent: string): Promise<ParsedSseEvent[]> {
  // As the web client does: save the user's message, then stream the turn.
  const messageId = randomUUID();
  await api(base, "POST", `/v1/chat/threads/${threadId}/messages`, {
    message_id: messageId,
    snapshot_id: randomUUID(),
    content: userIntent,
  });
  const params = new URLSearchParams({ run_id: randomUUID(), turn_id: messageId, user_intent: userIntent, user_id: USER_ID });
  const response = await fetch(`${base}/v1/chat/threads/${threadId}/stream?${params}`);
  assert.equal(response.status, 200);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let transcript = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      transcript += decoder.decode(value, { stream: true });
      const events = parseSseEvents(transcript);
      if (events.some((event) => event.event === "turn.completed" || event.event === "turn.error")) {
        return events;
      }
    }
  } finally {
    await reader.cancel();
  }
  return parseSseEvents(transcript);
}

function valueRefs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(valueRefs);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) =>
    key === "value_ref" && typeof child === "string" ? [child] : valueRefs(child),
  );
}

function withEnv(t: TestContext, values: Record<string, string>): void {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  registerLifoCleanup(t, () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

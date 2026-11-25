import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FROZEN_AS_OF } from "../services/chat/src/ytd-hydration.ts";
import { AMD_Q2_2025_RELEASE, GOLDEN_COMPANIES, GOLDEN_ISSUER_FACTS, goldenDailyBars } from "../services/chat/test/golden/dataset.ts";
import {
  callMessages,
  dataBrief,
  runBare,
  systemPrompt,
  type CallMessages,
  type MessagesResult,
} from "./research-quality-bare.ts";
import { Refusal, readRunRecord, type RunRecord } from "./research-quality-eval.ts";
import { buildPair } from "./research-quality-pairs.ts";
import { QUESTIONS } from "./research-quality-questions.ts";

const brief = dataBrief();
// A company's section, then one table row in it, split into cells.
const section = (ticker: string) => brief.slice(brief.indexOf(`## ${ticker}:`), brief.indexOf("\n## ", brief.indexOf(`## ${ticker}:`) + 1));
const cells = (text: string, first: string) => {
  const line = text.split("\n").find((l) => l.startsWith(`| ${first} |`));
  assert.ok(line, `a row for ${first}`);
  return line.split("|").slice(1, -1).map((cell) => cell.trim());
};

test("the data brief holds every seeded fact in its company's row and its metric's column", () => {
  const header = cells(section("NVDA"), "Fiscal period");
  const names = { revenue: "Revenue", gross_profit: "Gross profit", operating_income: "Operating income", net_income: "Net income" } as const;
  for (const fact of GOLDEN_ISSUER_FACTS) {
    const company = GOLDEN_COMPANIES.find((c) => c.issuer_id === fact.issuer_id)!;
    const label = fact.fiscal_period === "FY" ? `FY${fact.fiscal_year}` : `${fact.fiscal_period} FY${fact.fiscal_year}`;
    const row = cells(section(company.ticker), label);
    assert.deepEqual(row.slice(1, 3), [fact.period_start, fact.period_end], fact.key);
    const column = header.indexOf(names[fact.metric_key]);
    assert.equal(Number(row[column]!.replaceAll(",", "")) * 1e6, fact.value_usd, fact.key);
  }
});

test("the data brief holds the segments, quotes, every daily bar, the filed claim and the cutoff", () => {
  for (const company of GOLDEN_COMPANIES) {
    const text = section(company.ticker);
    assert.match(text, new RegExp(`CIK ${company.cik}\\. Sector: ${company.sector}\\. Industry: ${company.industry}\\.`, "u"));
    assert.ok(text.includes(`Last price ${company.quote.price.toFixed(2)}; previous close ${company.quote.prev_close.toFixed(2)}.`));
    for (const [name, value] of company.segments?.revenue ?? []) assert.equal(Number(cells(text, name)[1]!.replaceAll(",", "")), value);
    const bars = goldenDailyBars(company);
    for (const bar of bars) {
      const row = cells(text, bar.ts.slice(0, 10)).map((cell) => Number(cell.replaceAll(",", "")));
      for (const [i, value] of [bar.open, bar.high, bar.low, bar.close].entries()) assert.ok(Math.abs(row[i + 1]! - value) <= 0.005 + 1e-9, `${company.ticker} ${bar.ts}`);
      assert.equal(row[5], bar.volume);
    }
  }
  assert.equal(GOLDEN_COMPANIES.filter((company) => company.segments).length, 1, "only NVDA has segments");
  assert.ok(brief.includes(`> ${AMD_Q2_2025_RELEASE.text}`));
  assert.ok(brief.includes(AMD_Q2_2025_RELEASE.url));
  assert.ok(brief.includes("published 2025-08-05"));
  assert.ok(brief.startsWith(`# Company data on file as of ${FROZEN_AS_OF.slice(0, 10)}\n`));
});

test("the system prompt is the brief's instructions, the page it opened from, then the data", () => {
  const intro = `You are an equity research analyst at a long-only fund, answering a portfolio manager in chat. Use only the company data below. It is everything on file as of ${FROZEN_AS_OF.slice(0, 10)}. When the data does not cover something the question asks, say so plainly. Do not add facts or figures from outside the data.`;
  const plain = QUESTIONS.find((q) => q.id === "single-latest-quarter")!;
  const fromPage = QUESTIONS.find((q) => q.id === "ticker-page-compare")!;
  assert.equal(systemPrompt(plain), `${intro}\n\n${brief}`);
  assert.equal(systemPrompt(fromPage), `${intro}\n\nThe portfolio manager opened this conversation from the AAPL page.\n\n${brief}`);
  assert.doesNotMatch(systemPrompt(fromPage), /\beval|\btest|\bscor|\bcompar|\bbenchmark|\bgrad/iu);
});

// The Messages API's stream, as server-sent events.
const sse = (...events: object[]) => events.map((event) => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
const answer = (text: string, model = "claude-sonnet-5-5") => sse(
  { type: "message_start", message: { model, usage: { input_tokens: 900, cache_read_input_tokens: 100, output_tokens: 1 } } },
  { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } },
  { type: "content_block_stop", index: 0 },
  { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: text.slice(0, 3) } },
  { type: "ping" },
  { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: text.slice(3) } },
  { type: "content_block_stop", index: 1 },
  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 42 } },
  { type: "message_stop" },
);
const fakeFetch = (responses: Array<() => Response>) => {
  const sent: Array<{ headers: Record<string, string>; body: Record<string, unknown> }> = [];
  const send = (async (_url: string, init: RequestInit) => {
    sent.push({ headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) });
    return responses.shift()!();
  }) as typeof fetch;
  return { send, sent };
};

test("a streamed answer is read into its blocks, text, stop reason and tokens", async () => {
  const { send, sent } = fakeFetch([() => new Response(answer("NVDA's revenue was $62.1B."))]);
  const result = await callMessages({ model: "claude-sonnet-5-5", max_tokens: 8192 }, { apiKey: "k", fetch: send });
  assert.deepEqual(result, {
    ok: true,
    model: "claude-sonnet-5-5",
    content: [{ type: "thinking", thinking: "", signature: "sig" }, { type: "text", text: "NVDA's revenue was $62.1B." }],
    text: "NVDA's revenue was $62.1B.",
    stopReason: "end_turn",
    usage: { input_tokens: 1000, output_tokens: 42 },
  });
  assert.deepEqual(sent[0]!.body, { model: "claude-sonnet-5-5", max_tokens: 8192, stream: true });
  assert.equal(sent[0]!.headers["x-api-key"], "k");
});

test("a 429, 5xx or overloaded stream is retried once, then is the turn's provider error", async () => {
  const fast = { apiKey: "k", retryDelayMs: 0 };
  const overloaded = () => new Response("{\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\"}}", { status: 529 });
  const retried = fakeFetch([overloaded, () => new Response(answer("ok"))]);
  assert.equal((await callMessages({}, { ...fast, fetch: retried.send })).ok, true);
  assert.equal(retried.sent.length, 2);
  const twice = fakeFetch([() => new Response("slow down", { status: 429 }), overloaded]);
  const failed = await callMessages({}, { ...fast, fetch: twice.send });
  assert.deepEqual(failed, { ok: false, outcome: "provider_error", status: 529, error: "HTTP 529: {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\"}}" });
  const midStream = fakeFetch([() => new Response(sse({ type: "message_start", message: { model: "m", usage: {} } }, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } })), () => new Response(answer("ok"))]);
  assert.equal((await callMessages({}, { ...fast, fetch: midStream.send })).ok, true);
  assert.equal(midStream.sent.length, 2);
  const refused = fakeFetch([() => new Response("bad request", { status: 400 })]);
  assert.deepEqual(await callMessages({}, { ...fast, fetch: refused.send }), { ok: false, outcome: "provider_error", status: 400, error: "HTTP 400: bad request" });
  assert.equal(refused.sent.length, 1, "a 400 isn't retried");
});

const ok = (text: string, model = "claude-sonnet-5-5"): MessagesResult =>
  ({ ok: true, model, content: [{ type: "thinking", thinking: "", signature: "s" }, { type: "text", text }], text, stopReason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } });

test("a bare run is a blind run record the pair tool takes against an app run, and the packet can't tell them apart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bare-"));
  const bodies: Array<Record<string, any>> = [];
  const call: CallMessages = async (body) => {
    bodies.push(body);
    return ok(`Answer ${bodies.length}.`);
  };
  const { record, file } = await runBare({ call, dir, now: new Date("2026-11-25T01:02:03Z"), log: () => {} });
  assert.equal(file, join(dir, "2026-11-25T010203.run.json"));
  for (const name of ["2026-11-25T010203.run.json", "2026-11-25T010203.md", "2026-11-25T010203.scores.json"]) assert.ok(existsSync(join(dir, name)), name);
  const saved = readRunRecord(file) as typeof record;
  assert.deepEqual(saved, JSON.parse(JSON.stringify(record)));
  assert.equal(saved.blind, true);
  assert.equal(saved.complete, true);
  assert.equal(saved.arm, "bare");
  assert.equal(saved.request.max_tokens, 8192);
  assert.ok(saved.request.not_sent.includes("thinking"));
  assert.equal(saved.request.effort, null);
  assert.ok(saved.request.not_sent.includes("output_config"));
  assert.ok(bodies.every((body) => !("output_config" in body)), "no effort is sent unless asked for");
  const low: Array<Record<string, any>> = [];
  const lowRun = (await runBare({ effort: "low", call: async (body) => (low.push(body), ok("Low.")), dir, now: new Date("2026-11-25T01:02:04Z"), log: () => {} })).record;
  assert.equal(lowRun.request.effort, "low");
  assert.ok(!lowRun.request.not_sent.includes("output_config"));
  assert.ok(low.length > 0 && low.every((body) => body.output_config?.effort === "low"));
  assert.deepEqual(saved.planned, QUESTIONS.map((q) => q.id));
  const turns = saved.questions.flatMap((q) => q.turns);
  assert.equal(turns.length, QUESTIONS.flatMap((q) => q.turns).length);
  assert.ok(turns.every((turn) => turn.outcome === "completed" && turn.answeredBy === "anthropic/claude-sonnet-5-5" && turn.blocks.length === 1 && turn.blocks[0]!.kind === "rich_text"));
  assert.ok(turns.every((turn) => typeof turn.elapsedMs === "number" && turn.usage?.output_tokens === 5 && turn.thinkingBlocks === 1));
  // Every request: the model, max_tokens, the system prompt and the conversation so far; nothing else.
  assert.ok(bodies.every((body) => Object.keys(body).sort().join() === "max_tokens,messages,model,system" && body.model === "claude-sonnet-5-5"));
  const followUp = QUESTIONS.findIndex((q) => q.id === "follow-up-memory");
  const sentBefore = QUESTIONS.slice(0, followUp).reduce((n, q) => n + q.turns.length, 0);
  assert.deepEqual(bodies[sentBefore + 2]!.messages.map((m: { role: string }) => m.role), ["user", "assistant", "user", "assistant", "user"]);
  assert.deepEqual(bodies[sentBefore + 2]!.messages[1].content, (ok(`Answer ${sentBefore + 1}.`) as { content: unknown }).content, "an answer is sent back as it came, thinking included");
  assert.match(bodies.at(-1)!.system, /opened this conversation from the AAPL page/u);

  const app: RunRecord = {
    ...saved,
    model: "anthropic/claude-sonnet-5-5 (fallbacks: opencode-go/qwen)",
    questions: saved.questions.map((q) => ({ question: q.question, threadId: `t-${q.question.id}`, turns: q.turns.map((t) => ({ message: t.message, outcome: t.outcome, blocks: [{ kind: "rich_text", segments: [{ type: "text", text: "App answer." }] }], elapsedMs: 1, answeredBy: t.answeredBy })) })),
  };
  delete (app as Partial<typeof saved>).arm;
  delete (app as Partial<typeof saved>).request;
  const { packet, key } = buildPair(app, saved, 7, "2026-11-25T020000", { baseline: "app.run.json", candidate: file });
  assert.ok(Object.values(key.pairs).every((pair) => !pair.confounded), "one model answered both arms");
  assert.doesNotMatch(packet, /bare|8192|max_tokens|api\.anthropic|anthropic-version|not_sent|thinking/iu);
  assert.match(packet, /Answer 1\./u);
});

test("a turn that fails skips the rest of its conversation, and a refused request stops the run", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bare-"));
  let n = 0;
  const flaky: CallMessages = async () => (++n === 1 ? { ok: false, outcome: "provider_error", error: "HTTP 529", status: 529 } : ok("fine"));
  const followUp = QUESTIONS.findIndex((q) => q.id === "follow-up-memory");
  const sentBefore = QUESTIONS.slice(0, followUp).reduce((count, q) => count + q.turns.length, 0);
  const failOnFollowUp: CallMessages = async (body) => (++n === sentBefore + 1 && (body.messages as unknown[]).length === 1 ? { ok: false, outcome: "timeout", error: "slow" } : ok("fine"));
  const first = (await runBare({ call: flaky, dir, now: new Date("2026-11-25T01:00:00Z"), log: () => {} })).record;
  assert.deepEqual(first.questions[0]!.turns.map((t) => [t.outcome, t.answeredBy]), [["provider_error", null]]);
  n = 0;
  const second = (await runBare({ call: failOnFollowUp, dir, now: new Date("2026-11-25T01:00:01Z"), log: () => {} })).record;
  assert.deepEqual(second.questions[followUp]!.turns.map((t) => t.outcome), ["timeout", "skipped", "skipped"]);
  const refused: CallMessages = async () => ({ ok: false, outcome: "provider_error", error: "HTTP 401: invalid x-api-key", status: 401 });
  await assert.rejects(runBare({ call: refused, dir, now: new Date("2026-11-25T01:00:02Z"), log: () => {} }), (error: unknown) => error instanceof Refusal && /HTTP 401/u.test(error.message));
  const stopped = readRunRecord(join(dir, "2026-11-25T010002.run.json"));
  assert.deepEqual([stopped.complete, stopped.questions.length], [false, 0]);
  assert.match(readFileSync(join(dir, "2026-11-25T010002.md"), "utf8"), /Incomplete run/u);
  await assert.rejects(runBare({ model: "opencode-go/qwen", call: refused, dir, log: () => {} }), /isn't anthropic\/<model>/u);
});

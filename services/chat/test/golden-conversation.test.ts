// Golden chat conversation (#118): the finish line for the chat-recovery epic (#125).
//
// Drives the default chat server the way the web client does — create a thread,
// save each user message, open the turn stream, reload the thread — against the
// frozen dataset in test/golden/, with recorded model replies (no provider
// keys). Three turns, as the browser spec asks them (#194): "Analyze NVDA"
// (chart + metric row, #120), then the follow-ups "Compare it with AMD YTD"
// (both companies side by side, with the year-to-date price window, #121/#192)
// and "Explain the differences and show the evidence"; then a reload of all
// three. Every subtest is strict.

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
  // The frozen dataset, as in no-keys mode: its YTD window ends 2026-08-31 (#256).
  DEV_NO_KEYS: "true",
};

type Block = Record<string, unknown> & { id?: string; kind?: string };
type ChatMessage = { message_id: string; role: string; snapshot_id: string; blocks: Block[]; block_proofs?: Record<string, unknown>; answered_by?: string | null };

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
    // ...and the deployment that wrote it is on the completion and saved with the message (#183).
    assert.equal(completed.data.answered_by, "fixture/recorded");
    assert.equal(assistant.answered_by, "fixture/recorded");
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

  // Each turn's answer as streamed, for the reload check after turn 3.
  const turns: Array<{ question: string; streamedIds: unknown[]; answer: ChatMessage }> = [];
  if (assistant) turns.push({ question: "Analyze NVDA", streamedIds: streamedBlockIds(events), answer: assistant });

  await t.test("follow-up 'Compare it with AMD YTD' sets both companies side by side over the year to date", async () => {
    const turnEvents = await runTurn(base, thread.thread_id, "Compare it with AMD YTD");
    const completed = completedTurn(turnEvents);
    assert.deepEqual(completed.data.subject_refs, BOTH_LISTINGS, "'it' should carry NVDA forward and add AMD");

    const answer = await latestAssistantMessage(base, thread.thread_id);
    turns.push({ question: "Compare it with AMD YTD", streamedIds: streamedBlockIds(turnEvents), answer });
    const comparison = comparisonBlock(answer);
    assert.deepEqual(
      (comparison.subjects as Array<{ id: string }>).map((subject) => subject.id),
      [NVDA.issuer_id, AMD.issuer_id],
    );
    // Rows are labelled for people, not by reference id.
    assert.deepEqual(comparison.subject_labels, ["NVDA", "AMD"]);
    // On reload, each block carries the server's own claims (#193): the table is
    // source-linked, but not a verified calculation nor proven public by the
    // cutoff. The chart's drawn points are not yet checked against its sealed
    // series (#236), so it claims no linkage; nor does the narrative.
    assert.deepEqual(answer.block_proofs?.[String(comparison.id)], { evidence: "linked", calculation: "not_verified", public_by_cutoff: "unknown" });
    const chart = answer.blocks.find((block) => block.kind === "perf_comparison");
    assert.deepEqual(answer.block_proofs?.[String(chart?.id)], { evidence: "unknown", calculation: "not_verified", public_by_cutoff: "unknown" });
    const narrative = answer.blocks.find((block) => block.kind === "rich_text");
    assert.equal((answer.block_proofs?.[String(narrative?.id)] as { calculation?: string } | undefined)?.calculation, "not_verified");
    const cited = await citedFacts(answer);
    const refs = valueRefs(comparison);
    assert.ok(refs.length >= 2, "the comparison shows too few figures");
    for (const ref of refs) assert.ok(cited.has(ref), `metrics_comparison value_ref ${ref} is not a cited fact`);

    // Price performance alongside, drawn only from series the snapshot sealed (#133).
    const performance = answer.blocks.find((block) => block.kind === "perf_comparison");
    assert.ok(performance, `expected a perf_comparison; got [${answer.blocks.map((b) => b.kind).join(", ")}]`);
    assert.deepEqual(performance.subject_labels, ["NVDA", "AMD"]);
    const series = performance.series as Array<{ name: string; points: Array<{ x: string; y: number }> }>;
    assert.deepEqual(series.map((line) => line.name), ["NVDA", "AMD"]);
    assert.ok(series.every((line) => line.points.length > 1), "each company needs a price line");
    // The requested year, its baseline and end sessions, and the actual basis are shown (#192).
    assert.equal(performance.title, "Price return YTD 2026 (split-adjusted, excluding dividends)");
    assert.equal(performance.default_range, "YTD 2026: 2025-12-31 close to 2026-08-31 close");
    assert.ok(series.every((line) => line.points[0].x === "2025-12-31" && line.points[0].y === 0));
    const { rows } = await client.query<{
      series_specs: Array<{ series_ref: string; bar_range_id: string; as_of: string; adjustment_basis: string; window: unknown; bars_sha256: string }>;
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
    // The seal describes the chart's data: split-adjusted prices as percent returns
    // over the year-to-date window, each pinned to the bars it was drawn from.
    assert.equal(rows[0]?.basis, "split_adjusted");
    assert.ok((rows[0]?.series_specs ?? []).every((spec) => spec.adjustment_basis === "split_adjusted"));
    assert.equal(rows[0]?.series_specs.length, 2, "one sealed series per company");
    for (const spec of rows[0]?.series_specs ?? []) {
      assert.deepEqual(spec.window, { kind: "ytd", year: 2026, baseline_date: "2025-12-31", end_date: "2026-08-31" });
      assert.match(spec.bars_sha256, /^[0-9a-f]{64}$/);
    }
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
    turns.push({ question: "Explain the differences and show the evidence", streamedIds: streamedBlockIds(turnEvents), answer });
    // The model's whole reply is shown: not the placeholder, nor cut off.
    const narrative = answer.blocks.find((block) => block.kind === "rich_text");
    assert.deepEqual(
      (narrative?.segments as Array<{ text?: string }> | undefined)?.map((segment) => segment.text).join(""),
      "NVIDIA is far larger than AMD and converts more of its revenue into profit, as the table below shows; each figure links to its filing.",
    );
    // The figures it points to are displayed for both companies, and cited.
    const comparison = comparisonBlock(answer);
    assert.deepEqual(comparison.subject_labels, ["NVDA", "AMD"]);
    const cited = await citedFacts(answer);
    const displayed = valueRefs(comparison);
    for (const ref of displayed) assert.ok(cited.has(ref), `metrics_comparison value_ref ${ref} is not a cited fact`);
    const { rows } = await client.query<{ subject_id: string }>(
      `select distinct subject_id::text as subject_id from facts where fact_id = any($1::uuid[])`,
      [displayed],
    );
    assert.deepEqual(
      rows.map((row) => row.subject_id).sort(),
      [NVDA.issuer_id, AMD.issuer_id].sort(),
      "the answer should display cited facts about both companies",
    );
    // Turn 2's YTD window carries over at its cutoff, not the default history window (#206).
    const performance = answer.blocks.find((block) => block.kind === "perf_comparison");
    assert.equal(performance?.default_range, "YTD 2026: 2025-12-31 close to 2026-08-31 close");
    const { rows: scopes } = await client.query<{ research_scope: { price_window: unknown; inherited: string[] } }>(
      `select research_scope from chat_messages
        where thread_id = $1::uuid and role = 'assistant'
        order by created_at`,
      [thread.thread_id],
    );
    const [, compared, explained] = scopes.map((row) => row.research_scope);
    assert.deepEqual(explained?.price_window, compared?.price_window);
    // Asking for the evidence of the previous answer is its own route (#206).
    assert.equal((explained as { route?: string } | undefined)?.route, "evidence_followup");
    assert.deepEqual(explained?.inherited, ["price_window"]);
  });

  await t.test("a reload returns all three turns: questions, figures, chart points and sources", async () => {
    assert.equal(turns.length, 3, "an earlier turn failed");
    const { messages } = await api<{ messages: ChatMessage[] }>(base, "GET", `/v1/chat/threads/${thread.thread_id}/messages`);
    assert.deepEqual(messages.map((message) => message.role), ["user", "assistant", "user", "assistant", "user", "assistant"]);
    const answers = messages.filter((message) => message.role === "assistant");
    for (const [i, turn] of turns.entries()) {
      const reloaded = answers[i]!;
      assert.match(JSON.stringify(messages[i * 2]!.blocks), new RegExp(turn.question));
      // The blocks streamed in the turn, then the same content on every read.
      assert.deepEqual(reloaded.blocks.map((block) => block.id), turn.streamedIds, `turn ${i + 1} streamed other blocks`);
      assert.deepEqual(reloaded.blocks, turn.answer.blocks, `turn ${i + 1} changed on reload`);
      assert.deepEqual(reloaded.block_proofs, turn.answer.block_proofs, `turn ${i + 1}'s proofs changed on reload`);
      // Every block with figures names the sources they came from.
      for (const block of reloaded.blocks.filter((candidate) => valueRefs(candidate).length > 0)) {
        assert.ok((block.source_refs as unknown[] | undefined)?.length, `turn ${i + 1} ${block.kind} has no source_refs`);
      }
    }
    const chart = answers[1]!.blocks.find((block) => block.kind === "perf_comparison");
    assert.ok((chart?.series as Array<{ points: unknown[] }>).every((line) => line.points.length > 1), "the chart lost its points");
  });

  // A turn continues the scope when it covers one of the previous answer's
  // companies, however it names them; one about other companies starts fresh (#206).
  await t.test("naming the same companies again keeps the scope; another company starts fresh", async () => {
    const latestScope = async () =>
      (await client.query<{ research_scope: { price_window: unknown; inherited: string[] } }>(
        `select research_scope from chat_messages
          where thread_id = $1::uuid and role = 'assistant'
          order by created_at desc limit 1`,
        [thread.thread_id],
      )).rows[0]?.research_scope;
    const established = await latestScope();
    completedTurn(await runTurn(base, thread.thread_id, "Compare NVDA and AMD again"));
    const again = await latestScope();
    assert.deepEqual(again?.price_window, established?.price_window);
    assert.deepEqual(again?.inherited, ["price_window"]);
    // An answer with no scope and no company (an enforced financial gap) erases
    // neither: the next follow-up still carries both companies and the window.
    const gap = await client.query<{ snapshot_id: string }>(
      `insert into snapshots (subject_refs, as_of, basis, normalization, allowed_transforms)
       values (jsonb_build_array(jsonb_build_object('kind', 'screen', 'id', $1::text)), now(), 'unadjusted', 'raw', '{}')
       returning snapshot_id::text as snapshot_id`,
      [thread.thread_id],
    );
    await client.query(
      `insert into chat_messages (thread_id, role, snapshot_id, blocks, content_hash)
       values ($1::uuid, 'assistant', $2::uuid, '[]'::jsonb, 'gap')`,
      [thread.thread_id, gap.rows[0]!.snapshot_id],
    );
    const explained = await runTurn(base, thread.thread_id, "Explain the differences");
    assert.deepEqual(completedTurn(explained).data.subject_refs, BOTH_LISTINGS);
    assert.deepEqual((await latestScope())?.price_window, established?.price_window);
    completedTurn(await runTurn(base, thread.thread_id, "Analyze AAPL"));
    const other = await latestScope();
    assert.equal(other?.price_window, null);
    assert.deepEqual(other?.inherited, []);
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
    // The saved scope covers the auto-selected peer, so a follow-up about AMD continues it (#206).
    const { rows } = await client.query<{ research_scope: { companies: Array<{ issuer_id: string }> } }>(
      `select research_scope from chat_messages where thread_id = $1::uuid and role = 'assistant'`,
      [peersThread.thread_id],
    );
    assert.deepEqual(rows[0]?.research_scope.companies.map((company) => company.issuer_id), [NVDA.issuer_id, AMD.issuer_id]);
    // Turning peers off removes the auto-selected peer too, even after an
    // ordinary follow-up in between: NVDA alone (#206).
    completedTurn(await runTurn(base, peersThread.thread_id, "Explain the differences"));
    completedTurn(await runTurn(base, peersThread.thread_id, "Drop the peers"));
    const after = await client.query<{ research_scope: { route: string; peers: boolean; companies: Array<{ issuer_id: string }> } }>(
      `select research_scope from chat_messages where thread_id = $1::uuid and role = 'assistant' order by created_at desc limit 1`,
      [peersThread.thread_id],
    );
    assert.equal(after.rows[0]?.research_scope.peers, false);
    assert.deepEqual(after.rows[0]?.research_scope.companies.map((company) => company.issuer_id), [NVDA.issuer_id]);
    assert.notEqual(after.rows[0]?.research_scope.route, "comparison");
    // ...and the next follow-up does not carry the peer back.
    completedTurn(await runTurn(base, peersThread.thread_id, "Explain it"));
    const next = await client.query<{ research_scope: { companies: Array<{ issuer_id: string }> } }>(
      `select research_scope from chat_messages where thread_id = $1::uuid and role = 'assistant' order by created_at desc limit 1`,
      [peersThread.thread_id],
    );
    assert.deepEqual(next.rows[0]?.research_scope.companies.map((company) => company.issuer_id), [NVDA.issuer_id]);
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
    // A segment request reads segment facts only (#206).
    assert.equal(answer.blocks.some((block) => block.kind === "revenue_bars"), false);
  });

  await t.test("a company with no segment facts gets no breakdown block", async () => {
    const amdThread = await api<{ thread_id: string }>(base, "POST", "/v1/chat/threads", { title: "AMD segments" });
    completedTurn(await runTurn(base, amdThread.thread_id, "Break down AMD's revenue by segment"));
    const answer = await latestAssistantMessage(base, amdThread.thread_id);
    assert.equal(answer.blocks.some((block) => /by segment/.test(String(block.title))), false);
    // The breakdown is a named gap, with nothing else in its place (#206).
    assert.match(JSON.stringify(answer.blocks), /Revenue by segment is not available for AMD in this data\./);
    assert.equal(answer.blocks.some((block) => block.kind === "metric_row" || block.kind === "revenue_bars"), false);
    // Asking for its evidence re-reads the same segment facts, keeping the gap.
    completedTurn(await runTurn(base, amdThread.thread_id, "Show the evidence"));
    const evidence = await latestAssistantMessage(base, amdThread.thread_id);
    assert.match(JSON.stringify(evidence.blocks), /Revenue by segment is not available for AMD in this data\./);
    assert.equal(evidence.blocks.some((block) => block.kind === "metric_row" || block.kind === "revenue_bars"), false);
  });

  await t.test("segments asked for with a margin trend read both (#206)", async () => {
    const mixedThread = await api<{ thread_id: string }>(base, "POST", "/v1/chat/threads", { title: "Segments and margins" });
    completedTurn(await runTurn(base, mixedThread.thread_id, "Break down NVDA's revenue by segment and show its operating margin trend"));
    const answer = await latestAssistantMessage(base, mixedThread.thread_id);
    assert.ok(answer.blocks.some((block) => /by segment/.test(String(block.title))), "expected the segment breakdown");
    assert.ok(answer.blocks.some((block) => block.title === "Operating margin by quarter"), `expected the margin trend; got [${answer.blocks.map((b) => b.title).join(", ")}]`);
    // ...and with a current margin, the latest quarter's margins.
    completedTurn(await runTurn(base, mixedThread.thread_id, "Break down NVDA's revenue by segment and show its gross margin"));
    const latest = await latestAssistantMessage(base, mixedThread.thread_id);
    assert.ok(latest.blocks.some((block) => /by segment/.test(String(block.title))), "expected the segment breakdown");
    assert.ok(latest.blocks.some((block) => /^Latest quarter/.test(String(block.title))), `expected the latest quarter's margins; got [${latest.blocks.map((b) => b.title).join(", ")}]`);
  });

  await t.test("'What is AMD's free cash flow?' is a named gap that reads no income-statement facts (#206)", async () => {
    const fcfThread = await api<{ thread_id: string }>(base, "POST", "/v1/chat/threads", { title: "AMD FCF" });
    completedTurn(await runTurn(base, fcfThread.thread_id, "What is AMD's free cash flow?"));
    const answer = await latestAssistantMessage(base, fcfThread.thread_id);
    assert.match(JSON.stringify(answer.blocks), /Free cash flow is not available for AMD in this data, so no other figure is shown in its place\./);
    assert.equal(answer.blocks.some((block) => block.kind === "metric_row" || block.kind === "revenue_bars"), false);
    const { rows } = await client.query<{ research_scope: { route: string } }>(
      `select research_scope from chat_messages where thread_id = $1::uuid and role = 'assistant'`,
      [fcfThread.thread_id],
    );
    assert.equal(rows[0]?.research_scope.route, "unavailable_metric");
  });

  // #206: a three-company comparison with metrics, a YTD window and a benchmark,
  // then a table, an explanation, a dropped company, an unclear new one, the
  // company added back, and the benchmark turned off. Each turn keeps what it
  // does not change, read back from the saved answer as a reload would.
  await t.test("a research scope survives a table, an explanation, and companies dropped and added back", async () => {
    const AAPL = GOLDEN_COMPANIES.find((company) => company.ticker === "AAPL")!;
    const regressionThread = await api<{ thread_id: string }>(base, "POST", "/v1/chat/threads", { title: "Scope regression" });
    type Saved = { route: string; companies: Array<{ issuer_id: string }>; metrics: Array<{ metric_key: string }>; price_window: { cutoff: string } | null; benchmark: boolean; inherited: string[] };
    const saved = async (): Promise<Saved[]> =>
      (await client.query<{ research_scope: Saved | null }>(
        `select research_scope from chat_messages
          where thread_id = $1::uuid and role = 'assistant' order by created_at`,
        [regressionThread.thread_id],
      )).rows.map((row) => row.research_scope!);
    const turn = async (question: string) => {
      completedTurn(await runTurn(base, regressionThread.thread_id, question));
      return (await saved()).at(-1)!;
    };
    const issuers = (scope: Saved) => scope.companies.map((company) => company.issuer_id);
    const benchmarkGap = /A benchmark index is not in this data, so the companies are compared only with each other\./;

    const first = await turn("Compare NVDA, AMD and AAPL revenue and margins YTD against the S&P 500");
    assert.deepEqual(issuers(first), [NVDA.issuer_id, AMD.issuer_id, AAPL.issuer_id]);
    assert.ok(first.price_window, "the YTD window is recorded");
    assert.equal(first.benchmark, true);
    assert.deepEqual(first.metrics.map((metric) => metric.metric_key), ["income_statement"]);
    const firstAnswer = await latestAssistantMessage(base, regressionThread.thread_id);
    assert.match(JSON.stringify(firstAnswer.blocks), benchmarkGap);
    // "S&P" is not two companies the answer could not find.
    assert.doesNotMatch(JSON.stringify(firstAnswer.blocks), /could not find/);

    const unchanged = (scope: Saved, companies: string[]) => {
      assert.deepEqual(issuers(scope), companies);
      assert.deepEqual(scope.price_window, first.price_window, "the window keeps its first cutoff");
      assert.equal(scope.benchmark, true);
      assert.deepEqual(scope.metrics, first.metrics);
    };
    const all = [NVDA.issuer_id, AMD.issuer_id, AAPL.issuer_id];
    unchanged(await turn("Show it as a table"), all);
    assert.match(JSON.stringify((await latestAssistantMessage(base, regressionThread.thread_id)).blocks), benchmarkGap);
    unchanged(await turn("Explain the differences"), all);
    unchanged(await turn("Drop AAPL"), [NVDA.issuer_id, AMD.issuer_id]);

    // A new company named without "add" or "just": asked about, nothing answered.
    const before = (await saved()).length;
    const asked = await runTurn(base, regressionThread.thread_id, "What about AAPL?");
    assert.equal(completedTurn(asked).data.clarification, true);
    assert.match(JSON.stringify(asked), /Add AAPL to the NVDA and AMD comparison, or look at AAPL alone\?/);
    assert.equal((await saved()).length, before + 1);
    assert.equal((await saved()).at(-1), null, "the question is saved with no scope");

    unchanged(await turn("add AAPL"), all);
    const off = await turn("Same, without the benchmark");
    assert.equal(off.benchmark, false);
    assert.deepEqual(issuers(off), all);
    assert.deepEqual(off.price_window, first.price_window);
    assert.doesNotMatch(JSON.stringify((await latestAssistantMessage(base, regressionThread.thread_id)).blocks), benchmarkGap);

    // A reload reads back every answer, the question included.
    const { messages } = await api<{ messages: ChatMessage[] }>(base, "GET", `/v1/chat/threads/${regressionThread.thread_id}/messages`);
    assert.equal(messages.filter((message) => message.role === "assistant").length, 7);
  });

  await t.test("'Compare NVDA with AMD' without a period charts the shared price history, not YTD", async () => {
    const defaultThread = await api<{ thread_id: string }>(base, "POST", "/v1/chat/threads", { title: "Default window" });
    const turnEvents = await runTurn(base, defaultThread.thread_id, "Compare NVDA with AMD");
    assert.deepEqual(completedTurn(turnEvents).data.subject_refs, BOTH_LISTINGS);
    const answer = await latestAssistantMessage(base, defaultThread.thread_id);
    const performance = answer.blocks.find((block) => block.kind === "perf_comparison");
    assert.ok(performance, `expected a perf_comparison; got [${answer.blocks.map((b) => b.kind).join(", ")}]`);
    assert.equal(performance.title, "Price return (split-adjusted, excluding dividends)");
    assert.doesNotMatch(String(performance.default_range), /YTD/);
    // A line per company, each drawn from a series the snapshot sealed.
    const series = performance.series as Array<{ name: string; points: unknown[] }>;
    assert.deepEqual(series.map((line) => line.name), ["NVDA", "AMD"]);
    assert.ok(series.every((line) => line.points.length > 1), "each company needs a price line");
    const { rows } = await client.query<{ series_specs: Array<{ series_ref: string; adjustment_basis: string; window?: unknown }> }>(
      `select series_specs from snapshots where snapshot_id = $1::uuid`,
      [answer.snapshot_id],
    );
    const specs = rows[0]?.series_specs ?? [];
    assert.equal(specs.length, 2, "one sealed series per company");
    assert.ok(specs.every((spec) => spec.adjustment_basis === "split_adjusted"));
    assert.ok(specs.every((spec) => spec.window === undefined), "no YTD window was asked for");
    const seriesRefs = (performance.data_ref as { params: { series_refs: string[] } }).params.series_refs;
    assert.deepEqual([...seriesRefs].sort(), specs.map((spec) => spec.series_ref).sort());
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

function streamedBlockIds(events: ParsedSseEvent[]): unknown[] {
  return events.filter((event) => event.event === "block.completed").map((event) => event.data.block_id);
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

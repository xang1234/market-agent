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
import { readChatMessage } from "../src/messages.ts";
import { loadChatServerOptionsFromEnv } from "../src/runtime.ts";
import { isFinancialRequest } from "../src/financial-runtime.ts";
import { STARTER_QUESTIONS } from "../../../web/src/chat/starterQuestionList.ts";
import { AMD_Q2_2025_RELEASE, GOLDEN_COMPANIES, seedGoldenDataset } from "./golden/dataset.ts";
import { requireRecordedScopes } from "./golden/harness.ts";
import type { Client } from "pg";
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
  requireRecordedScopes(t);
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
    // The narrative is rendered from the recorded reply's assertions, so the LLM step really ran.
    const narrative = assistant.blocks.find((block) => block.kind === "rich_text");
    assert.equal(
      (narrative?.segments as Array<{ text?: string; format?: string }> | undefined)?.map((segment) => segment.text ?? segment.format).join(""),
      "NVDA's revenue rose in every period from Q1 2025 ($26.0B) to Q4 2026 ($62.1B).",
    );
    // ...and the deployment that wrote it is on the completion and saved with the message (#183).
    assert.equal(completed.data.answered_by, "fixture/recorded");
    assert.equal(assistant.answered_by, "fixture/recorded");
  });

  await t.test("the rendered answer passes strict verification, each value a fact the snapshot cites (#208)", async () => {
    const completed = events.find((event) => event.event === "turn.completed")!;
    assert.equal(completed.data.unverified, undefined, `the rendered answer failed verification: ${JSON.stringify(completed.data.unverified)}`);
    assert.equal((completed.data.assertion_report as { rendered?: boolean } | undefined)?.rendered, true);
    const segments = (assistant!.blocks.find((block) => block.kind === "rich_text")?.segments ?? []) as Array<{ type: string; ref_kind?: string; ref_id?: string }>;
    const factRefs = segments.filter((segment) => segment.type === "ref" && segment.ref_kind === "fact").map((segment) => segment.ref_id!);
    assert.equal(factRefs.length, 2);
    const { rows } = await client.query<{ fact_refs: string[] }>(`select fact_refs from snapshots where snapshot_id = $1::uuid`, [assistant!.snapshot_id]);
    for (const ref of factRefs) assert.ok((rows[0]?.fact_refs ?? []).includes(ref), `the rendered value ${ref} is not a fact the snapshot cites`);
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
  const turns: Array<{ question: string; streamedIds: unknown[]; answer: ChatMessage; completed: ParsedSseEvent }> = [];
  if (assistant) turns.push({ question: "Analyze NVDA", streamedIds: streamedBlockIds(events), answer: assistant, completed: completedTurn(events) });

  await t.test("follow-up 'Compare it with AMD YTD' sets both companies side by side over the year to date", async () => {
    const turnEvents = await runTurn(base, thread.thread_id, "Compare it with AMD YTD");
    const completed = completedTurn(turnEvents);
    assert.deepEqual(completed.data.subject_refs, BOTH_LISTINGS, "'it' should carry NVDA forward and add AMD");

    const answer = await latestAssistantMessage(base, thread.thread_id);
    turns.push({ question: "Compare it with AMD YTD", streamedIds: streamedBlockIds(turnEvents), answer, completed });
    const comparison = comparisonBlock(answer);
    assert.deepEqual(
      (comparison.subjects as Array<{ id: string }>).map((subject) => subject.id),
      [NVDA.issuer_id, AMD.issuer_id],
    );
    // Rows are labelled for people, not by reference id.
    assert.deepEqual(comparison.subject_labels, ["NVDA", "AMD"]);
    // On reload, each block carries the server's own claims (#193): the table is
    // source-linked, but not a verified calculation nor proven public by the
    // cutoff. So is the chart, whose drawn points the seal recomputed from its
    // sealed bars (#236). The narrative claims no linkage.
    assert.deepEqual(answer.block_proofs?.[String(comparison.id)], { evidence: "linked", calculation: "not_verified", public_by_cutoff: "unknown" });
    const chart = answer.blocks.find((block) => block.kind === "perf_comparison");
    assert.deepEqual(answer.block_proofs?.[String(chart?.id)], { evidence: "linked", calculation: "not_verified", public_by_cutoff: "unknown" });
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
    const completed = completedTurn(turnEvents);
    assert.deepEqual(completed.data.subject_refs, BOTH_LISTINGS);
    // The same comparison reuses turn 2's derived facts instead of re-minting them (#134).
    assert.equal(await derivedFacts(), derivedBefore, "turn 3 added derived facts");

    const answer = await latestAssistantMessage(base, thread.thread_id);
    turns.push({ question: "Explain the differences and show the evidence", streamedIds: streamedBlockIds(turnEvents), answer, completed });
    // The answer is rendered from the recorded reply's assertions: not the placeholder, nor the fallback.
    const narrative = answer.blocks.find((block) => block.kind === "rich_text");
    assert.deepEqual(
      (narrative?.segments as Array<{ text?: string; format?: string }> | undefined)?.map((segment) => segment.text ?? segment.format).join(""),
      [
        "Of NVDA and AMD, NVDA's gross margin was highest: NVDA 70.8% (FY2026, ended Jan 2026), AMD 49.9% (FY2025, ended Dec 2025), 20.9 percentage points above AMD.",
        "Of NVDA and AMD, NVDA's net margin was highest: NVDA 53.6% (FY2026, ended Jan 2026), AMD 12.0% (FY2025, ended Dec 2025), 41.6 percentage points above AMD.",
        "The periods compared end at different times, so they do not line up: NVDA's FY2026 ended Jan 2026 and AMD's FY2025 ended Dec 2025.",
      ].join("\n\n"),
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

  // The client hands off on the completion, so it must carry exactly what a
  // reload returns: the same row and the same server-derived proofs (#331).
  await t.test("each turn.completed carries the sealed message the GET returns for that turn", async () => {
    assert.equal(turns.length, 3, "an earlier turn failed");
    const { messages } = await api<{ messages: ChatMessage[] }>(base, "GET", `/v1/chat/threads/${thread.thread_id}/messages`);
    for (const [i, turn] of turns.entries()) {
      const sealed = turn.completed.data.message as ChatMessage | undefined;
      assert.ok(sealed, `turn ${i + 1}'s completion carries no message`);
      assert.equal(sealed.message_id, turn.completed.data.message_id);
      const listed = messages.find((message) => message.message_id === sealed.message_id);
      assert.ok(listed, `turn ${i + 1}'s message is not in the thread`);
      assert.equal(JSON.stringify(sealed), JSON.stringify(listed), `turn ${i + 1}'s completion differs from the GET`);
    }
    const first = String(turns[0]!.completed.data.message_id);
    assert.equal(
      JSON.stringify(await readChatMessage(client, { thread_id: thread.thread_id, message_id: first })),
      JSON.stringify(messages.find((message) => message.message_id === first)),
    );
    assert.equal(await readChatMessage(client, { thread_id: randomUUID(), message_id: first }), null, "another thread reads nothing");
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

  await t.test("dropping an auto-selected peer by name keeps it out (#206)", async () => {
    const dropThread = await api<{ thread_id: string }>(base, "POST", "/v1/chat/threads", { title: "Drop a peer" });
    completedTurn(await runTurn(base, dropThread.thread_id, "How does NVDA compare with its peers?"));
    completedTurn(await runTurn(base, dropThread.thread_id, "Drop AMD"));
    const { rows } = await client.query<{ research_scope: { route: string; peers: boolean; companies: Array<{ issuer_id: string }> } }>(
      `select research_scope from chat_messages where thread_id = $1::uuid and role = 'assistant' order by created_at desc limit 1`,
      [dropThread.thread_id],
    );
    // NVDA's only peer here is AMD: dropping it leaves NVDA alone, peers off.
    assert.deepEqual(rows[0]?.research_scope.companies.map((company) => company.issuer_id), [NVDA.issuer_id]);
    assert.equal(rows[0]?.research_scope.peers, false);
    assert.notEqual(rows[0]?.research_scope.route, "comparison");
  });

  await t.test("'Break down NVDA's revenue by segment' is a declared gap: the engine has no segment definition (#157)", async () => {
    const segmentsThread = await api<{ thread_id: string }>(base, "POST", "/v1/chat/threads", { title: "Segments" });
    const completed = completedTurn(await runTurn(base, segmentsThread.thread_id, "Break down NVDA's revenue by segment"));
    assert.deepEqual(completed.data.financial_gap, { reason_code: "unsupported" });
    assert.deepEqual(answerText(await latestAssistantMessage(base, segmentsThread.thread_id)), [UNSUPPORTED]);
  });

  await t.test("'Why did AMD's operating margin turn negative in Q2 2025?' shows the certified margin and names the cause as not calculated, citing no claim (#282)", async () => {
    const amd = GOLDEN_COMPANIES.find((company) => company.ticker === "AMD")!;
    await seedLateClaim(client, amd.issuer_id);
    const thread = await api<{ thread_id: string }>(base, "POST", "/v1/chat/threads", { title: "AMD margin" });
    completedTurn(await runTurn(base, thread.thread_id, "Why did AMD's operating margin turn negative in Q2 2025?"));
    const answer = await latestAssistantMessage(base, thread.thread_id);
    assert.deepEqual(engineAnswer(answer), {
      results: [["Operating margin (operating income / revenue)", "Q2 FY2025", "verified", "-1.74%"]],
      notes: ["Not covered by this answer: the cause of these figures."],
    });
    const { rows } = await client.query<{ claim_refs: string[] }>(`select claim_refs from snapshots where snapshot_id = $1::uuid`, [answer.snapshot_id]);
    assert.deepEqual(rows[0]?.claim_refs, []);
  });

  await t.test("a named past quarter is the quarter calculated; a quarter not on file is a declared gap (#290)", async () => {
    const thread = await api<{ thread_id: string }>(base, "POST", "/v1/chat/threads", { title: "AMD Q2 2025" });
    completedTurn(await runTurn(base, thread.thread_id, "Why did AMD's operating margin turn negative in Q2 2025?"));
    assert.deepEqual(engineAnswer(await latestAssistantMessage(base, thread.thread_id)).results.map(([, period]) => period), ["Q2 FY2025"]);

    const missing = await api<{ thread_id: string }>(base, "POST", "/v1/chat/threads", { title: "AMD Q2 2019" });
    completedTurn(await runTurn(base, missing.thread_id, "What was AMD's revenue in Q2 2019?"));
    assert.deepEqual(engineAnswer(await latestAssistantMessage(base, missing.thread_id)), {
      results: [["Revenue", "Q2 FY2019", "missing", "No eligible input was public before the knowledge cutoff."]],
      notes: [],
    });
  });

  await t.test("a segment breakdown is a declared gap; asking for its evidence continues AMD and shows no figure in its place (#425)", async () => {
    const amdThread = await api<{ thread_id: string }>(base, "POST", "/v1/chat/threads", { title: "AMD segments" });
    const completed = completedTurn(await runTurn(base, amdThread.thread_id, "Break down AMD's revenue by segment"));
    assert.deepEqual(completed.data.financial_gap, { reason_code: "unsupported" });
    assert.deepEqual(answerText(await latestAssistantMessage(base, amdThread.thread_id)), [UNSUPPORTED]);
    const evidence = completedTurn(await runTurn(base, amdThread.thread_id, "Show the evidence"));
    assert.deepEqual(evidence.data.subject_refs, [{ kind: "issuer", id: AMD.issuer_id }]);
    assert.deepEqual(answerText(await latestAssistantMessage(base, amdThread.thread_id)), [
      "The data here does not answer this question; the note below says what is missing.",
      "The previous answer showed no figure, so there is no evidence to show; no other figure is shown in its place.",
    ]);
    const { rows } = await client.query<{ research_scope: { route: string; reads: string; companies: unknown; metrics: unknown[] } }>(
      `select research_scope from chat_messages where thread_id = $1::uuid and role = 'assistant' order by created_at`,
      [amdThread.thread_id],
    );
    assert.deepEqual(rows.map(({ research_scope: scope }) => [scope.route, scope.reads, scope.companies, scope.metrics]), [
      ["financial_gap", "financial_gap", [{ issuer_id: AMD.issuer_id, label: "AMD" }], []],
      ["evidence_followup", "financial_gap", [{ issuer_id: AMD.issuer_id, label: "AMD" }], []],
    ]);
  });

  await t.test("segments asked for with a margin trend, or with a margin, are one declared gap: no segment definition (#206)", async () => {
    const mixedThread = await api<{ thread_id: string }>(base, "POST", "/v1/chat/threads", { title: "Segments and margins" });
    for (const question of ["Break down NVDA's revenue by segment and show its operating margin trend", "Break down NVDA's revenue by segment and show its gross margin"]) {
      assert.deepEqual(completedTurn(await runTurn(base, mixedThread.thread_id, question)).data.financial_gap, { reason_code: "unsupported" }, question);
      assert.deepEqual(answerText(await latestAssistantMessage(base, mixedThread.thread_id)), [UNSUPPORTED], question);
    }
  });

  await t.test("each starter question that names a metric gets the engine's answer, not a request to name the company", async () => {
    const metricStarters = STARTER_QUESTIONS.filter(isFinancialRequest);
    assert.deepEqual(metricStarters, ["What drives AAPL's margins?"]);
    const starterThread = await api<{ thread_id: string }>(base, "POST", "/v1/chat/threads", { title: "Starter" });
    completedTurn(await runTurn(base, starterThread.thread_id, metricStarters[0]!));
    assert.deepEqual(engineAnswer(await latestAssistantMessage(base, starterThread.thread_id)), {
      results: [
        ["Gross margin (gross profit / revenue)", "latest fiscal year", "verified", "46.91%"],
        ["Operating margin (operating income / revenue)", "latest fiscal year", "verified", "31.97%"],
        ["Net margin (net income / revenue)", "latest fiscal year", "verified", "26.92%"],
      ],
      notes: ["Not covered by this answer: the cause of these figures."],
    });
  });

  // The frozen dataset has no cash flow facts.
  await t.test("'What is AMD's free cash flow?' is calculated by the engine; its inputs are declared gaps (#206)", async () => {
    const fcfThread = await api<{ thread_id: string }>(base, "POST", "/v1/chat/threads", { title: "AMD FCF" });
    completedTurn(await runTurn(base, fcfThread.thread_id, "What is AMD's free cash flow?"));
    assert.deepEqual(engineAnswer(await latestAssistantMessage(base, fcfThread.thread_id)), {
      results: [
        ["Operating cash flow", "latest fiscal year", "missing", "No eligible input was public before the knowledge cutoff."],
        ["Capital expenditures (PP&E cash payments)", "latest fiscal year", "missing", "No eligible input was public before the knowledge cutoff."],
        ["Free cash flow (OCF less PP&E cash capex)", "latest fiscal year", "blocked_dependency", "A required input or calculation is unavailable."],
      ],
      notes: [],
    });
    const { rows } = await client.query<{ research_scope: { route: string } }>(
      `select research_scope from chat_messages where thread_id = $1::uuid and role = 'assistant'`,
      [fcfThread.thread_id],
    );
    assert.equal(rows[0]?.research_scope.route, "financial_answer");
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
    const firstAnswer = engineAnswer(await latestAssistantMessage(base, regressionThread.thread_id));
    assert.equal(firstAnswer.results.length, 12);
    assert.ok(firstAnswer.results.every(([, , disposition]) => disposition === "verified"), JSON.stringify(firstAnswer.results));
    // "S&P" is not two companies the answer could not find.
    assert.deepEqual(firstAnswer.notes, ["Not covered by this answer: a stock price return; a comparison with a benchmark index."]);

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
    // The engine's answer seals its companies as issuers, so they carry forward by legal name.
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

  // Two listings under one ticker are one company, so the engine plans it
  // without asking. Last, as the listings it adds stay.
  await t.test("a company two listings name keeps its peers after its engine answer, and keeps itself when they are turned off (#425)", async () => {
    await client.query(
      `insert into listings (listing_id, instrument_id, mic, ticker, trading_currency, timezone)
       values (gen_random_uuid(), $1::uuid, 'XNAS', 'AMDX', 'USD', 'America/New_York'),
              (gen_random_uuid(), $1::uuid, 'XETR', 'AMDX', 'EUR', 'Europe/Berlin')`,
      [AMD.instrument_id],
    );
    const peersThread = await api<{ thread_id: string }>(base, "POST", "/v1/chat/threads", { title: "AMDX peers" });
    const scope = async () => {
      const { rows } = await client.query<{ research_scope: { companies: unknown; peers: boolean } }>(
        `select research_scope from chat_messages where thread_id = $1::uuid and role = 'assistant' order by created_at desc limit 1`,
        [peersThread.thread_id],
      );
      return { companies: rows[0]?.research_scope.companies, peers: rows[0]?.research_scope.peers };
    };
    // Named by the ticker it was asked by, in every turn.
    const amd = { issuer_id: AMD.issuer_id, label: "AMDX" };

    completedTurn(await runTurn(base, peersThread.thread_id, "How does AMDX's Q2 2025 revenue compare with its peers?"));
    assert.deepEqual(engineAnswer(await latestAssistantMessage(base, peersThread.thread_id)).results.map(([measure, period, disposition]) => [measure, period, disposition]), [["Revenue", "Q2 FY2025", "verified"]]);
    assert.deepEqual(await scope(), { companies: [amd], peers: true });
    completedTurn(await runTurn(base, peersThread.thread_id, "Explain it"));
    // AMD's industry peer is auto-selected, so it carries no label.
    assert.deepEqual(await scope(), { companies: [amd, { issuer_id: NVDA.issuer_id }], peers: true });
    completedTurn(await runTurn(base, peersThread.thread_id, "Drop the peers"));
    assert.deepEqual(await scope(), { companies: [amd], peers: false });
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

// A segment request's gap, worded from the planner's closed reason (#425).
const UNSUPPORTED = "This request asks for a calculation outside the verified financial definitions I can compute: revenue or results by business segment.";

function answerText(message: ChatMessage): string[] {
  return message.blocks.filter((block) => block.kind === "rich_text")
    .map((block) => (block.segments as Array<{ text?: string }>).map((segment) => segment.text ?? "").join(""));
}

function engineAnswer(message: ChatMessage): { results: Array<[measure: string, period: string, disposition: string, text: string]>; notes: string[] } {
  const [block, ...notes] = message.blocks;
  assert.equal(block?.kind, "financial_answer", `expected an engine answer; got [${message.blocks.map((b) => b.kind).join(", ")}]`);
  const financial = block.financial as {
    labels: Record<string, { text: string }>;
    results: Array<{ measure_label_id: string; period_label_id: string; disposition: string; presented: { text: string } }>;
  };
  return {
    results: financial.results.map((result) =>
      [financial.labels[result.measure_label_id]!.text, financial.labels[result.period_label_id]!.text, result.disposition, result.presented.text]),
    notes: answerText({ ...message, blocks: notes }),
  };
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

// An AMD claim published a month after the golden cutoff (#282).
async function seedLateClaim(client: Client, issuerId: string): Promise<string> {
  const { rows: [doc] } = await client.query<{ document_id: string }>(
    `insert into documents (source_id, kind, title, published_at, content_hash, raw_blob_id, parse_status)
     select source_id, 'press_release', 'A later AMD release', '2026-10-01T00:00:00Z', 'sha256:${"c".repeat(64)}', 'ephemeral:late', 'parsed'
       from sources where canonical_url = $1
     returning document_id::text`,
    [AMD_Q2_2025_RELEASE.url],
  );
  const { rows: [claim] } = await client.query<{ claim_id: string }>(
    `insert into claims (document_id, predicate, text_canonical, polarity, modality, reported_by_source_id, effective_time, confidence, status)
     select $1::uuid, 'kpi.commentary', 'A later explanation published after the cutoff.', 'negative', 'asserted', d.source_id, '2025-06-28T00:00:00Z', 0.95, 'extracted'
       from documents d where d.document_id = $1::uuid
     returning claim_id::text`,
    [doc!.document_id],
  );
  await client.query(
    `insert into claim_arguments (claim_id, subject_kind, subject_id, role) values ($1::uuid, 'issuer', $2::uuid, 'subject')`,
    [claim!.claim_id, issuerId],
  );
  return claim!.claim_id;
}

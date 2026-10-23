// Golden chat conversation (#118): the finish line for the chat-recovery epic (#125).
//
// Drives the default chat server the way the web client does — create a thread,
// save each user message, open the turn stream, reload the thread — against the
// frozen dataset in test/golden/, with recorded model replies (no provider
// keys). Three turns, as the browser spec asks them (#194): "Analyze NVDA"
// (the engine's verified overview, #398), then the follow-ups "Compare it with
// AMD YTD" (both companies' year-to-date price chart, market data outside the
// engine, #192, #398 D2) and "Explain the differences and show the evidence"
// (the chart and the cause management filed); then a reload of all three.
// Every subtest is strict.

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
const CARRIED_NVDA_WITH_AMD = [
  { kind: "issuer", id: NVDA.issuer_id },
  { kind: "listing", id: AMD.listing_id },
];

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

  await t.test("turn completes on NVDA and the answer is persisted", async () => {
    const error = events.find((event) => event.event === "turn.error");
    assert.equal(error, undefined, `turn.error: ${JSON.stringify(error?.data)}`);
    const completed = events.find((event) => event.event === "turn.completed");
    assert.ok(completed, `no turn.completed; events: ${events.map((event) => event.event).join(", ")}`);
    assert.equal(completed.data.bundle_id, "financial_answer", "a question about a company is the engine's (#398)");
    assert.ok(assistant, "assistant message missing from the reloaded thread");
    assert.equal(assistant.message_id, completed.data.message_id);
    const { rows } = await client.query<{ research_scope: { companies: unknown } }>(`select research_scope from chat_messages where message_id = $1::uuid`, [assistant.message_id]);
    assert.deepEqual(rows[0]?.research_scope.companies, [{ issuer_id: NVDA.issuer_id, label: "NVDA" }], "the turn should resolve 'NVDA' to the seeded company");
    // The commentary is rendered from the recorded reply's assertions, so the LLM step really ran.
    assert.deepEqual(engineAnswer(assistant).notes, [
      "NVDA's revenue rose in every period from Q1 FY2025 (USD 26,044,000,000.00) to Q4 FY2026 (USD 62,100,000,000.00).\n\n" +
        "NVDA's gross margin (gross profit / revenue) was 74.40%, operating margin (operating income / revenue) 64.90% and net margin (net income / revenue) 57.00% in Q4 FY2026.",
    ]);
    // ...and the deployment that wrote it is on the completion and saved with the message (#183).
    assert.equal(completed.data.answered_by, "fixture/recorded");
    assert.equal(assistant.answered_by, "fixture/recorded");
  });

  await t.test("the answer passes strict verification, and each value its commentary shows is one of its verified results (#208)", () => {
    const [answer, commentary] = assistant!.blocks;
    assert.deepEqual(assistant!.block_proofs?.[answer!.id!], { evidence: "linked", calculation: "verified", public_by_cutoff: "proven" });
    const results = new Map((answer!.financial as { results: Array<{ result_id: string; disposition: string; presented: { text: string } }> }).results.map((result) => [result.result_id, result]));
    const refs = (commentary!.segments as Array<{ type: string; ref_kind?: string; ref_id?: string; format?: string }>).filter((segment) => segment.type === "ref");
    assert.deepEqual(refs.map((ref) => [ref.ref_kind, results.get(ref.ref_id!)?.disposition, ref.format === results.get(ref.ref_id!)?.presented.text]), [
      ["result", "verified", true], ["result", "verified", true], ["result", "verified", true], ["result", "verified", true], ["result", "verified", true],
    ]);
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

  await t.test("the answer shows NVDA's eight quarters of revenue and each one's growth, its latest margins and year-over-year growth, and the quarters' high and low, each verified from cited facts", async () => {
    assert.ok(assistant);
    assert.deepEqual(engineAnswer(assistant).results, [
      ["Revenue", "Q1 FY2025", "verified", "USD 26,044,000,000.00"],
      ["Revenue", "Q2 FY2025", "verified", "USD 30,040,000,000.00"],
      ["Revenue", "Q3 FY2025", "verified", "USD 35,082,000,000.00"],
      ["Revenue", "Q4 FY2025", "verified", "USD 39,331,000,000.00"],
      ["Revenue", "Q1 FY2026", "verified", "USD 44,062,000,000.00"],
      ["Revenue", "Q2 FY2026", "verified", "USD 46,743,000,000.00"],
      ["Revenue", "Q3 FY2026", "verified", "USD 57,006,000,000.00"],
      ["Revenue", "Q4 FY2026", "verified", "USD 62,100,000,000.00"],
      ["Gross profit", "Q4 FY2026", "verified", "USD 46,200,000,000.00"],
      ["Operating income", "Q4 FY2026", "verified", "USD 40,300,000,000.00"],
      ["Net income", "Q4 FY2026", "verified", "USD 35,400,000,000.00"],
      ["Gross margin (gross profit / revenue)", "Q4 FY2026", "verified", "74.40%"],
      ["Operating margin (operating income / revenue)", "Q4 FY2026", "verified", "64.90%"],
      ["Net margin (net income / revenue)", "Q4 FY2026", "verified", "57.00%"],
      ["Quarter-over-quarter percent change in Revenue", "Q2 FY2025 vs Q1 FY2025", "verified", "15.34%"],
      ["Quarter-over-quarter percent change in Revenue", "Q3 FY2025 vs Q2 FY2025", "verified", "16.78%"],
      ["Quarter-over-quarter percent change in Revenue", "Q4 FY2025 vs Q3 FY2025", "verified", "12.11%"],
      ["Quarter-over-quarter percent change in Revenue", "Q1 FY2026 vs Q4 FY2025", "verified", "12.03%"],
      ["Quarter-over-quarter percent change in Revenue", "Q2 FY2026 vs Q1 FY2026", "verified", "6.08%"],
      ["Quarter-over-quarter percent change in Revenue", "Q3 FY2026 vs Q2 FY2026", "verified", "21.96%"],
      ["Quarter-over-quarter percent change in Revenue", "Q4 FY2026 vs Q3 FY2026", "verified", "8.94%"],
      ["Year-over-year percent change in Revenue", "Q4 FY2026 vs Q4 FY2025", "verified", "57.89%"],
      ["Revenue ranked across periods", "Q1 FY2025 to Q4 FY2026", "verified", "Q4 FY2026 has the highest revenue of the 8 quarters ranked"],
      ["Revenue ranked across periods", "Q1 FY2025 to Q4 FY2026", "verified", "Q1 FY2025 has the lowest revenue of the 8 quarters ranked"],
    ]);
    // The engine computes its figures and mints no derived fact, as the legacy chart did.
    const { rows } = await client.query(`select 1 from facts where method = 'derived' and subject_id = $1::uuid`, [NVDA.issuer_id]);
    assert.deepEqual(rows, []);
  });

  // Each turn's answer as streamed, for the reload check after turn 3.
  const turns: Array<{ question: string; streamedIds: unknown[]; answer: ChatMessage; completed: ParsedSseEvent }> = [];
  if (assistant) turns.push({ question: "Analyze NVDA", streamedIds: streamedBlockIds(events), answer: assistant, completed: completedTurn(events) });

  // #398 D2: market data stays outside the engine until #444's price
  // observations, so the YTD chart is the analyst's, labelled not verified,
  // and the analyst shows no figure of its own.
  await t.test("follow-up 'Compare it with AMD YTD' charts both companies over the year to date, as market data not verified (#398 D2)", async () => {
    const turnEvents = await runTurn(base, thread.thread_id, "Compare it with AMD YTD");
    const completed = completedTurn(turnEvents);
    // NVDA is carried from the engine's answer, which names the company, not a listing.
    assert.deepEqual(completed.data.subject_refs, CARRIED_NVDA_WITH_AMD, "'it' should carry NVDA forward and add AMD");

    const answer = await latestAssistantMessage(base, thread.thread_id);
    turns.push({ question: "Compare it with AMD YTD", streamedIds: streamedBlockIds(turnEvents), answer, completed });
    assert.deepEqual(answer.blocks.map((block) => block.kind), ["rich_text", "perf_comparison", "disclosure"]);
    // The narrative's every figure is a return read off the chart's sealed lines.
    const performance = answer.blocks.find((block) => block.kind === "perf_comparison")!;
    const seriesRefs = (performance.data_ref as { params: { series_refs: string[] } }).params.series_refs;
    const narrative = answer.blocks[0]!;
    assert.equal(narrativeText(narrative), "Of NVDA and AMD, NVDA's price return was highest: NVDA 5.81%, AMD 3.17% (YTD 2026: Dec 2025 close to Aug 2026 close).");
    assert.deepEqual(refsOf(narrative), [["series", seriesRefs[0], "5.81%"], ["series", seriesRefs[1], "3.17%"]]);
    // On reload, each block carries the server's own claims (#193): the chart
    // is source-linked, its drawn points recomputed from its sealed bars by the
    // seal (#236), but it is no verified calculation nor proven public by the
    // cutoff. Neither is the narrative.
    assert.deepEqual(answer.block_proofs?.[String(performance.id)], { evidence: "linked", calculation: "not_verified", public_by_cutoff: "unknown" });
    assert.equal((answer.block_proofs?.[String(narrative.id)] as { calculation?: string } | undefined)?.calculation, "not_verified");

    // Price performance, drawn only from series the snapshot sealed (#133).
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
    assert.equal(seriesRefs.length, 2);
    for (const ref of seriesRefs) assert.ok(sealed.has(ref), `series ${ref} is not sealed in the snapshot`);
    // The chart is dated by its stored prices, not the answer time.
    const oldest = (rows[0]?.series_specs ?? []).map((spec) => spec.as_of).sort()[0];
    assert.equal(performance.as_of, oldest);
  });

  await t.test("'Explain the differences and show the evidence' keeps both companies, the chart's returns and the cause management filed, quoted with its document", async () => {
    const turnEvents = await runTurn(base, thread.thread_id, "Explain the differences and show the evidence");
    const completed = completedTurn(turnEvents);
    assert.deepEqual(completed.data.subject_refs, CARRIED_NVDA_WITH_AMD);

    const answer = await latestAssistantMessage(base, thread.thread_id);
    turns.push({ question: "Explain the differences and show the evidence", streamedIds: streamedBlockIds(turnEvents), answer, completed });
    // The answer is rendered from the recorded reply's assertions: not the placeholder, nor the fallback.
    const narrative = answer.blocks[0]!;
    assert.equal(narrativeText(narrative), [
      "Of NVDA and AMD, NVDA's price return was highest: NVDA 5.81%, AMD 3.17% (YTD 2026: Dec 2025 close to Aug 2026 close).",
      `According to a source dated Aug 2025, effective Jun 2025 on AMD: ${AMD_Q2_2025_RELEASE.text}`,
    ].join("\n\n"));
    // The claim's figure is the claim's own words, sealed with the turn and inspected to its filed release.
    const [claim] = refsOf(narrative).filter(([kind]) => kind === "claim");
    const { rows } = await client.query<{ claim_refs: string[] }>(`select claim_refs from snapshots where snapshot_id = $1::uuid`, [answer.snapshot_id]);
    assert.deepEqual(rows[0]?.claim_refs, [claim![1]]);
    const inspection = await loadEvidenceInspection(client, { user_id: USER_ID, snapshot_id: answer.snapshot_id, ref: { kind: "claim", id: claim![1]! } });
    assert.deepEqual(inspection.related_refs.find((ref) => ref.kind === "document")?.label, AMD_Q2_2025_RELEASE.title);
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
    // Turn 1's engine answer named its figures as the scope's metrics (#381), which carry over too.
    assert.deepEqual(explained?.inherited, ["metrics", "price_window"]);
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
    assert.deepEqual(again?.inherited, ["metrics", "price_window"]);
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
    assert.equal(completedTurn(turnEvents).data.bundle_id, "financial_answer");

    // AMD shares NVDA's industry; AAPL does not. Each company is shown at its own latest quarter, the peer by its legal name.
    const answer = await latestAssistantMessage(base, peersThread.thread_id);
    const companies = (answer.blocks[0]!.financial as { labels: Record<string, { kind: string; text: string }> }).labels;
    assert.deepEqual(Object.values(companies).filter((label) => label.kind === "subject").map((label) => label.text), ["NVIDIA Corporation", "Advanced Micro Devices, Inc."]);
    assert.deepEqual(engineAnswer(answer).results.filter(([measure]) => measure.startsWith("Gross margin") || measure === "Revenue"), [
      ["Revenue", "Q4 FY2026", "verified", "USD 62,100,000,000.00"],
      ["Gross margin (gross profit / revenue)", "Q4 FY2026", "verified", "74.40%"],
      ["Revenue", "Q2 FY2026", "verified", "USD 11,200,000,000.00"],
      ["Gross margin (gross profit / revenue)", "Q2 FY2026", "verified", "54.02%"],
    ]);
    assert.deepEqual(engineAnswer(answer).notes, [
      "Of NVDA and Advanced Micro Devices, Inc., NVDA's gross margin (gross profit / revenue) was highest: NVDA 74.40% (Q4 FY2026), Advanced Micro Devices, Inc. 54.02% (Q2 FY2026).\n\n" +
        "NVDA's revenue was USD 62,100,000,000.00 in Q4 FY2026; Advanced Micro Devices, Inc.'s revenue was USD 11,200,000,000.00 in Q2 FY2026.",
    ]);
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
      notes: ["Not covered by this answer: a margin over several periods; the cause of these figures."],
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

  await t.test("each starter question names a company: its figures are the engine's, and a year-to-date price chart stays the analyst's (#398)", async () => {
    const bundles: string[] = [];
    for (const question of STARTER_QUESTIONS) {
      const thread = await api<{ thread_id: string }>(base, "POST", "/v1/chat/threads", { title: "Starter" });
      bundles.push(String(completedTurn(await runTurn(base, thread.thread_id, question)).data.bundle_id));
    }
    assert.deepEqual(bundles, ["financial_answer", "single_subject_analysis", "financial_answer"]);
    const starterThread = await api<{ thread_id: string }>(base, "POST", "/v1/chat/threads", { title: "Starter" });
    completedTurn(await runTurn(base, starterThread.thread_id, "What drives AAPL's margins?"));
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

  await t.test("'Compare NVDA with AMD' without a period compares each company's latest quarter, with no YTD window", async () => {
    const defaultThread = await api<{ thread_id: string }>(base, "POST", "/v1/chat/threads", { title: "Default window" });
    const turnEvents = await runTurn(base, defaultThread.thread_id, "Compare NVDA with AMD");
    assert.equal(completedTurn(turnEvents).data.bundle_id, "financial_answer");
    const answer = await latestAssistantMessage(base, defaultThread.thread_id);
    // Each company at its own latest quarter (#398 D4), with no price chart: price history is not an engine figure.
    assert.deepEqual(engineAnswer(answer).results.filter(([measure]) => measure === "Revenue" || measure.startsWith("Year-over-year")), [
      ["Revenue", "Q4 FY2026", "verified", "USD 62,100,000,000.00"],
      ["Year-over-year percent change in Revenue", "Q4 FY2026 vs Q4 FY2025", "verified", "57.89%"],
      ["Revenue", "Q2 FY2026", "verified", "USD 11,200,000,000.00"],
      ["Year-over-year percent change in Revenue", "Q2 FY2026 vs Q2 FY2025", "verified", "45.74%"],
    ]);
    assert.deepEqual(answer.blocks.map((block) => block.kind), ["financial_answer", "rich_text"]);
    const { rows } = await client.query<{ series_specs: unknown[] | null }>(`select series_specs from snapshots where snapshot_id = $1::uuid`, [answer.snapshot_id]);
    assert.deepEqual(rows[0]?.series_specs ?? [], [], "no price series is sealed, so no YTD window either");
    const { rows: scopes } = await client.query<{ research_scope: { price_window: unknown } }>(`select research_scope from chat_messages where message_id = $1::uuid`, [answer.message_id]);
    assert.equal(scopes[0]?.research_scope.price_window, null);
  });

  // #398 step 7: a follow-up that changes only the period is the engine's, at
  // that period, with no model planning it.
  await t.test("a follow-up naming only another period is the engine's overview there: 'What about Q2?' at NVDA's newest second quarter, 'And fiscal 2025?' at that year's newest quarter (#398)", async () => {
    const periodThread = await api<{ thread_id: string }>(base, "POST", "/v1/chat/threads", { title: "Periods" });
    const shown = async (question: string) => {
      assert.equal(completedTurn(await runTurn(base, periodThread.thread_id, question)).data.bundle_id, "financial_answer", question);
      const answer = await latestAssistantMessage(base, periodThread.thread_id);
      const { rows } = await client.query<{ research_scope: { fiscal_year: number | null; fiscal_quarter: unknown; latest_period?: string } }>(`select research_scope from chat_messages where message_id = $1::uuid`, [answer.message_id]);
      const { results } = engineAnswer(answer);
      const notes = answerText({ ...answer, blocks: answer.blocks.filter((block) => block.analyst_commentary !== true) });
      return {
        first: results[0],
        margin: results.find(([measure]) => measure.startsWith("Gross margin")),
        yoy: results.find(([measure]) => measure.startsWith("Year-over-year")),
        period: [rows[0]?.research_scope.fiscal_year, rows[0]?.research_scope.fiscal_quarter, rows[0]?.research_scope.latest_period],
        notes,
      };
    };
    assert.deepEqual(await shown("How is NVDA doing?"), {
      first: ["Revenue", "Q1 FY2025", "verified", "USD 26,044,000,000.00"],
      margin: ["Gross margin (gross profit / revenue)", "Q4 FY2026", "verified", "74.40%"],
      yoy: ["Year-over-year percent change in Revenue", "Q4 FY2026 vs Q4 FY2025", "verified", "57.89%"],
      period: [null, null, "quarter"],
      notes: [],
    });
    // NVDA's newest second quarter is Q2 FY2026; the quarters before its first on file are gaps where they fall.
    assert.deepEqual(await shown("What about Q2?"), {
      first: ["Revenue", "Q3 FY2024", "missing", "No eligible input was public before the knowledge cutoff."],
      margin: ["Gross margin (gross profit / revenue)", "Q2 FY2026", "verified", "72.42%"],
      yoy: ["Year-over-year percent change in Revenue", "Q2 FY2026 vs Q2 FY2025", "verified", "55.60%"],
      period: [null, { fiscal_year: null, fiscal_period: "Q2" }, "quarter"],
      notes: ["NVDA is carried from the previous answer."],
    });
    assert.deepEqual(await shown("And fiscal 2025?"), {
      first: ["Revenue", "Q1 FY2024", "missing", "No eligible input was public before the knowledge cutoff."],
      margin: ["Gross margin (gross profit / revenue)", "Q4 FY2025", "verified", "73.03%"],
      yoy: ["Year-over-year percent change in Revenue", "Q4 FY2025 vs Q4 FY2024", "blocked_dependency", "A required input or calculation is unavailable."],
      period: [2025, null, "quarter"],
      notes: ["NVDA is carried from the previous answer. Fiscal 2025 is shown by quarter, to the newest quarter reported in it."],
    });
    // No model planned them: there is no recorded planner reply for these questions.
    const { rows } = await client.query<{ kind: string }>(`select plan->'planner'->>'kind' as kind from financial_plans where origin_ref like $1`, [`chat:${periodThread.thread_id}:%`]);
    assert.deepEqual(rows.map((row) => row.kind), ["deterministic", "deterministic", "deterministic"]);

    const addedThread = await api<{ thread_id: string }>(base, "POST", "/v1/chat/threads", { title: "A quarter, then a company" });
    for (const question of ["How is NVDA doing?", "What about Q2?", "Add AMD"]) completedTurn(await runTurn(base, addedThread.thread_id, question));
    const added = engineAnswer(await latestAssistantMessage(base, addedThread.thread_id)).results;
    assert.deepEqual(added.filter(([measure]) => measure.startsWith("Gross margin")), [
      ["Gross margin (gross profit / revenue)", "Q2 FY2026", "verified", "72.42%"],
      ["Gross margin (gross profit / revenue)", "Q2 FY2026", "verified", "54.02%"],
    ], "each company at its newest second quarter");
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
    // An explanation with no period or company of its own stays the analyst's.
    assert.equal(completedTurn(await runTurn(base, peersThread.thread_id, "Explain it")).data.bundle_id, "single_subject_analysis");
    // AMD's industry peer is auto-selected, so it carries no label.
    assert.deepEqual(await scope(), { companies: [amd, { issuer_id: NVDA.issuer_id }], peers: true });
    completedTurn(await runTurn(base, peersThread.thread_id, "Drop the peers"));
    assert.deepEqual(await scope(), { companies: [amd], peers: false });
  });

  // The root's condition for #398: a number reaches an analyst answer only in
  // a claim segment citing its source document, through the judge-gated path;
  // never in the analyst's own words.
  await t.test("an analyst answer on guidance quotes a claim's figure with its document; a figure in its own words is rejected, an amount in words is hidden, and its prose is never shown (#398)", async () => {
    const guidanceThread = await api<{ thread_id: string }>(base, "POST", "/v1/chat/threads", { title: "AMD guidance" });
    // The judge reads this turn's inferences, as a deployment with one does.
    process.env.JUDGE_LITELLM_MODEL = GOLDEN_ENV.LITELLM_MODEL;
    const completed = await runTurn(base, guidanceThread.thread_id, "What guidance did AMD give?").then(completedTurn).finally(() => {
      delete process.env.JUDGE_LITELLM_MODEL;
    });
    assert.notEqual(completed.data.bundle_id, "financial_answer", "guidance is the analyst's");
    const answer = await latestAssistantMessage(base, guidanceThread.thread_id);
    assert.deepEqual(answer.blocks.map((block) => block.kind), ["rich_text"]);
    const [narrative] = answer.blocks;
    // The figure is the claim's, inside its claim segment; the words around it are the template's.
    assert.equal(narrativeText(narrative!), `According to a source dated Aug 2025, effective Jun 2025 on AMD: ${AMD_Q2_2025_RELEASE.text}\n\nNo figures are shown for AMD.`);
    const [claim, ...others] = refsOf(narrative!);
    assert.deepEqual([claim![0], claim![2], others], ["claim", AMD_Q2_2025_RELEASE.text, []]);
    const words = (narrative!.segments as Array<{ type: string; text?: string }>).filter((segment) => segment.type === "text").map((segment) => segment.text).join("");
    assert.doesNotMatch(words, /\$|%|million|billion/);
    // An inference writing the claim's figure in its own words is rejected, in digits by the checks and in words by the judge; the prose before the list is never shown.
    assert.deepEqual((completed.data.assertion_report as { rejected: unknown[] }).rejected, [
      { index: 1, text: "The $800 million charge, not demand, held the quarter back.", check: "binding", reason: "an inference rests on its supports; it writes no figure" },
      { index: 2, text: "The eight-hundred-million-dollar charge, not demand, held the quarter back.", check: "judge", reason: "entailed, worded_amount: It states the charge in words." },
    ], "an amount in words is hidden, whatever the judge's verdict");
    assert.doesNotMatch(JSON.stringify(answer.blocks), /8\.7 billion|eight-hundred-million/);
    // The claim cites its document: the release it was filed in.
    const inspection = await loadEvidenceInspection(client, { user_id: USER_ID, snapshot_id: answer.snapshot_id, ref: { kind: "claim", id: claim![1] } });
    assert.equal(inspection.related_refs.find((ref) => ref.kind === "document")?.label, AMD_Q2_2025_RELEASE.title);
    assert.ok((narrative!.source_refs as string[]).length > 0, "the narrative names the claim's source");
    const { rows: [sealed] } = await client.query<{ claim_refs: string[]; document_refs: string[]; fact_refs: string[] }>(
      `select claim_refs, document_refs, fact_refs from snapshots where snapshot_id = $1::uuid`, [answer.snapshot_id]);
    assert.deepEqual([sealed!.claim_refs, sealed!.document_refs.length, sealed!.fact_refs], [[claim![1]], 1, []], "the snapshot seals only what the answer quotes");
  });

  await t.test("no turn, on the engine's path or the analyst's, follow-ups included, shows a legacy figure block (#398)", async () => {
    const { rows } = await client.query<{ kind: string }>(
      `select distinct block->>'kind' as kind from chat_messages m, jsonb_array_elements(m.blocks) block where m.role = 'assistant' order by 1`,
    );
    // The engine's answers and notes, and the analyst's narratives with their D2 chart and its disclosure.
    assert.deepEqual(rows.map((row) => row.kind), ["disclosure", "financial_answer", "perf_comparison", "rich_text"]);
    const { rows: [answered] } = await client.query<{ engine: number; analyst: number }>(
      `select count(*) filter (where blocks->0->>'kind' = 'financial_answer')::int as engine,
              count(*) filter (where blocks->0->>'kind' = 'rich_text')::int as analyst
         from chat_messages where role = 'assistant'`,
    );
    assert.ok(answered!.engine > 10 && answered!.analyst > 10, JSON.stringify(answered));
  });

  function completedTurn(turnEvents: ParsedSseEvent[]): ParsedSseEvent {
    const error = turnEvents.find((event) => event.event === "turn.error");
    assert.equal(error, undefined, `turn.error: ${JSON.stringify(error?.data)}`);
    const completed = turnEvents.find((event) => event.event === "turn.completed");
    assert.ok(completed, `no turn.completed; events: ${turnEvents.map((event) => event.event).join(", ")}`);
    return completed;
  }
});

async function latestAssistantMessage(base: string, threadId: string): Promise<ChatMessage> {
  const { messages } = await api<{ messages: ChatMessage[] }>(base, "GET", `/v1/chat/threads/${threadId}/messages`);
  const answer = messages.filter((message) => message.role === "assistant").at(-1);
  assert.ok(answer, "no assistant message in the thread");
  return answer;
}

// A rich text block as the reader sees it, each ref its displayed value.
function narrativeText(block: Block): string {
  return (block.segments as Array<{ text?: string; format?: string }>).map((segment) => segment.text ?? segment.format ?? "").join("");
}

function refsOf(block: Block): Array<[kind: string, id: string, shown: string]> {
  return (block.segments as Array<{ type: string; ref_kind?: string; ref_id?: string; format?: string }>)
    .filter((segment) => segment.type === "ref").map((segment) => [segment.ref_kind!, segment.ref_id!, segment.format!]);
}

function streamedBlockIds(events: ParsedSseEvent[]): unknown[] {
  return events.filter((event) => event.event === "block.completed").map((event) => event.data.block_id);
}

// A segment request's gap, worded from the planner's closed reason (#425).
const UNSUPPORTED = "This request asks for a calculation outside the verified financial definitions I can compute: revenue or results by business segment.";

function answerText(message: ChatMessage): string[] {
  return message.blocks.filter((block) => block.kind === "rich_text")
    .map((block) => (block.segments as Array<{ text?: string; format?: string }>).map((segment) => segment.text ?? segment.format ?? "").join(""));
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

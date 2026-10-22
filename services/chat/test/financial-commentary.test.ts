// A company overview's analyst commentary (#398 step 4): written after the
// engine answer is committed and shown, from its published results alone,
// and saved beside it in the same message. The lane takes only a question
// with a metric word until routing changes (#398 step 6), so each overview
// here asks one and scripts how its question is read.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Pool } from "pg";

import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import { presentationHash, type FinancialAnswerContent } from "../../financial-core/src/index.ts";
import { IDS, seedReportedFact } from "../../financial-engine/test/db-fixtures.ts";
import { LlmProviderError, LlmRouterError, type LlmChatRequest } from "../../llm/src/index.ts";
import { answerTurn, type AnswerTraceInput } from "../src/answer-trace.ts";
import type { ChatAnalystToolRuntime } from "../src/coordinator.ts";
import { COMMENTARY_UNAVAILABLE, type CommentaryComposer } from "../src/engine-commentary.ts";
import { listChatMessagesForThread, readChatMessage } from "../src/messages.ts";
import { resultRefProblem } from "../src/prose-refs.ts";
import { plainText } from "../src/render-assertions.ts";
import { resolveResearchScope, type ScopeProposal } from "../src/research-scope.ts";
import type { ChatSubjectPreResolution } from "../src/subjects.ts";
import { loadPriorScope, loadPriorSubjects, loadRecentConversation } from "../src/thread-context.ts";
import { chatDatabase, chatHarness, completed, METRIC_READING, NO_ASKS, revenueModel } from "./financial-fixtures.ts";

const ALFA = "4f000000-0000-4000-8000-0000000000f1";
const BRVO = "4f000000-0000-4000-8000-0000000000f2";
const REVENUE = [[2022, 1, 800], [2022, 2, 900], [2022, 3, 1000], [2022, 4, 1100], [2023, 1, 1200], [2023, 2, 1300], [2023, 3, 1500], [2023, 4, 2000]] as const;

const ENV = { LLM_CHANNELS: "fixture", LLM_FIXTURE_PROTOCOL: "openai", LLM_FIXTURE_MODELS: "recorded,judge", LITELLM_MODEL: "fixture/recorded" };
const JUDGED = { ...ENV, JUDGE_LITELLM_MODEL: "fixture/judge" };

const assertions = (list: unknown[]) => `ALFA turns most of its revenue into profit.\n\`\`\`assertions\n${JSON.stringify(list)}\n\`\`\``;
// ALFA's overview: F1..F8 its revenue, oldest first, then its latest
// quarter's lines (F9..F11), margins (F12..F14) and growth (F15, F16).
const ALFA_REPLY = assertions([
  { kind: "observation", text: "Margins.", evidence: ["F12", "F13", "F14"] },
  { kind: "comparison", text: "Revenue rose.", evidence: ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8"], op: "trend", result: "rose_throughout" },
  { kind: "analyst_inference", text: "It keeps most of what it sells.", supports: [0] },
]);
const ALFA_TEXT = [
  "ALFA's gross margin (gross profit / revenue) was 60.00%, operating margin (operating income / revenue) 25.00% and net margin (net income / revenue) 20.00% in Q4 FY2023.",
  "ALFA's revenue rose in every period from Q1 FY2022 (USD 800.00) to Q4 FY2023 (USD 2,000.00).",
].join("\n\n");
const JUDGE = "You check the analyst inferences";

function composer(answer: (request: LlmChatRequest) => string | Promise<string>, judge?: string, env: Record<string, string> = judge ? JUDGED : ENV) {
  const inputs: AnswerTraceInput[] = [];
  const compose: CommentaryComposer = (input, turn) => {
    inputs.push(input);
    return answerTurn(input, turn, {
      env,
      createClient: () => async (_deployment, request) => ({ text: request.messages[0]!.content.startsWith(JUDGE) ? judge! : await answer(request) }),
    });
  };
  return { compose, inputs };
}

function resolve(mention: string): Promise<ChatSubjectPreResolution> {
  const id = { ALFA, BRVO }[mention];
  return Promise.resolve((id
    ? { status: "resolved", subject_ref: { kind: "issuer", id }, display_label: `${mention} Corp`, handoff: { display_labels: { ticker: mention } } }
    : { status: "not_found", input_text: mention, normalized_input: mention, message: "not found" }) as unknown as ChatSubjectPreResolution);
}

type Block = Record<string, unknown> & { id: string; kind: string };
const reading = (proposal: ScopeProposal) => async () => proposal;
const segmentsOf = (block: Record<string, unknown> | undefined) => (block?.segments ?? []) as Parameters<typeof plainText>[0];

test("a company overview carries analyst commentary on its published results (#398)", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for chat financial coverage");
    return;
  }
  const { db, pool, threadId } = await chatDatabase(t, "chat-commentary");
  const base = { threadId, userId: IDS.owner };
  const quarterly = async (subject: string, metric_key: string, fiscal_year: number, quarter: number, value: number) => {
    const factId = await seedReportedFact(db, { metric_key, value: String(value), fiscal_year, subject });
    const start = `${fiscal_year}-${String(3 * quarter - 2).padStart(2, "0")}-01`;
    await db.query(
      `update facts set period_kind = 'fiscal_q', fiscal_period = $2, period_start = $3::date, period_end = ($3::date + interval '3 months' - interval '1 day')::date where fact_id = $1::uuid`,
      [factId, `Q${quarter}`, start],
    );
  };
  for (const [issuer, scale, lines] of [[ALFA, 1, [1200, 500, 400]], [BRVO, 2, [1800, 600, 400]]] as const) {
    await db.query(`insert into issuers (issuer_id, legal_name) values ($1, $2)`, [issuer, issuer === ALFA ? "Alfa Corp" : "Bravo Corp"]);
    for (const [year, quarter, revenue] of REVENUE) await quarterly(issuer, "revenue", year, quarter, revenue * scale);
    for (const [index, metric] of ["gross_profit", "operating_income", "net_income"].entries()) await quarterly(issuer, metric, 2023, 4, lines[index]!);
  }
  const message = async (messageId: unknown) => {
    const read = await readChatMessage(db, { thread_id: threadId, message_id: String(messageId) });
    assert.ok(read, "a saved answer");
    return { ...read, blocks: read.blocks as Block[] };
  };
  const researchScope = async (context: { userIntent?: string }, read: Promise<ScopeProposal | null>) =>
    resolveResearchScope({ question: context.userIntent ?? "", companies: [{ issuer_id: ALFA, label: "ALFA" }], prior: null, asOf: "2026-10-22T00:00:00.000Z", served: true, proposal: await read });
  const overview = (compose: CommentaryComposer, extra: Partial<Parameters<typeof chatHarness>[1]> = {}) =>
    chatHarness(pool, { model: null, readQuestion: reading(NO_ASKS), resolveMention: resolve, commentary: compose, ...extra });
  const hydrate = async (_db: unknown, ref: { kind: string; id: string }) =>
    ({ subject_ref: ref, display_label: ref.id, display_labels: {}, context: {}, normalized_input: ref.id, identity_level: "issuer", resolution_path: "test", confidence: 1 }) as never;
  const prior = async () => ({ subjects: await loadPriorSubjects(db, { threadId }, hydrate), scope: await loadPriorScope(db, { threadId }) });

  await t.test("the answer is committed and shown first, then its commentary is saved beside it, citing only its verified results", async () => {
    let before: Awaited<ReturnType<typeof prior>> | undefined;
    const { compose, inputs } = composer(async () => {
      before = await prior();
      return ALFA_REPLY;
    });
    const { events } = await overview(compose, { researchScope }).run({ ...base, userIntent: "Revenue for ALFA" });
    const done = completed(events);
    const saved = await message(done.message_id);
    const [answer, commentary] = saved.blocks;

    assert.deepEqual(saved.blocks.map((block) => block.kind), ["financial_answer", "rich_text"], "no legacy fact block, and no note");
    assert.deepEqual(events.map((event) => event.type), ["turn.started", "snapshot.sealed", "answer.shown", "block.began", "block.completed", "block.began", "block.completed", "turn.completed"]);
    const shown = events.find((event) => event.type === "answer.shown")!;
    assert.deepEqual((shown.blocks as Block[]).map((block) => block.id), [answer!.id], "the numbers are shown before the commentary is written");
    assert.deepEqual((shown.block_proofs as Record<string, unknown>)[answer!.id], { evidence: "linked", calculation: "verified", public_by_cutoff: "proven" });
    assert.deepEqual((done.message as { blocks: Block[] }).blocks.map((block) => block.id), [answer!.id, `commentary-${done.message_id}`]);

    assert.deepEqual({ ...commentary, segments: undefined }, {
      id: `commentary-${done.message_id}`,
      kind: "rich_text",
      snapshot_id: saved.snapshot_id,
      data_ref: { kind: "rich_text", id: `commentary-${done.message_id}` },
      source_refs: [],
      as_of: answer!.as_of,
      analyst_commentary: true,
      segments: undefined,
    });
    assert.equal(plainText(segmentsOf(commentary)), ALFA_TEXT, "no judge is configured, so the inference stays hidden");
    const { results, labels } = answer!.financial as FinancialAnswerContent;
    const refs = segmentsOf(commentary).filter((segment) => segment.type === "ref");
    assert.deepEqual(refs, ["out_gross_margin", "out_operating_margin", "out_net_margin", "out_revenue_fy2022_q1", "out_revenue_fy2023_q4"].map((output) => {
      const result = results.find((entry) => entry.output_id === output)!;
      return { type: "ref", ref_kind: "result", ref_id: result.result_id, format: result.presented.text, period: labels[result.period_label_id]!.text };
    }));
    assert.equal(resultRefProblem(commentary!, answer as never), null);

    const [input] = inputs;
    assert.deepEqual([input!.toolCalls, input!.factBlocks, input!.packet!.route, input!.packet!.figures.length], [[], undefined, "financial_engine", 16]);

    // The seal still verifies the answer: its proof, its stored hash, and its certificate's.
    assert.deepEqual(saved.block_proofs[answer!.id], { evidence: "linked", calculation: "verified", public_by_cutoff: "proven" });
    assert.deepEqual(saved.block_proofs[commentary!.id], { evidence: "unknown", calculation: "not_verified", public_by_cutoff: "unknown" });
    const { rows: [certificate] } = await db.query(
      `select presentation_hash, certificate->'presentation'->>'hash' as certified from snapshot_financial_runs where snapshot_id = $1::uuid`,
      [saved.snapshot_id],
    );
    assert.equal(answer!.presentation_hash, presentationHash(answer!.financial as FinancialAnswerContent));
    assert.deepEqual([certificate.presentation_hash, certificate.certified], [answer!.presentation_hash, answer!.presentation_hash]);

    // The append moves no pointer: the thread, the companies and the scope a follow-up reads are as they were.
    const { rows: [thread] } = await db.query(`select latest_snapshot_id::text as latest from chat_threads where thread_id = $1`, [threadId]);
    assert.equal(thread.latest, saved.snapshot_id);
    assert.ok(before?.scope, "the answer saved its scope");
    assert.deepEqual(await prior(), before);
    // The next turn's conversation reads the commentary's words, each ref an
    // empty run (as a fact ref is on the analyst path).
    assert.deepEqual(await loadRecentConversation(db, { threadId, limit: 6 }), [{
      role: "assistant",
      text: "ALFA's gross margin (gross profit / revenue) was   , operating margin (operating income / revenue)    and net margin (net income / revenue)    in Q4 FY2023 . \n\n ALFA's revenue  rose in every period from Q1 FY2022 (  ) to Q4 FY2023 (  ).",
    }]);
    // A client that left before the commentary reads it on reload.
    const reloaded = await listChatMessagesForThread(db, { thread_id: threadId, user_id: IDS.owner });
    assert.deepEqual(reloaded!.messages.find((entry) => entry.message_id === done.message_id)!.blocks, saved.blocks);
  });

  await t.test("a comparison's commentary names each company by the ticker its turn gave it", async () => {
    const { compose } = composer(() => assertions([
      { kind: "comparison", text: "x", evidence: ["F5", "F14"], op: "highest", result: "F5" },
    ]));
    const done = completed((await overview(compose).run({ ...base, userIntent: "Compare revenue for ALFA and BRVO" })).events);
    const [, commentary] = (await message(done.message_id)).blocks;
    assert.equal(
      plainText(segmentsOf(commentary)),
      "Of ALFA and BRVO, ALFA's gross margin (gross profit / revenue) was highest: ALFA 60.00%, BRVO 45.00% (Q4 FY2023).",
    );
  });

  await t.test("an inference the judge rejects never shows; the figures it rested on still do", async () => {
    const { compose } = composer(() => ALFA_REPLY, '{"verdicts":[{"id":2,"verdict":"not_entailed","reason":"unsupported: no support says what it keeps."}]}');
    const done = completed((await overview(compose).run({ ...base, userIntent: "Revenue for ALFA" })).events);
    const [, commentary] = (await message(done.message_id)).blocks;
    assert.equal(plainText(segmentsOf(commentary)), ALFA_TEXT);
    const entailed = composer(() => ALFA_REPLY, '{"verdicts":[{"id":2,"verdict":"entailed"}]}');
    const shown = completed((await overview(entailed.compose).run({ ...base, userIntent: "Revenue for ALFA" })).events);
    assert.equal(plainText(segmentsOf((await message(shown.message_id)).blocks[1])), `${ALFA_TEXT}\n\n> **Analyst inference:** It keeps most of what it sells.`);
  });

  await t.test("commentary that fails leaves the answer as published and says it is unavailable", async (st) => {
    const warned: unknown[][] = [];
    st.mock.method(console, "warn", (...args: unknown[]) => warned.push(args));
    const failures: Record<string, CommentaryComposer> = {
      "the model call fails": composer(() => Promise.reject(new LlmProviderError("provider_failed", "provider down")), undefined, ENV).compose,
      "the router fails": () => Promise.reject(new LlmRouterError("all_deployments_failed", "all LLM deployments failed", [])),
      "the assertion list is malformed": composer(() => "No list.\n```assertions\n{not json\n```").compose,
      "nothing is accepted": composer(() => assertions([{ kind: "observation", text: "x", evidence: ["F99"] }])).compose,
      "a ref is not the answer's": async (input, turn) => {
        const answer = await composer(() => ALFA_REPLY).compose(input, turn);
        const [prose] = answer.blocks;
        const segments = segmentsOf(prose).map((segment) => segment.type === "ref" ? { ...segment, format: "60%" } : segment);
        return { ...answer, blocks: [{ ...prose, segments }] };
      },
    };
    for (const [failure, compose] of Object.entries(failures)) {
      warned.length = 0;
      const done = completed((await overview(compose).run({ ...base, userIntent: "Revenue for ALFA" })).events);
      const saved = await message(done.message_id);
      const [answer, note] = saved.blocks;
      assert.deepEqual(saved.blocks.map((block) => block.kind), ["financial_answer", "rich_text"], failure);
      assert.deepEqual([note!.id, note!.analyst_commentary, note!.segments], [`commentary-${done.message_id}`, true, [{ type: "text", text: COMMENTARY_UNAVAILABLE }]], failure);
      assert.deepEqual(saved.block_proofs[answer!.id]!.calculation, "verified", failure);
      assert.ok(warned.some((args) => String(args[0]).startsWith("[chat] analyst commentary unavailable")), `${failure}: logged ${JSON.stringify(warned)}`);
    }
  });

  await t.test("an answer changed while its commentary was written is left as it is now, and the loss is logged", async (st) => {
    const warned: unknown[][] = [];
    st.mock.method(console, "warn", (...args: unknown[]) => warned.push(args));
    const other = { id: "other", kind: "rich_text", snapshot_id: randomUUID(), data_ref: { kind: "rich_text", id: "other" }, source_refs: [], as_of: "2026-10-22T00:00:00.000Z", segments: [{ type: "text", text: "Another writer's block." }] };
    const { compose } = composer(async () => {
      await db.query(
        `update chat_messages set blocks = blocks || $2::jsonb
          where message_id = (select message_id from chat_messages where thread_id = $1 and role = 'assistant' order by created_at desc limit 1)`,
        [threadId, JSON.stringify([other])],
      );
      return ALFA_REPLY;
    });
    const done = completed((await overview(compose).run({ ...base, userIntent: "Revenue for ALFA" })).events);
    const saved = await message(done.message_id);
    assert.deepEqual(saved.blocks.map((block) => block.id).slice(1), ["other"]);
    assert.deepEqual((done.message as { blocks: Block[] }).blocks.map((block) => block.id).slice(1), ["other"], "the turn completes with the message as saved");
    assert.ok(warned.some((args) => String(args[0]).includes("was not saved: the message changed")), JSON.stringify(warned));
  });

  await t.test("a defect or a database error after the commit is logged, and the turn completes with the answer as saved", async (st) => {
    const logged: unknown[][] = [];
    st.mock.method(console, "error", (...args: unknown[]) => logged.push(args));
    const appendFails = (error: Error) => ({
      query: (text: string, values?: unknown[]) => text.trimStart().startsWith("update chat_messages set blocks") ? Promise.reject(error) : pool.query(text, values),
      connect: () => pool.connect(),
    }) as unknown as Pool;
    const defect = new TypeError("Cannot read properties of undefined (reading 'blocks')");
    const deadlock = Object.assign(new Error("deadlock detected"), { code: "40P01" });
    const terminated = new Error("Connection terminated unexpectedly");
    const cases: Array<[string, Error, ReturnType<typeof overview>]> = [
      ["the composer throws a TypeError", defect, overview(() => Promise.reject(defect))],
      ...[deadlock, terminated].map((error): [string, Error, ReturnType<typeof overview>] => [
        `the append fails: ${error.message}`,
        error,
        chatHarness(appendFails(error), { model: null, readQuestion: reading(NO_ASKS), resolveMention: resolve, commentary: composer(() => ALFA_REPLY).compose }),
      ]),
    ];
    for (const [failure, error, harness] of cases) {
      logged.length = 0;
      const { events } = await harness.run({ ...base, userIntent: "Revenue for ALFA" });
      assert.deepEqual(events.filter((event) => event.type === "turn.error"), [], failure);
      const done = completed(events);
      assert.deepEqual((done.message as { blocks: Block[] }).blocks.map((block) => block.kind), ["financial_answer"], failure);
      assert.deepEqual((await message(done.message_id)).blocks.map((block) => block.kind), ["financial_answer"], failure);
      assert.deepEqual(logged, [[`[chat] the analyst commentary on message ${done.message_id} failed; the turn completes with the answer as saved`, error]], failure);
    }
  });

  await t.test("only an overview gets commentary: a metric question, an analyst turn and a retry of a saved answer write none", async () => {
    const { compose, inputs } = composer(() => ALFA_REPLY);
    const harness = overview(compose);
    const { turnId, events } = await harness.run({ ...base, userIntent: "Revenue for ALFA" });
    const answered = completed(events);
    assert.equal(inputs.length, 1);
    const retried = completed((await harness.run({ ...base, userIntent: "Revenue for ALFA", turnId, runId: randomUUID() })).events);
    assert.equal(retried.message_id, answered.message_id);
    assert.equal(inputs.length, 1, "a retry of a saved answer composes none");
    assert.deepEqual((await message(answered.message_id)).blocks.map((block) => block.kind), ["financial_answer", "rich_text"]);

    await seedReportedFact(db, { metric_key: "revenue", value: "6000", fiscal_year: 2023, subject: ALFA });
    const metric = completed((await overview(compose, { model: revenueModel(["ALFA"]), readQuestion: reading(METRIC_READING) }).run({ ...base, userIntent: "Revenue for ALFA" })).events);
    assert.deepEqual((await message(metric.message_id)).blocks.map((block) => block.kind), ["financial_answer"]);

    let analystCalls = 0;
    const analyst: ChatAnalystToolRuntime = () => {
      analystCalls += 1;
      return { snapshot_id: randomUUID(), blocks: [], verification: { ok: true } };
    };
    await overview(compose, { analyst }).run({ ...base, userIntent: "tell me about ALFA" });
    assert.deepEqual([analystCalls, inputs.length], [1, 1]);
  });
});

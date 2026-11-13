import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { connectedPool, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { databaseUrl, IDS, NVDA, RESTATED_REVENUE, seedReportedFact, seedValuedIssuer } from "../../financial-engine/test/db-fixtures.ts";
import type { ChatResolvedSubjectPreResolution } from "../src/subjects.ts";
import type { PlanningModel } from "../../financial-engine/src/planner.ts";
import { createChatServer } from "../src/http.ts";
import { loadPriorSubjects } from "../src/thread-context.ts";
import { extractSubjectMentions } from "../src/subject-extraction.ts";
import { chatDatabase, chatHarness, comparing, completed, INSTRUMENT_A, LISTING_A, METRIC_READING, NO_ASKS, resolveMention, revenueModel } from "./financial-fixtures.ts";
import { readMessage } from "./read-message-fixture.ts";

type Offered = { clarification_id: string; question: string; choices: Array<{ choice_id: string; label: string }> };

test("financial clarifications", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for chat clarification coverage");
    return;
  }
  const { db, pool, threadId } = await chatDatabase(t, "chat-clarify");
  const base = { threadId, userId: IDS.owner, userIntent: "Revenue for AMB" };
  const ask = async (clarificationAnswer?: { clarification_id: string; choice_id: string }) => {
    const model = revenueModel(["AMB"]);
    const { events } = await chatHarness(pool, { model }).run({ ...base, ...(clarificationAnswer ? { clarificationAnswer } : {}) });
    return { done: completed(events), model };
  };

  const first = await ask();
  const offered = first.done.financial_clarification as Offered;

  await t.test("an ambiguous company is offered as versioned choices, before any model call", () => {
    assert.equal(first.done.clarification, true);
    assert.match(offered.question, /Which company did you mean by "AMB"\?/u);
    assert.deepEqual(offered.choices.map((choice) => choice.label), ["Alpha Industries Inc.", "Beta Holdings Corp."]);
    assert.match(offered.clarification_id, /^[0-9a-f]{64}$/u);
    assert.equal(first.model.calls, 0);
  });

  await t.test("answering creates a new plan for the chosen company and publishes it", async () => {
    const alpha = offered.choices.find((choice) => choice.label === "Alpha Industries Inc.")!;
    const { done, model } = await ask({ clarification_id: offered.clarification_id, choice_id: alpha.choice_id });
    assert.ok(done.message_id && !done.clarification, JSON.stringify(done));
    assert.equal(model.calls, 1);
    const [block] = (await db.query(`select blocks from chat_messages where message_id = $1`, [done.message_id])).rows[0].blocks;
    assert.equal(block.kind, "financial_answer");
    assert.ok(Object.values(block.financial.labels as Record<string, { text: string }>).some((label) => label.text === "Alpha Industries Inc."));
  });

  await t.test("choosing the explicit subject's own company for an ambiguous mention plans it once", async () => {
    const explicit = { threadId, userId: IDS.owner, subjectText: "AAA", userIntent: "Compare revenue for AMB and BBB" };
    const run = (clarificationAnswer?: { clarification_id: string; choice_id: string }) =>
      chatHarness(pool, { model: revenueModel(["AAA", "BBB"]), readQuestion: comparing("AMB", "BBB") }).run({ ...explicit, ...(clarificationAnswer ? { clarificationAnswer } : {}) });
    const asked = completed((await run()).events).financial_clarification as Offered;
    const alpha = asked.choices.find((choice) => choice.label === "Alpha Industries Inc.")!;
    const done = completed((await run({ clarification_id: asked.clarification_id, choice_id: alpha.choice_id })).events);
    assert.ok(done.message_id && !done.clarification && !done.financial_gap, JSON.stringify(done));
    const [block] = (await db.query(`select blocks from chat_messages where message_id = $1`, [done.message_id])).rows[0].blocks;
    assert.equal(block.financial.results.length, 2);
  });

  await t.test("a listing chosen for the explicit subject's issuer is planned once (#154)", { timeout: 60_000 }, async (st) => {
    await db.query(`insert into instruments (instrument_id, issuer_id, asset_type) values ($1::uuid, $2::uuid, 'common_stock')`, [INSTRUMENT_A, IDS.issuerA]);
    await db.query(
      `insert into listings (listing_id, instrument_id, mic, ticker, trading_currency, timezone)
       values ($1::uuid, $2::uuid, 'XNAS', 'ALPX', 'USD', 'America/New_York')`,
      [LISTING_A, INSTRUMENT_A],
    );
    // The explicit subject is a legal name (an issuer ref); the answered mention is a listing of that issuer.
    const explicit = { threadId, userId: IDS.owner, subjectText: "ALPHA", userIntent: "Compare revenue for AMBL and BBB" };
    // One connection: the issuer lookup must reuse the client planning already holds.
    const single = await connectedPool(st, databaseUrl(db), { max: 1 });
    const run = (clarificationAnswer?: { clarification_id: string; choice_id: string }) =>
      chatHarness(single, { model: revenueModel(["ALPHA", "BBB"]), readQuestion: comparing("AMBL", "BBB") }).run({ ...explicit, ...(clarificationAnswer ? { clarificationAnswer } : {}) });
    const asked = completed((await run()).events).financial_clarification as Offered;
    const listing = asked.choices.find((choice) => choice.label === "Alpha Industries Inc. (XNAS)")!;
    const done = completed((await run({ clarification_id: asked.clarification_id, choice_id: listing.choice_id })).events);
    assert.ok(done.message_id && !done.clarification && !done.financial_gap, JSON.stringify(done));
    const [block] = (await db.query(`select blocks from chat_messages where message_id = $1`, [done.message_id])).rows[0].blocks;
    assert.equal(block.financial.results.length, 2);
  });

  await t.test("a listing chosen in a clarification is answered from its issuer's facts", async () => {
    await db.query(`insert into instruments (instrument_id, issuer_id, asset_type) values ($1::uuid, $2::uuid, 'common_stock') on conflict do nothing`, [INSTRUMENT_A, IDS.issuerA]);
    await db.query(
      `insert into listings (listing_id, instrument_id, mic, ticker, trading_currency, timezone)
       values ($1::uuid, $2::uuid, 'XNAS', 'ALPX', 'USD', 'America/New_York') on conflict do nothing`,
      [LISTING_A, INSTRUMENT_A],
    );
    const run = (clarificationAnswer?: { clarification_id: string; choice_id: string }) =>
      chatHarness(pool, { model: revenueModel(["AMBL"]) }).run({ threadId, userId: IDS.owner, userIntent: "Revenue for AMBL", ...(clarificationAnswer ? { clarificationAnswer } : {}) });
    const asked = completed((await run()).events).financial_clarification as Offered;
    assert.deepEqual(asked.choices.map((choice) => [choice.choice_id, choice.label]), [
      [`issuer:${IDS.issuerA}`, "Alpha Industries Inc. (XNAS)"],
      [`issuer:${IDS.issuerB}`, "Beta Holdings Corp."],
    ]);
    const listing = asked.choices.find((choice) => choice.label === "Alpha Industries Inc. (XNAS)")!;
    const done = completed((await run({ clarification_id: asked.clarification_id, choice_id: listing.choice_id })).events);
    assert.ok(done.message_id && !done.clarification, JSON.stringify(done));
    const [block] = (await db.query(`select blocks from chat_messages where message_id = $1`, [done.message_id])).rows[0].blocks;
    assert.deepEqual(
      block.financial.results.map((result: { disposition: string; presented: { value?: string } }) => [result.disposition, result.presented.value]),
      [["verified", RESTATED_REVENUE]],
    );
  });

  await t.test("two listings of one company are that company: no question is asked", async () => {
    const { events } = await chatHarness(pool, { model: revenueModel(["AMBX"]) }).run({ threadId, userId: IDS.owner, userIntent: "Revenue for AMBX" });
    const done = completed(events);
    assert.ok(done.message_id && !done.clarification, JSON.stringify(done));
    const [block] = (await db.query(`select blocks from chat_messages where message_id = $1`, [done.message_id])).rows[0].blocks;
    assert.deepEqual(
      block.financial.results.map((result: { disposition: string; presented: { value?: string } }) => [result.disposition, result.presented.value]),
      [["verified", RESTATED_REVENUE]],
    );
  });

  await t.test("a company offered beside one that no longer exists is still asked about", async () => {
    const { events } = await chatHarness(pool, { model: revenueModel(["AMBG"]) }).run({ threadId, userId: IDS.owner, userIntent: "Revenue for AMBG" });
    const done = completed(events);
    assert.equal(done.clarification, true, JSON.stringify(done));
    assert.deepEqual((done.financial_clarification as Offered).choices.map((choice) => choice.label), ["Beta Holdings Corp."]);
  });

  await t.test("a stale or forged answer changes nothing: the same question is asked again", async () => {
    for (const answer of [
      { clarification_id: "0".repeat(64), choice_id: offered.choices[0]!.choice_id },
      { clarification_id: offered.clarification_id, choice_id: `issuer:${randomUUID()}` },
    ]) {
      const { done, model } = await ask(answer);
      assert.equal(done.clarification, true, JSON.stringify(answer));
      assert.equal((done.financial_clarification as Offered).clarification_id, offered.clarification_id);
      assert.equal(model.calls, 0);
    }
  });
});

test("a clarification answer must name both the clarification and the choice", async () => {
  const server = createChatServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/threads/${randomUUID()}/stream?run_id=${randomUUID()}&clarification_id=${"a".repeat(64)}`);
    assert.equal(response.status, 400);
    await response.body?.cancel();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("a typed reply to a metric clarification continues its company, not a ticker the reply spells (#623)", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for chat clarification coverage");
    return;
  }
  const { db, pool, threadId } = await chatDatabase(t, "chat-clarify-reply");
  // AAA files the lines each margin reads, so the clarification offers all three.
  for (const [metric_key, value] of [["operating_income", "60000000000"], ["net_income", "50000000000"]] as const) {
    await seedReportedFact(db, { metric_key, value, fiscal_year: 2023, subject: IDS.issuerA });
  }
  // The resolver reads any one word as a ticker: "all" is ALL, here issuer B.
  const resolver = (mention: string) => {
    const read = /\s/u.test(mention) ? mention : mention.toUpperCase();
    return resolveMention(read === "ALL" ? "BBB" : read);
  };
  // The planner asks which margin the question means, then plans whatever companies it is given.
  const asked: string[] = [];
  const model = (async (request: { messages: ReadonlyArray<{ content: string }> }) => {
    asked.push(request.messages.map((message) => message.content).join("\n"));
    return asked.at(-1)!.includes("What drives")
      ? { model: "stub-model", text: JSON.stringify({ outcome: "needs_clarification", question: "Which margin would you like?", choices: ["gross_margin", "operating_margin", "net_margin", "ebitda_margin"] }) }
      : revenueModel(["AAA"])({ messages: [] });
  }) as unknown as PlanningModel;
  const hydrate = async (_db: unknown, ref: { kind: string; id: string }) =>
    ({ subject_ref: ref, display_label: ref.id === IDS.issuerA ? "Alpha Industries Inc." : "Beta Holdings Corp.", display_labels: { ticker: ref.id === IDS.issuerA ? "AAA" : "BBB" }, context: {}, normalized_input: ref.id, identity_level: "issuer", resolution_path: "test", confidence: 1 }) as never;
  const harness = chatHarness(pool, {
    model,
    resolveMention: resolver,
    // As the model reads them, "all" asks for no figure, and the margins the clarification offered do (#626).
    readQuestion: async (question) => ({ ...(/margin/iu.test(question) ? METRIC_READING : NO_ASKS), companies: { kind: "as_named", names: extractSubjectMentions(question) } }),
    priorSubjects: (thread) => loadPriorSubjects(pool, { threadId: thread }, hydrate),
    // A clarification is a message of the thread, sealed over its blocks' subjects as a deployment seals it.
    persistAssistantMessage: async (message) => {
      const messageId = message.message_id ?? randomUUID();
      const [block] = message.blocks as Array<{ snapshot_id: string; subject_refs?: unknown[] }>;
      await pool.query(
        `insert into snapshots (snapshot_id, subject_refs, as_of, basis, normalization, allowed_transforms) values ($1, $2::jsonb, now(), 'unadjusted', 'raw', '{}')`,
        [block!.snapshot_id, JSON.stringify(block!.subject_refs ?? [])],
      );
      await pool.query(
        `insert into chat_messages (message_id, thread_id, role, snapshot_id, blocks, content_hash) values ($1, $2, 'assistant', $3, $4::jsonb, $5)`,
        [messageId, message.threadId, block!.snapshot_id, JSON.stringify(message.blocks), message.content_hash],
      );
      return readMessage({ snapshot_id: block!.snapshot_id, message_id: messageId, thread_id: message.threadId });
    },
  });

  for (const typed of ["all", "All of the above"]) {
    const question = completed((await harness.run({ threadId, userId: IDS.owner, userIntent: "What drives AAA's margins?" })).events);
    assert.equal(question.clarification, true, JSON.stringify(question));
    const [block] = harness.persisted.at(-1)!.blocks as Array<{ subject_refs?: unknown }>;
    assert.deepEqual(block!.subject_refs, [{ kind: "issuer", id: IDS.issuerA }], "the clarification names the company it asked about");

    const reply = completed((await harness.run({ threadId, userId: IDS.owner, userIntent: typed })).events);
    assert.ok(reply.message_id && !reply.clarification && !reply.financial_gap, `${typed}: ${JSON.stringify(reply)}`);
    const [answer] = (await db.query(`select blocks from chat_messages where message_id = $1`, [reply.message_id])).rows[0].blocks;
    assert.deepEqual(
      Object.values(answer.financial.labels as Record<string, { kind: string; text: string }>).filter((label) => label.kind === "subject").map((label) => label.text),
      ["Alpha Industries Inc."],
      typed,
    );
    // The reply is planned as every option the clarification offered, typed out (#626): EBITDA margin has no definition, so it was never offered, and the question says so (#643).
    assert.match(asked.at(-1)!, /Gross margin; Operating margin; Net margin\n/u, typed);
  }

  // The options show as buttons from the saved field, so the text is the question once.
  completed((await harness.run({ threadId, userId: IDS.owner, userIntent: "What drives AAA's margins?" })).events);
  const [saved] = harness.persisted.at(-1)!.blocks as Array<{ segments: unknown; clarification_choices: unknown }>;
  assert.deepEqual(saved!.segments, [{ type: "text", text: "Which figures should I show for AAA? I can't compute ebitda margin." }], "an option it can't compute is named, not dropped unsaid");
  assert.deepEqual(saved!.clarification_choices, ["Gross margin", "Operating margin", "Net margin"]);
  const picked = completed((await harness.run({ threadId, userId: IDS.owner, userIntent: "Gross margin" })).events);
  assert.ok(picked.message_id && !picked.clarification && !picked.financial_gap, JSON.stringify(picked));
  const [pickedAnswer] = (await db.query(`select blocks from chat_messages where message_id = $1`, [picked.message_id])).rows[0].blocks;
  assert.deepEqual(
    Object.values(pickedAnswer.financial.labels as Record<string, { kind: string; text: string }>).filter((label) => label.kind === "subject").map((label) => label.text),
    ["Alpha Industries Inc."],
    "a typed option continues the company the clarification asked about",
  );

  // "both" takes every option only when exactly two were offered; these were three.
  completed((await harness.run({ threadId, userId: IDS.owner, userIntent: "What drives AAA's margins?" })).events);
  const before = asked.length;
  await harness.run({ threadId, userId: IDS.owner, userIntent: "both" });
  assert.deepEqual(asked.slice(before).filter((prompt) => prompt.includes("Gross margin; Operating margin")), [], "both is read as written");

  // A reply that adds a period keeps it: it is read as written, not replaced by the options.
  for (const qualified of ["all 2024", "all, 2023", "all of them (2024–2025)"]) {
    completed((await harness.run({ threadId, userId: IDS.owner, userIntent: "What drives AAA's margins?" })).events);
    const start = asked.length;
    await harness.run({ threadId, userId: IDS.owner, userIntent: qualified });
    assert.deepEqual(asked.slice(start).filter((prompt) => prompt.includes("Gross margin; Operating margin")), [], `${qualified} is read as written`);
  }
});

test("a company-choice clarification names no company, so replaying the pick reaches the choice (#623)", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for chat clarification coverage");
    return;
  }
  const { pool, threadId } = await chatDatabase(t, "chat-clarify-choice");
  // AAA resolves and AMB is offered as choices. Saving AAA as the thread's
  // company would make the replayed pick read AMB as a new company and ask
  // "Add AMB…?" before the choice applies.
  const harness = chatHarness(pool, { model: revenueModel(["AAA", "AMB"]) });
  const asked = completed((await harness.run({ threadId, userId: IDS.owner, userIntent: "Compare revenue for AAA and AMB" })).events);
  assert.equal(asked.clarification, true, JSON.stringify(asked));
  assert.match((asked.financial_clarification as Offered).question, /Which company did you mean by "AMB"\?/u);
  const [block] = harness.persisted.at(-1)!.blocks as Array<{ subject_refs?: unknown }>;
  assert.equal(block!.subject_refs, undefined);
});

test("a metric clarification offers only figures the companies' filings compute, in the server's words, and names a company with no filings (#643)", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for chat clarification coverage");
    return;
  }
  const { db, pool, threadId } = await chatDatabase(t, "chat-clarify-computable");
  // The model asks as it asked about MU, SNDK, WDC and STX: a company left out
  // of the plan named in its own words, and options of every kind.
  const planner = (reply: unknown) => (async () => ({ model: "stub-model", text: JSON.stringify(reply) })) as unknown as PlanningModel;
  const asking = planner({
    outcome: "needs_clarification",
    question: "Which metric should I use? Also, CCC is in your request but not in the requested-company list (AAA). Should I include it?",
    choices: ["revenue", "gross_margin", "operating_margin", "free_cash_flow", "net_cash", "ebitda_margin", "Market cap and P/E"],
  });
  // AAA reports cash but no debt: net cash needs a balance on each side, so it is not offered.
  await seedReportedFact(db, { metric_key: "cash_and_equivalents", value: "1000", fiscal_year: 2023, subject: IDS.issuerA });
  // Nor with securities and debt but no cash and equivalents, which net cash requires.
  await seedReportedFact(db, { metric_key: "marketable_securities_current", value: "500", fiscal_year: 2021, subject: IDS.issuerA });
  await seedReportedFact(db, { metric_key: "long_term_debt_noncurrent", value: "300", fiscal_year: 2021, subject: IDS.issuerA });
  // Its cash flow inputs sit in different years, so free cash flow, which needs both in one period, is not offered either.
  await seedReportedFact(db, { metric_key: "operating_cash_flow", value: "900", fiscal_year: 2022, subject: IDS.issuerA });
  await seedReportedFact(db, { metric_key: "capex", value: "100", fiscal_year: 2023, subject: IDS.issuerA });
  // Its FY2020 operating income was invalidated, so binding cannot read it and operating margin is not offered.
  await seedReportedFact(db, { metric_key: "revenue", value: "2000", fiscal_year: 2020, subject: IDS.issuerA });
  const invalidated = await seedReportedFact(db, { metric_key: "operating_income", value: "400", fiscal_year: 2020, subject: IDS.issuerA });
  await db.query(`update facts set invalidated_at = now() where fact_id = $1`, [invalidated]);
  // No reading, so the planner's model plans the turn.
  const harness = chatHarness(pool, { model: asking, readQuestion: async () => null });
  const done = completed((await harness.run({ threadId, userId: IDS.owner, userIntent: "compare AAA and CCC" })).events);
  assert.equal(done.clarification, true, JSON.stringify(done));
  const [block] = harness.persisted.at(-1)!.blocks as Array<{ segments: Array<{ text: string }>; clarification_choices: unknown }>;
  // AAA files revenue and gross profit only; CCC files nothing, so it was left out of the plan.
  assert.deepEqual(block!.clarification_choices, ["Revenue", "Gross margin"]);
  assert.deepEqual(block!.segments, [{ type: "text", text: "No SEC filings are on file for CCC yet. Which figures should I show for AAA? I can't compute ebitda margin or Market cap and P/E." }]);
  assert.deepEqual((done.financial_clarification as Offered).choices.map((choice) => choice.choice_id), ["revenue", "gross_margin"]);

  // A request the planner declines names the company left out too.
  const declining = chatHarness(pool, { model: planner({ outcome: "unsupported", reason: "forecast" }), readQuestion: async () => null });
  const gap = completed((await declining.run({ threadId, userId: IDS.owner, userIntent: "forecast AAA and CCC" })).events);
  assert.deepEqual(gap.financial_gap, { reason_code: "unsupported" });
  const [gapBlock] = declining.persisted.at(-1)!.blocks as Array<{ segments: Array<{ text: string }> }>;
  assert.equal(gapBlock!.segments[0]!.text, "No SEC filings are on file for CCC yet. This request asks for a calculation outside the verified financial definitions I can compute: guidance, estimates or forecasts.");

  // Every company left out: the answer names the one with no filings and the name that matched none.
  const leftOut = chatHarness(pool, { model: asking, readQuestion: async () => null });
  const none = completed((await leftOut.run({ threadId, userId: IDS.owner, userIntent: "compare CCC and ZZZQ" })).events);
  assert.deepEqual(none.financial_gap, { reason_code: "no_sec_filings" }, JSON.stringify(none));
  const [noneBlock] = leftOut.persisted.at(-1)!.blocks as Array<{ segments: Array<{ text: string }> }>;
  assert.equal(noneBlock!.segments[0]!.text, "No company matched ZZZQ. No SEC filings are on file for CCC yet.");
});

test("market cap and P/E are offered only for a company with a share price at the cutoff (#645)", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for chat clarification coverage");
    return;
  }
  const { db, pool, threadId } = await chatDatabase(t, "chat-clarify-priced");
  const PXQ = {
    issuer: "4f000000-0000-4000-8000-000000000ba1", listing: "4f000000-0000-4000-8000-000000000be1",
    tenK: "4f000000-0000-4000-8000-000000000bc1", tenQ: "4f000000-0000-4000-8000-000000000bc2",
    ticker: "PXQ", name: "Priced Corp.", close: "100.00", eps: "4.00", shares: "1000000",
  } as const;
  await seedValuedIssuer(db, PXQ);
  const asking = (async () => ({ model: "stub-model", text: JSON.stringify({ outcome: "needs_clarification", question: "Which figure?", choices: ["market_cap", "pe_ratio", "eps_diluted"] }) })) as unknown as PlanningModel;
  let now: string = NVDA.cutoff;
  const harness = chatHarness(pool, {
    model: asking,
    readQuestion: async () => null,
    clock: () => new Date(now),
    resolveMention: (mention) => mention === "PXQ"
      ? Promise.resolve({ status: "resolved", subject_ref: { kind: "issuer", id: PXQ.issuer }, display_label: PXQ.name, handoff: { display_labels: { ticker: PXQ.ticker } } } as unknown as ChatResolvedSubjectPreResolution)
      : resolveMention(mention),
  });
  const offered = async () => (completed((await harness.run({ threadId, userId: IDS.owner, userIntent: "value PXQ" })).events).financial_clarification as Offered).choices.map((choice) => choice.choice_id);
  assert.deepEqual(await offered(), ["market_cap", "pe_ratio", "eps_diluted"]);
  // Weeks later its last close is stale: the valuation would end in a gap, so only the filed figure is offered.
  now = "2024-07-01T15:00:00Z";
  assert.deepEqual(await offered(), ["eps_diluted"]);
});

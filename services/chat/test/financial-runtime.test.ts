import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";
import { connectedPool, dockerAvailable } from "../../../db/test/docker-pg.ts";
import type { PlanningModel } from "../../financial-engine/src/planner.ts";
import { databaseUrl, IDS, ORIGINAL_REVENUE } from "../../financial-engine/test/db-fixtures.ts";
import type { ChatAnalystToolRuntime, ChatAssistantMessagePersistence } from "../src/coordinator.ts";
import { financialMessageId } from "../src/chat-ids.ts";
import { createChatFinancialRuntime, SCOPE_METRICS } from "../src/financial-runtime.ts";
import { METRIC_CATALOG_V1, OPERATION_REGISTRY } from "../../financial-core/src/index.ts";
import { proposedMetric, type CompanyChange, type ScopeProposal } from "../src/research-scope.ts";
import { parseProposal } from "../src/scope-proposal.ts";
import { extractSubjectMentions } from "../src/subject-extraction.ts";
import { createEvidenceFinancialPort } from "../../financial-engine/src/evidence-adapter.ts";
import type { FinancialPool } from "../../financial-engine/src/ports.ts";
import { changing, chatDatabase, chatHarness, comparing, completed, INSTRUMENT_A, LISTING_A, METRIC_READING, MISSING_ISSUER, NO_ASKS, resolveMention, revenueModel } from "./financial-fixtures.ts";
import type { ChatResolvedSubjectPreResolution, ChatSubjectPreResolution } from "../src/subjects.ts";

test("an unready engine stops the server instead of leaving metric questions on legacy numbers", async () => {
  // A database missing every financial table: every readiness check reports absent.
  const unready = { query: async () => ({ rows: [{ kind: "relation", name: "financial_runs", present: false }] }), connect: async () => assert.fail("no turn runs") } as unknown as FinancialPool;
  const lane = createChatFinancialRuntime({ pool: unready, planningModel: null, resolveMention: async () => assert.fail("no turn runs"), evidence: createEvidenceFinancialPort });
  await assert.rejects(() => lane.assertReady(), /verified finance is not ready for chat: schema: relation financial_runs is missing/u);
});

// The chat server's own message persistence (local-runtime.ts) on this
// database, so a test reads what a thread saves. Imported here, not in
// financial-fixtures.ts, which the engine's typecheck reaches without llm.
async function savingMessages(t: TestContext, url: string): Promise<ChatAssistantMessagePersistence> {
  const previous = process.env.CHAT_DATABASE_URL;
  process.env.CHAT_DATABASE_URL = url;
  const runtime = await import("../src/local-runtime.ts");
  t.after(async () => {
    await runtime.closeLocalRuntimePoolForTests();
    if (previous === undefined) delete process.env.CHAT_DATABASE_URL;
    else process.env.CHAT_DATABASE_URL = previous;
  });
  return runtime.persistAssistantMessage;
}

function declining(reason: string): PlanningModel & { calls: number } {
  const model = (async () => {
    model.calls += 1;
    return { model: "stub-model", text: JSON.stringify({ outcome: "unsupported", reason }) };
  }) as unknown as PlanningModel & { calls: number };
  model.calls = 0;
  return model;
}

test("chat financial lane", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for chat financial coverage");
    return;
  }
  const { db, pool, threadId } = await chatDatabase(t, "chat-financial");
  const base = { threadId, userId: IDS.owner };

  await t.test("a comparison names in its answer a company that matches none, and calculates the rest, as the analyst path does", async () => {
    const { events } = await chatHarness(pool, { model: revenueModel(["AAA", "BBB"]), readQuestion: comparing("AAA", "BBB", "ZZZ") }).run({ ...base, userIntent: "Compare revenue for AAA, BBB and ZZZ" });
    const [block, note] = (await db.query(`select blocks from chat_messages where message_id = $1`, [completed(events).message_id])).rows[0].blocks;
    assert.deepEqual(block.financial.results.map((result: { disposition: string }) => result.disposition), ["verified", "missing"]);
    assert.deepEqual(note.segments, [{ type: "text", text: "No company matched ZZZ." }]);
  });

  await t.test("a company without eligible data stays in the answer as an explicit gap", async () => {
    const model = revenueModel(["AAA", "BBB"]);
    const { events } = await chatHarness(pool, { model }).run({ ...base, userIntent: "Compare revenue for AAA and BBB" });
    const done = completed(events);
    assert.deepEqual(events.map((event) => event.type), ["turn.started", "snapshot.sealed", "block.began", "block.completed", "turn.completed"], "nothing but the start is streamed before commit");
    assert.equal(events[0]!.bundle_id, "financial_answer");
    const message = (await db.query(`select blocks, snapshot_id::text from chat_messages where message_id = $1`, [done.message_id])).rows[0];
    const [block] = message.blocks;
    assert.equal(block.kind, "financial_answer");
    assert.equal(block.snapshot_id, message.snapshot_id);
    assert.deepEqual(block.financial.results.map((result: { disposition: string }) => result.disposition), ["verified", "missing"]);
    assert.equal(block.financial.coverage.state, "partial", "two companies were asked about; the answer covers both");
  });

  await t.test("a published answer saves its scope over the companies the plan requests; one that cannot be resolved saves none (#206)", async () => {
    // This lane runs before the analyst path resolves the turn's companies, so
    // the scope callback must be given the ones the message names.
    const seen: string[][] = [];
    const scopeOf = async (context: { subjectPreResolutions?: ReadonlyArray<{ subject_ref: { id: string } }> }) => {
      const ids = (context.subjectPreResolutions ?? []).map((subject) => subject.subject_ref.id);
      seen.push(ids);
      return {
        route: "comparison" as const,
        reads: "comparison" as const,
        companies: ids.map((issuer_id) => ({ issuer_id })),
        peers: false,
        segments: false,
        margin_trend: false,
        margins: false,
        metrics: [],
        fiscal_year: 2024,
        price_window: null,
        inherited: [],
      };
    };
    const savedScope = async (researchScope: NonNullable<Parameters<typeof chatHarness>[1]["researchScope"]>) => {
      const { events } = await chatHarness(pool, { model: revenueModel(["AAA", "BBB"]), researchScope }).run({ ...base, userIntent: "Compare revenue for AAA and BBB" });
      return (await db.query(`select research_scope from chat_messages where message_id = $1`, [completed(events).message_id])).rows[0].research_scope;
    };
    const saved = await savedScope(scopeOf as never);
    assert.deepEqual(seen, [[IDS.issuerA, IDS.issuerB]]);
    assert.deepEqual(saved.companies, [{ issuer_id: IDS.issuerA }, { issuer_id: IDS.issuerB }]);
    // The scope only informs follow-ups; failing to resolve it never fails the answer.
    assert.equal(await savedScope(async () => { throw new Error("prior scope unavailable"); }), null);
    assert.equal(await savedScope((() => { throw new Error("no scope builder"); }) as never), null, "one that throws before it answers");
  });

  await t.test("the answer names, beside its figures, what the reading of the question asks for and the plan does not compute", async () => {
    const readQuestion = async () => parseProposal(JSON.stringify({
      metrics: [{ metric: "ebitda" }, { metric: "income_statement" }],
      asks: ["benchmark"],
      turns_off: { facets: [], metrics: [] },
      income_items: ["revenue"],
      period: { kind: "none" },
      companies: { kind: "as_named", names: [] },
    }), "");
    const { events } = await chatHarness(pool, { model: revenueModel(["AAA", "BBB"]), readQuestion }).run({ ...base, userIntent: "Compare revenue and EBITDA for AAA and BBB against the S&P 500" });
    const message = (await db.query(`select blocks from chat_messages where message_id = $1`, [completed(events).message_id])).rows[0];
    assert.deepEqual(message.blocks.map((block: { kind: string }) => block.kind), ["financial_answer", "rich_text"]);
    assert.deepEqual(message.blocks[1].segments, [{ type: "text", text: "Not covered by this answer: EBITDA; a comparison with a benchmark index." }]);
    assert.equal(message.blocks[1].snapshot_id, message.blocks[0].snapshot_id, "the note shares the answer's snapshot");
    assert.deepEqual(events.filter((event) => event.type === "block.completed").map((event) => event.block_id), message.blocks.map((block: { id: string }) => block.id));
  });

  await t.test("a metric question picks its companies as the analyst path does, and names the ones it carries", async () => {
    const carried = async (ticker: string) => ({ ...(await resolveMention(ticker)), handoff: { display_labels: { ticker } } }) as unknown as ChatResolvedSubjectPreResolution;
    const aaa = await carried("AAA");
    const bbb = await carried("BBB");
    const answer = async (userIntent: string, tickers: string[], prior = [aaa], readQuestion = changing({ kind: "as_named", names: [] })) => {
      const { events } = await chatHarness(pool, { model: revenueModel(tickers), priorSubjects: async () => prior, readQuestion }).run({ ...base, userIntent });
      const [block, ...notes] = (await db.query(`select blocks from chat_messages where message_id = $1`, [completed(events).message_id])).rows[0].blocks;
      return {
        companies: Object.values(block.financial.labels as Record<string, { kind: string; text: string }>).filter((label) => label.kind === "subject").map((label) => label.text),
        notes: notes.map((note: { segments: Array<{ text: string }> }) => note.segments.map((segment) => segment.text).join("")),
      };
    };
    // An uppercase metric acronym is not a company.
    assert.deepEqual(await answer("What about its EBIT revenue?", ["AAA"]), { companies: ["Alpha Industries Inc."], notes: ["AAA is carried from the previous answer."] });
    assert.deepEqual(await answer("Compare its revenue with BBB", ["AAA", "BBB"], [aaa], comparing("BBB")), { companies: ["Alpha Industries Inc.", "Beta Holdings Corp."], notes: ["AAA is carried from the previous answer."] });
    assert.deepEqual(await answer("Compare AAA and BBB revenue again", ["AAA", "BBB"], [aaa], comparing("AAA", "BBB")), { companies: ["Alpha Industries Inc.", "Beta Holdings Corp."], notes: [] }, "a company the question names is not carried");
    assert.deepEqual(await answer("Add BBB's revenue", ["AAA", "BBB"], [aaa], comparing("BBB")), { companies: ["Alpha Industries Inc.", "Beta Holdings Corp."], notes: ["AAA is carried from the previous answer."] });
    assert.deepEqual(await answer("Drop BBB and show revenue", ["AAA"], [aaa, bbb], changing({ kind: "drop", drop: ["BBB"], add: [] })), { companies: ["Alpha Industries Inc."], notes: ["AAA is carried from the previous answer."] });
    // A comparison naming an ambiguous company asks about it and still carries the previous answer's.
    const compareAmbiguous = (clarificationAnswer?: { clarification_id: string; choice_id: string }) =>
      chatHarness(pool, { model: revenueModel(["AAA", "AMBL"]), priorSubjects: async () => [aaa], readQuestion: comparing("AMBL") })
        .run({ ...base, userIntent: "Compare its revenue with AMBL", ...(clarificationAnswer ? { clarificationAnswer } : {}) });
    const asked = completed((await compareAmbiguous()).events).financial_clarification as { clarification_id: string; choices: Array<{ choice_id: string; label: string }> };
    const beta = asked.choices.find((choice) => choice.label === "Beta Holdings Corp.")!;
    const picked = completed((await compareAmbiguous({ clarification_id: asked.clarification_id, choice_id: beta.choice_id })).events);
    const [pickedBlock, ...pickedNotes] = (await db.query(`select blocks from chat_messages where message_id = $1`, [picked.message_id])).rows[0].blocks;
    assert.deepEqual(
      [Object.values(pickedBlock.financial.labels as Record<string, { kind: string; text: string }>).filter((label) => label.kind === "subject").map((label) => label.text), pickedNotes.map((note: { segments: Array<{ text: string }> }) => note.segments[0]!.text)],
      [["Alpha Industries Inc.", "Beta Holdings Corp."], ["AAA is carried from the previous answer."]],
    );
    // Two listings of one company need no question, and the previous answer's company is still carried.
    await db.query(`insert into instruments (instrument_id, issuer_id, asset_type) values ($1::uuid, $2::uuid, 'common_stock') on conflict do nothing`, [INSTRUMENT_A, IDS.issuerA]);
    await db.query(
      `insert into listings (listing_id, instrument_id, mic, ticker, trading_currency, timezone)
       values ($1::uuid, $2::uuid, 'XNAS', 'ALPX', 'USD', 'America/New_York') on conflict do nothing`,
      [LISTING_A, INSTRUMENT_A],
    );
    assert.deepEqual(await answer("Compare its revenue with AMBX", ["BBB", "AMBX"], [bbb], comparing("AMBX")), { companies: ["Beta Holdings Corp.", "Alpha Industries Inc."], notes: ["BBB is carried from the previous answer."] });
    // A name the comparison gives that matches no company goes to the note, not to the question.
    const compareUnknown = (clarificationAnswer?: { clarification_id: string; choice_id: string }) =>
      chatHarness(pool, { model: revenueModel(["AAA", "AMBL"]), readQuestion: comparing("AAA", "AMBL", "ZZZ") }).run({ ...base, userIntent: "Compare revenue for AAA, AMBL and ZZZ", ...(clarificationAnswer ? { clarificationAnswer } : {}) });
    const offered = completed((await compareUnknown()).events).financial_clarification as { clarification_id: string; choices: Array<{ choice_id: string; label: string }> };
    const pickedBeta = completed((await compareUnknown({ clarification_id: offered.clarification_id, choice_id: offered.choices.find((choice) => choice.label === "Beta Holdings Corp.")!.choice_id })).events);
    const [, unknownNote] = (await db.query(`select blocks from chat_messages where message_id = $1`, [pickedBeta.message_id])).rows[0].blocks;
    assert.deepEqual(unknownNote.segments, [{ type: "text", text: "No company matched ZZZ." }]);
    const unclear = completed((await chatHarness(pool, { model: revenueModel([]), priorSubjects: async () => [aaa, bbb], readQuestion: changing({ kind: "unclear", names: ["CCC"] }) }).run({ ...base, userIntent: "What about CCC's revenue?" })).events);
    assert.equal(unclear.clarification, true);
    assert.equal((unclear.financial_clarification as { question: string }).question, 'Add CCC to the AAA and BBB comparison, or look at CCC alone? Say "add CCC" or "just CCC".');
  });

  // The scope financialResearchScope saves, over the companies it is given.
  const scopeOver = async (context: { subjectPreResolutions?: ReadonlyArray<ChatResolvedSubjectPreResolution> }) => ({
    route: "financial_answer" as const,
    reads: "financial_answer" as const,
    companies: (context.subjectPreResolutions ?? []).map((subject) => ({ issuer_id: subject.subject_ref.id, label: subject.handoff?.display_labels?.ticker ?? subject.display_label })),
    peers: false, segments: false, margin_trend: false, margins: false, metrics: [], fiscal_year: null, fiscal_quarter: null, price_window: null, benchmark: false, inherited: [],
  });
  const turnWithPick = async (harness: ReturnType<typeof chatHarness>, userIntent: string, pick?: string) => {
    const { events } = await harness.run({ ...base, userIntent });
    if (pick === undefined) return completed(events);
    const offered = completed(events).financial_clarification as { clarification_id: string; choices: Array<{ choice_id: string; label: string }> };
    const choice = offered.choices.find((candidate) => candidate.label === pick)!;
    return completed((await harness.run({ ...base, userIntent, clarificationAnswer: { clarification_id: offered.clarification_id, choice_id: choice.choice_id } })).events);
  };

  await t.test("an engine gap names the planner's reason and saves the companies it was asked about, with its scope (#425)", async () => {
    const segments = async (userIntent: string, reason: string, pick?: string) => {
      const model = (async () => ({ model: "stub-model", text: JSON.stringify({ outcome: "unsupported", reason }) })) as unknown as PlanningModel;
      const harness = chatHarness(pool, { model, researchScope: scopeOver as never });
      const done = await turnWithPick(harness, userIntent, pick);
      const [block] = harness.persisted.at(-1)!.blocks as ReadonlyArray<{ segments: Array<{ text: string }>; subject_refs?: unknown }>;
      const scope = harness.persisted.at(-1)!.research_scope as { route: string; reads: string; companies: unknown; metrics: unknown } | undefined;
      return { gap: done.financial_gap, text: block!.segments[0]!.text, subject_refs: block!.subject_refs, scope: scope && [scope.route, scope.reads, scope.companies, scope.metrics] };
    };
    assert.deepEqual(await segments("Break down AAA's revenue by segment", "segments"), {
      gap: { reason_code: "unsupported" },
      text: "This request asks for a calculation outside the verified financial definitions I can compute: revenue or results by business segment.",
      subject_refs: [{ kind: "issuer", id: IDS.issuerA }],
      scope: ["financial_gap", "financial_gap", [{ issuer_id: IDS.issuerA, label: "AAA" }], []],
    });
    // A gap about no resolved company saves no scope, so the previous one stays.
    assert.deepEqual(await segments("Show AMB's cash resilience score", "not used"), {
      gap: { reason_code: "unsupported" },
      text: "This request asks for a calculation outside the verified financial definitions I can compute: cash resilience is an annual view without scores, peer ranks, or cash and debt measures.",
      subject_refs: undefined,
      scope: undefined,
    });
    // A company picked in a clarification is saved too, labelled. A reason the planner does not list is not shown.
    assert.deepEqual(await segments("Break down AMB's revenue by segment", "segment revenue has no approved definition", "Beta Holdings Corp."), {
      gap: { reason_code: "unsupported" },
      text: "This request asks for a calculation outside the verified financial definitions I can compute.",
      subject_refs: [{ kind: "issuer", id: IDS.issuerB }],
      scope: ["financial_gap", "financial_gap", [{ issuer_id: IDS.issuerB, label: "Beta Holdings Corp." }], []],
    });
  });

  await t.test("an engine answer saves, labelled, a company picked in a clarification and one two listings name (#425)", async () => {
    await db.query(`insert into instruments (instrument_id, issuer_id, asset_type) values ($1::uuid, $2::uuid, 'common_stock') on conflict do nothing`, [INSTRUMENT_A, IDS.issuerA]);
    await db.query(
      `insert into listings (listing_id, instrument_id, mic, ticker, trading_currency, timezone)
       values ($1::uuid, $2::uuid, 'XNAS', 'ALPX', 'USD', 'America/New_York') on conflict do nothing`,
      [LISTING_A, INSTRUMENT_A],
    );
    const savedCompanies = async (userIntent: string, mentions: string[], pick?: string) => {
      const done = await turnWithPick(chatHarness(pool, { model: revenueModel(mentions), researchScope: scopeOver as never }), userIntent, pick);
      return (await db.query(`select research_scope from chat_messages where message_id = $1`, [done.message_id])).rows[0]?.research_scope.companies;
    };
    assert.deepEqual(await savedCompanies("Revenue for AMB", ["AMB"], "Beta Holdings Corp."), [{ issuer_id: IDS.issuerB, label: "Beta Holdings Corp." }]);
    assert.deepEqual(await savedCompanies("Revenue for AMBX", ["AMBX"]), [{ issuer_id: IDS.issuerA, label: "ALPX" }]);
  });

  await t.test("a turn plans at most five companies, from a company's page or beside an ambiguous one, as the analyst path does (#425)", async () => {
    const seen: string[] = [];
    const model = (async (request: { messages: Array<{ content: string }> }) => {
      seen.push(/Requested companies \(mentions\): (.*)$/mu.exec(request.messages[1]!.content)![1]!);
      return { model: "stub-model", text: JSON.stringify({ outcome: "unsupported", reason: "not needed here" }) };
    }) as unknown as PlanningModel;
    await chatHarness(pool, { model, readQuestion: comparing("BBB", "CCC", "OPM", "PAX", "COX") }).run({ ...base, subjectText: "AAA", userIntent: "Compare revenue with BBB, CCC, OPM, PAX, COX and QTR" });
    await turnWithPick(chatHarness(pool, { model }), "Compare revenue for AMB, BBB, CCC, OPM, PAX, COX and QTR", "Alpha Industries Inc.");
    // The page's company named again in the message takes one slot.
    await chatHarness(pool, { model, readQuestion: comparing("AAA", "BBB", "CCC", "OPM", "PAX") }).run({ ...base, subjectText: "ALPHA", userIntent: "Compare revenue for AAA with BBB, CCC, OPM, PAX and COX" });
    // Carried companies fill the slots the named ones leave.
    const carried = async (ticker: string) => ({ ...(await resolveMention(ticker)), handoff: { display_labels: { ticker } } }) as unknown as ChatResolvedSubjectPreResolution;
    await turnWithPick(chatHarness(pool, { model, priorSubjects: async () => [await carried("AAA")], readQuestion: comparing("AMB", "OPM", "PAX", "COX") }), "Compare its revenue with AMB, OPM, PAX and COX", "Beta Holdings Corp.");
    // Past the cap a carried company is not dropped silently: the turn asks.
    const two = [await carried("AAA"), await carried("QTR")];
    const past = completed((await chatHarness(pool, { model, priorSubjects: async () => two, readQuestion: comparing("AMB", "OPM", "PAX", "COX") }).run({ ...base, userIntent: "Compare its revenue with AMB, OPM, PAX and COX" })).events);
    assert.equal((past.financial_clarification as { question: string }).question, "An answer covers at most 5 companies, and AAA, QTR, OPM, PAX, COX and AMB are 6. Name the ones to look at.");
    // A company named twice takes one of the slots the carried ones fill.
    const three = [await carried("QTR"), await carried("COX"), await carried("CCC")];
    await turnWithPick(chatHarness(pool, { model, priorSubjects: async () => three, readQuestion: comparing("AMB", "AAA", "ALPHA") }), "Compare its revenue with AMB, AAA and ALPHA", "Beta Holdings Corp.");
    // An ambiguous name past the cap is still asked about; a resolved company gives up its slot.
    const offered = completed((await chatHarness(pool, { model }).run({ ...base, userIntent: "Compare revenue for BBB, CCC, OPM, PAX, COX and AMB" })).events);
    assert.equal(offered.clarification, true, "the ambiguous company is asked about");
    await turnWithPick(chatHarness(pool, { model }), "Compare revenue for BBB, CCC, OPM, PAX, COX and AMB", "Alpha Industries Inc.");
    // A carried company named by the ticker the message gives another one is named to the planner by its legal name.
    const alphaAsAmb = { ...(await resolveMention("AAA")), handoff: { display_labels: { ticker: "AMB" } } } as unknown as ChatResolvedSubjectPreResolution;
    await turnWithPick(chatHarness(pool, { model, priorSubjects: async () => [alphaAsAmb], readQuestion: comparing("AMB") }), "Compare its revenue with the other AMB", "Beta Holdings Corp.");
    assert.deepEqual(seen, [
      "AAA; BBB; CCC; OPM; PAX",
      "AMB; BBB; CCC; OPM; PAX",
      "ALPHA; BBB; CCC; OPM; PAX",
      "AAA; AMB; OPM; PAX; COX",
      "QTR; COX; CCC; AMB; AAA",
      "BBB; CCC; OPM; PAX; AMB",
      "Alpha Industries Inc.; AMB",
    ]);
  });

  await t.test("a turn naming an ambiguous company changes the previous answer's companies only as its reading says", async () => {
    const seen: string[] = [];
    const model = (async (request: { messages: Array<{ content: string }> }) => {
      seen.push(/Requested companies \(mentions\): (.*)$/mu.exec(request.messages[1]!.content)![1]!);
      return { model: "stub-model", text: JSON.stringify({ outcome: "unsupported", reason: "not needed here" }) };
    }) as unknown as PlanningModel;
    const carried = async (ticker: string) => ({ ...(await resolveMention(ticker)), handoff: { display_labels: { ticker } } }) as unknown as ChatResolvedSubjectPreResolution;
    const prior = [await carried("AAA"), await carried("QTR")];
    const harness = (companies: CompanyChange) => chatHarness(pool, { model, priorSubjects: async () => prior, readQuestion: changing(companies) });
    await turnWithPick(harness({ kind: "drop", drop: ["QTR"], add: ["AMB"] }), "Drop QTR and add AMB's revenue", "Beta Holdings Corp.");
    assert.deepEqual(seen, ["AAA; AMB"], "the dropped company is not planned, the kept one is");
    const unclear = completed((await harness({ kind: "unclear", names: ["AMB"] }).run({ ...base, userIntent: "What about AMB's revenue?" })).events);
    assert.equal((unclear.financial_clarification as { question: string }).question, 'Add AMB to the AAA and QTR comparison, or look at AMB alone? Say "add AMB" or "just AMB".');
    const dropping = completed((await harness({ kind: "drop", drop: ["AMB"], add: [] }).run({ ...base, userIntent: "Drop AMB from the revenue table" })).events);
    assert.deepEqual([dropping.clarification, (dropping.financial_clarification as { choices: unknown[] }).choices, seen.length], [true, [], 1], "a company to drop is asked about, never planned");
  });

  await t.test("a planning model that fails after a clarification pick still saves the picked company (#425 review)", async () => {
    const harness = chatHarness(pool, { model: (async () => { throw new Error("provider down"); }) as PlanningModel, researchScope: scopeOver as never });
    const done = await turnWithPick(harness, "Compare revenue for AAA and AMB", "Beta Holdings Corp.");
    assert.deepEqual(done.financial_gap, { reason_code: "planning_unavailable" });
    assert.deepEqual((harness.persisted.at(-1)!.research_scope as { companies: unknown }).companies, [
      { issuer_id: IDS.issuerA, label: "AAA" },
      { issuer_id: IDS.issuerB, label: "Beta Holdings Corp." },
    ]);
  });

  await t.test("a turn that ends in a clarification or a gap before planning reads its question only for its companies (#425)", async () => {
    let reads = 0;
    const readQuestion = async (question: string) => {
      reads += 1;
      return parseProposal(JSON.stringify({ metrics: [], asks: [], turns_off: { facets: [], metrics: [] }, income_items: [], period: { kind: "none" }, companies: { kind: "as_named", names: extractSubjectMentions(question) } }), question);
    };
    // As financialResearchScope does, the scope waits for the reading.
    const researchScope = async (context: Parameters<typeof scopeOver>[0], reading: Promise<unknown>) => {
      await reading;
      return scopeOver(context);
    };
    const ask = async (model: PlanningModel | null, userIntent: string) => {
      reads = 0;
      const done = completed((await chatHarness(pool, { model, readQuestion, researchScope: researchScope as never }).run({ ...base, userIntent })).events);
      return [done.clarification === true ? "clarification" : (done.financial_gap as { reason_code: string } | undefined)?.reason_code ?? "answer", reads];
    };
    assert.deepEqual(await ask(revenueModel(["AAA", "AMB"]), "Compare revenue for AAA and AMB"), ["clarification", 1], "an ambiguous name waits on the reading, which says whether it names a company; the planner asks before any model call");
    assert.deepEqual(await ask(null, "Compare revenue for AAA and BBB in fiscal 2023"), ["planning_unavailable", 1], "no model plans it, and its reading says whether it names a period (#472)");
    assert.deepEqual(await ask(null, "Compare revenue for AAA and BBB"), ["planning_unavailable", 1], "their overview, which needs no model, waits on the reading (#398)");
    assert.deepEqual(await ask(revenueModel(["AAA"]), "Revenue for AAA"), ["answer", 1]);
  });

  await t.test("an answer with no reading of its question says its coverage was not checked, and its scope records it (#425)", { timeout: 60_000 }, async () => {
    const answer = async (readQuestion: () => Promise<ReturnType<typeof parseProposal>>) => {
      const { events } = await chatHarness(pool, { model: revenueModel(["AAA"]), readQuestion, researchScope: scopeOver as never }).run({ ...base, userIntent: "Revenue for AAA" });
      const message = (await db.query(`select blocks, research_scope from chat_messages where message_id = $1`, [completed(events).message_id])).rows[0];
      return [message.blocks.slice(1).map((block: { segments: Array<{ text: string }> }) => block.segments[0]!.text), message.research_scope.coverage_unchecked];
    };
    const unchecked = [["It was not checked whether this answer covers everything the question asks for."], true];
    assert.deepEqual(await answer(async () => null), unchecked, "no reading");
    assert.deepEqual(await answer(async () => { throw new Error("scope model down"); }), unchecked, "a failed reading");
    assert.deepEqual(await answer(() => { throw new Error("no scope reader"); }), unchecked, "a reader that throws before it answers");
    assert.deepEqual(await answer(async () => parseProposal(JSON.stringify({ metrics: [], asks: [], turns_off: { facets: [], metrics: [] }, income_items: [], period: { kind: "none" }, companies: { kind: "as_named", names: [] } }), "")), [[], undefined]);
  });

  await t.test("each name a turn gives is resolved once (#425)", async () => {
    const counts: Record<string, number> = {};
    const counting = async (mention: string) => {
      counts[mention] = (counts[mention] ?? 0) + 1;
      return resolveMention(mention);
    };
    completed((await chatHarness(pool, { model: revenueModel(["AAA", "BBB"]), resolveMention: counting }).run({ ...base, userIntent: "Compare revenue for AAA and BBB" })).events);
    assert.deepEqual(counts, { "Compare revenue for AAA and BBB": 1, AAA: 1, BBB: 1 });
  });

  await t.test("a retry of a saved answer reads neither the question nor its scope again (#425)", async () => {
    const turn = { ...base, turnId: randomUUID(), userIntent: "Revenue for AAA" };
    const first = completed((await chatHarness(pool, { model: revenueModel(["AAA"]) }).run(turn)).events);
    let reads = 0;
    const readQuestion = async () => {
      reads += 1;
      return null;
    };
    const researchScope = async () => {
      reads += 1;
      return null as never;
    };
    const retried = completed((await chatHarness(pool, { model: revenueModel(["AAA"]), readQuestion, researchScope }).run(turn)).events);
    assert.deepEqual([retried.message_id, reads], [first.message_id, 0], "the retry returns the saved answer, reading nothing");
  });

  await t.test("a resolver that fails fails the turn, with nothing planned", async () => {
    const model = revenueModel(["AAA"]);
    const { events } = await chatHarness(pool, { model, resolveMention: async () => { throw new Error("resolver unavailable"); } }).run({ ...base, userIntent: "Revenue for AAA" });
    assert.deepEqual([events.at(-1)!.type, events.at(-1)!.error_code], ["turn.error", "financial_answer_failed"]);
    assert.equal(model.calls, 0);
  });

  await t.test("with one connection, the scope's reads never wait on the client the publication holds", { timeout: 60_000 }, async (st) => {
    const single = await connectedPool(st, databaseUrl(db), { max: 1 });
    const researchScope = async () => {
      await single.query("select 1");
      return null as never;
    };
    const { events } = await chatHarness(single, { model: revenueModel(["AAA"]), researchScope }).run({ ...base, userIntent: "Revenue for AAA" });
    assert.ok(completed(events).message_id);
  });

  await t.test("an explicit subject is planned first, alongside the companies the message names (#138)", async () => {
    const model = revenueModel(["AAA", "BBB"]);
    const { events } = await chatHarness(pool, { model, readQuestion: comparing("BBB") }).run({ ...base, subjectText: "AAA", userIntent: "Compare revenue with BBB" });
    const done = completed(events);
    const message = (await db.query(`select blocks from chat_messages where message_id = $1`, [done.message_id])).rows[0];
    assert.ok(message, `expected a published answer; got ${JSON.stringify(done)}`);
    const [block] = message.blocks;
    assert.deepEqual(block.financial.results.map((result: { disposition: string }) => result.disposition), ["verified", "missing"]);
  });

  await t.test("from a company's page, a question plans after its reading, which decides its lane", async () => {
    const order: string[] = [];
    let release = () => {};
    const readQuestion = () => new Promise<ScopeProposal>((resolve) => {
      const timer = setTimeout(() => release(), 2_000);
      release = () => {
        release = () => {};
        clearTimeout(timer);
        order.push("read");
        resolve(METRIC_READING);
      };
    });
    const revenue = revenueModel(["AAA"]);
    const model = (async (request: Parameters<PlanningModel>[0]) => {
      order.push("planned");
      release();
      return revenue(request);
    }) as PlanningModel;
    const run = async (userIntent: string) => {
      order.length = 0;
      const { events } = await chatHarness(pool, { model, readQuestion }).run({ ...base, subjectText: "AAA", userIntent });
      assert.ok(completed(events).message_id, JSON.stringify(completed(events)));
      return order;
    };
    assert.deepEqual(await run("Revenue in fiscal 2023?"), ["read", "planned"]);
    assert.deepEqual(await run("AAA's Gross Margin?"), ["read", "planned"], "the page's own ticker and a metric's name");
    assert.deepEqual(await run("Compare its revenue with Beta Holdings"), ["read", "planned"]);
    assert.deepEqual(await run("Beta's revenue in fiscal 2023, and this one's?"), ["read", "planned"]);
    assert.deepEqual(await run("Microsoft revenue in fiscal 2023 versus this?"), ["read", "planned"]);
  });

  await t.test("from a company's page, a compared name that matches no company is named in the answer", async () => {
    const { events } = await chatHarness(pool, { model: revenueModel(["AAA"]), readQuestion: comparing("ZZZ") }).run({ ...base, subjectText: "AAA", userIntent: "Compare revenue with ZZZ" });
    const [block, note] = (await db.query(`select blocks from chat_messages where message_id = $1`, [completed(events).message_id])).rows[0].blocks;
    assert.deepEqual(block.financial.results.map((result: { disposition: string }) => result.disposition), ["verified"]);
    assert.deepEqual(note.segments, [{ type: "text", text: "No company matched ZZZ." }]);
  });

  await t.test("an explicit subject with a non-comparative message plans that subject only", async () => {
    const { events } = await chatHarness(pool, { model: revenueModel(["AAA"]) }).run({ ...base, subjectText: "AAA", userIntent: "Revenue for BBB" });
    const done = completed(events);
    const message = (await db.query(`select blocks from chat_messages where message_id = $1`, [done.message_id])).rows[0];
    assert.ok(message, `expected a published answer; got ${JSON.stringify(done)}`);
    assert.deepEqual(message.blocks[0].financial.results.map((result: { disposition: string }) => result.disposition), ["verified"]);
  });

  await t.test("an explicit subject and a mention of the same company are planned once", async () => {
    const model = revenueModel(["ALPHA", "BBB"]);
    const { events } = await chatHarness(pool, { model, readQuestion: comparing("AAA", "BBB") }).run({ ...base, subjectText: "ALPHA", userIntent: "Compare revenue for AAA and BBB" });
    const done = completed(events);
    const message = (await db.query(`select blocks from chat_messages where message_id = $1`, [done.message_id])).rows[0];
    assert.ok(message, `expected a published answer; got ${JSON.stringify(done)}`);
    assert.deepEqual(message.blocks[0].financial.results.map((result: { disposition: string }) => result.disposition), ["verified", "missing"]);
  });

  await t.test("a ticker the resolver names as a listing is planned on its issuer's facts", async () => {
    await db.query(`insert into instruments (instrument_id, issuer_id, asset_type) values ($1::uuid, $2::uuid, 'common_stock') on conflict do nothing`, [INSTRUMENT_A, IDS.issuerA]);
    await db.query(
      `insert into listings (listing_id, instrument_id, mic, ticker, trading_currency, timezone)
       values ($1::uuid, $2::uuid, 'XNAS', 'ALPX', 'USD', 'America/New_York') on conflict do nothing`,
      [LISTING_A, INSTRUMENT_A],
    );
    const asListing = async (mention: string) => mention === "ALPX"
      ? { status: "resolved", subject_ref: { kind: "listing", id: LISTING_A }, display_label: "Alpha Industries Inc. (XNAS)" } as unknown as ChatSubjectPreResolution
      : resolveMention(mention);
    const { events } = await chatHarness(pool, { model: revenueModel(["ALPX"]), resolveMention: asListing }).run({ ...base, userIntent: "Revenue for ALPX" });
    const done = completed(events);
    const message = (await db.query(`select blocks from chat_messages where message_id = $1`, [done.message_id])).rows[0];
    assert.ok(message, `expected a published answer; got ${JSON.stringify(done)}`);
    assert.deepEqual(
      message.blocks[0].financial.results.map((result: { disposition: string; presented: { value?: string } }) => [result.disposition, result.presented.value]),
      [["verified", ORIGINAL_REVENUE]],
    );

    const sameCompany = await chatHarness(pool, { model: revenueModel(["ALPHA"]), resolveMention: asListing }).run({ ...base, subjectText: "ALPHA", userIntent: "Compare revenue with ALPX" });
    const once = (await db.query(`select blocks from chat_messages where message_id = $1`, [completed(sameCompany.events).message_id])).rows[0];
    assert.ok(once, `expected a published answer; got ${JSON.stringify(completed(sameCompany.events))}`);
    assert.deepEqual(once.blocks[0].financial.results.map((result: { disposition: string }) => result.disposition), ["verified"], "the explicit issuer and its listing are planned once");
  });

  await t.test("a listing that no longer exists is asked about, not answered as a gap", async () => {
    const listing = { status: "resolved", subject_ref: { kind: "listing", id: randomUUID() }, display_label: "GONE (XNAS)", handoff: { display_labels: { ticker: "GONE" } } } as unknown as ChatSubjectPreResolution;
    const gone = async (mention: string) => mention === "GONE" ? listing : resolveMention(mention);
    const model = revenueModel(["GONE"]);
    const { events } = await chatHarness(pool, { model, resolveMention: gone }).run({ ...base, userIntent: "Revenue for GONE" });
    const done = completed(events);
    assert.equal(done.clarification, true);
    assert.match((done.financial_clarification as { question: string }).question, /"GONE" did not match a known company/u);
    assert.equal(model.calls, 0);
  });

  await t.test("a missing or failing planning model yields a gap, never the narrative composer", async () => {
    for (const model of [null, (async () => { throw new Error("provider down"); }) as PlanningModel]) {
      const harness = chatHarness(pool, { model, researchScope: scopeOver as never });
      const { events } = await harness.run({ ...base, userIntent: "Compare revenue for AAA and BBB" });
      assert.deepEqual(completed(events).financial_gap, { reason_code: "planning_unavailable" });
      const scope = harness.persisted.at(-1)!.research_scope as { reads: string; companies: unknown };
      assert.deepEqual([scope.reads, scope.companies], ["financial_gap", [{ issuer_id: IDS.issuerA, label: "AAA" }, { issuer_id: IDS.issuerB, label: "BBB" }]]);
    }
  });

  await t.test("a calculation that fails verification is a gap, never the narrative composer", async () => {
    const harness = chatHarness(pool, { model: revenueModel(["CCC"]), researchScope: scopeOver as never });
    assert.deepEqual(completed((await harness.run({ ...base, userIntent: "Revenue for CCC" })).events).financial_gap, { reason_code: "verification_failed" });
    assert.deepEqual((harness.persisted.at(-1)!.research_scope as { companies: unknown }).companies, [{ issuer_id: MISSING_ISSUER, label: "CCC" }]);
  });

  await t.test("a retry that finds its run failed declines with its companies (#425)", async () => {
    // The thread is another user's, so the first attempt reserves the run and cannot publish; the run then fails.
    const input = { threadId: randomUUID(), userId: IDS.owner, turnId: randomUUID(), userIntent: "Revenue for AAA" };
    await db.query(`insert into chat_threads (thread_id, user_id) values ($1, $2)`, [input.threadId, IDS.other]);
    await chatHarness(pool, { model: revenueModel(["AAA"]) }).run(input);
    await db.query(`update financial_runs set execution_state = 'failed', failure_code = 'internal_error' where parent_id = $1`, [input.threadId]);
    await db.query(`update chat_threads set user_id = $2 where thread_id = $1`, [input.threadId, IDS.owner]);
    const harness = chatHarness(pool, { model: revenueModel(["AAA"]), researchScope: scopeOver as never });
    const done = completed((await harness.run(input)).events);
    assert.deepEqual(
      [done.financial_gap, (harness.persisted.at(-1)!.research_scope as { companies: unknown }).companies],
      [{ reason_code: "run_failed" }, [{ issuer_id: IDS.issuerA, label: "AAA" }]],
    );
  });

  await t.test("a retry of a declined turn returns the gap it saved, with no second model call (#425)", async (st) => {
    const persistAssistantMessage = await savingMessages(st, databaseUrl(db));
    const model = declining("segments");
    const harness = () => chatHarness(pool, { model, persistAssistantMessage, researchScope: null });
    const turn = { ...base, turnId: randomUUID(), userIntent: "Break down AAA's revenue by segment" };
    const first = completed((await harness().run(turn)).events);
    // A retry comes on a new run; one after a restart comes on the same.
    for (const runId of [randomUUID(), turn.turnId]) {
      const retried = completed((await harness().run({ ...turn, runId })).events);
      assert.deepEqual([retried.message_id, model.calls], [first.message_id, 1], runId);
    }
    // One whose saved gap cannot be read back completes without it, as a published answer does.
    st.mock.method(console, "error", () => {});
    const failingReads = {
      query: (text: string, values?: unknown[]) => text.includes("from chat_messages m") ? Promise.reject(new Error("Connection terminated unexpectedly")) : pool.query(text, values),
      connect: () => pool.connect(),
    };
    const { events: unreadEvents } = await chatHarness(failingReads as never, { model, persistAssistantMessage, researchScope: null }).run({ ...turn, runId: randomUUID() });
    const unread = completed(unreadEvents);
    assert.deepEqual([unread.message_id, "message" in unread, model.calls], [first.message_id, false, 1]);
    const began = unreadEvents.find((event) => event.type === "block.began")!;
    assert.deepEqual([began.block_id, began.kind], [`financial-gap-${first.message_id}`, "rich_text"], "a gap's block, never an answer's");
    const { rows } = await db.query(`select count(*)::int as n from chat_messages where thread_id = $1 and research_scope->>'reads' = 'financial_gap'`, [threadId]);
    assert.equal(rows[0].n, 0, "no scope was given, so none is saved");
    assert.equal((await db.query(`select count(*)::int as n from chat_messages where message_id = $1`, [first.message_id])).rows[0].n, 1);
  });

  await t.test("a retried turn that asks which company saves its question again, never failing on the first attempt's (#425)", async (st) => {
    const persistAssistantMessage = await savingMessages(st, databaseUrl(db));
    const turn = { ...base, turnId: randomUUID(), userIntent: "Revenue for AMB" };
    for (const runId of [turn.turnId, randomUUID(), turn.turnId]) {
      const done = completed((await chatHarness(pool, { model: revenueModel(["AMB"]), persistAssistantMessage }).run({ ...turn, runId })).events);
      assert.equal(done.clarification, true, runId);
    }
  });

  await t.test("a declined turn's gap never hides the answer another attempt of the turn saved (#425)", async (st) => {
    const persist = await savingMessages(st, databaseUrl(db));
    const raced = { threadId: randomUUID(), userId: IDS.owner, turnId: randomUUID(), userIntent: "Break down AAA's revenue by segment" };
    await db.query(`insert into chat_threads (thread_id, user_id) values ($1, $2)`, [raced.threadId, IDS.owner]);
    const { rows: [snapshot] } = await db.query<{ snapshot_id: string }>(
      `insert into snapshots (subject_refs, as_of, basis, normalization, allowed_transforms)
       values (jsonb_build_array(jsonb_build_object('kind', 'issuer', 'id', $1::text)), now(), 'unadjusted', 'raw', '{}')
       returning snapshot_id::text as snapshot_id`,
      [IDS.issuerA],
    );
    const answerId = financialMessageId(raced.threadId, raced.turnId);
    // The other attempt commits its answer after this one planned its gap, before the gap is saved.
    const persistAssistantMessage: typeof persist = async (message) => {
      await db.query(
        `insert into chat_messages (message_id, thread_id, role, snapshot_id, blocks, content_hash) values ($1::uuid, $2::uuid, 'assistant', $3::uuid, '[{"kind":"financial_answer"}]'::jsonb, 'answer')`,
        [answerId, raced.threadId, snapshot!.snapshot_id],
      );
      return persist(message);
    };
    const done = completed((await chatHarness(pool, { model: declining("segments"), researchScope: scopeOver as never, persistAssistantMessage }).run(raced)).events);
    const { rows } = await db.query(`select message_id::text as message_id, research_scope from chat_messages where thread_id = $1 and role = 'assistant'`, [raced.threadId]);
    assert.deepEqual([done.message_id, rows], [answerId, [{ message_id: answerId, research_scope: null }]]);
  });

  await t.test("a turn's answer replaces the gap another attempt of the turn saved (#425)", async () => {
    const turn = { ...base, turnId: randomUUID(), userIntent: "Revenue for AAA" };
    const id = financialMessageId(threadId, turn.turnId);
    const { rows: [snapshot] } = await db.query<{ snapshot_id: string }>(
      `insert into snapshots (subject_refs, as_of, basis, normalization, allowed_transforms) values ('[]'::jsonb, now(), 'unadjusted', 'raw', '{}') returning snapshot_id::text as snapshot_id`,
    );
    // The other attempt saves its gap just after this one looked for the turn's outcome.
    let saved = false;
    const racing = {
      query: async (text: string, values?: unknown[]) => {
        const result = await pool.query(text, values);
        if (!saved && text.includes("from chat_messages where message_id")) {
          saved = true;
          await db.query(
            `insert into chat_messages (message_id, thread_id, role, snapshot_id, blocks, content_hash) values ($1::uuid, $2::uuid, 'assistant', $3::uuid, '[{"kind":"rich_text"}]'::jsonb, 'gap')`,
            [id, threadId, snapshot!.snapshot_id],
          );
        }
        return result;
      },
      connect: () => pool.connect(),
    };
    const done = completed((await chatHarness(racing as never, { model: revenueModel(["AAA"]) }).run(turn)).events);
    const { rows } = await db.query(`select blocks->0->>'kind' as kind from chat_messages where message_id = $1`, [id]);
    assert.deepEqual([done.message_id, rows], [id, [{ kind: "financial_answer" }]]);
    // The thread points at the answer's snapshot, not the gap's it replaced.
    const { rows: [pointers] } = await db.query(
      `select t.latest_snapshot_id::text as thread, m.snapshot_id::text as answer from chat_threads t join chat_messages m on m.thread_id = t.thread_id where m.message_id = $1`,
      [id],
    );
    assert.equal(pointers.thread, pointers.answer);
  });

  await t.test("a turn about a company reaches the engine; one about none, or whose reading asks for evidence or market data alone, the analyst (#398)", async () => {
    const carried = async (ticker: string) => ({ ...(await resolveMention(ticker)), handoff: { display_labels: { ticker } } }) as unknown as ChatResolvedSubjectPreResolution;
    const [aaa, bbb] = [await carried("AAA"), await carried("BBB")];
    let analystCalls = 0;
    const analyst: ChatAnalystToolRuntime = () => {
      analystCalls += 1;
      return { snapshot_id: randomUUID(), blocks: [], verification: { ok: true } };
    };
    const reading = (proposal: Partial<ScopeProposal>) => async () => ({ ...NO_ASKS, ...proposal });
    // The lane a turn takes, and the companies an engine answer covers.
    const lane = async (userIntent: string, options: Omit<Parameters<typeof chatHarness>[1], "model" | "analyst">, mentions: string[] = []) => {
      const before = analystCalls;
      const done = completed((await chatHarness(pool, { model: revenueModel(mentions), analyst, ...options }).run({ ...base, userIntent })).events);
      if (analystCalls > before) return "analyst";
      assert.equal(done.bundle_id, "financial_answer", userIntent);
      const { rows: [saved] } = await db.query(`select research_scope from chat_messages where message_id = $1`, [done.message_id]);
      return (saved?.research_scope?.companies ?? []).map((company: { label?: string }) => company.label);
    };
    const named = (...names: string[]) => reading({ companies: { kind: "as_named", names } });
    assert.deepEqual(await lane("How is AAA doing?", { readQuestion: named("AAA") }, ["AAA"]), ["AAA"]);
    assert.deepEqual(await lane("Tell me about BBB", { readQuestion: named("BBB") }, ["BBB"]), ["BBB"]);
    // No facet names strategy or management, so it reads as a question about the company.
    assert.deepEqual(await lane("Who runs AAA?", { readQuestion: named("AAA") }, ["AAA"]), ["AAA"]);
    assert.deepEqual(await lane("what is the latest news", { readQuestion: named() }), "analyst");
    assert.deepEqual(await lane("and BBB?", { priorSubjects: async () => [aaa], readQuestion: comparing("BBB") }, ["AAA", "BBB"]), ["AAA", "BBB"]);
    // No reading: the companies the question names still decide, and the planner reads it.
    const unread = async () => {
      throw new Error("the reading model is down");
    };
    assert.deepEqual(await lane("How is AAA doing?", { readQuestion: unread }, ["AAA"]), ["AAA"]);
    assert.deepEqual(await lane("show the evidence", { priorSubjects: async () => [aaa], readQuestion: reading({ asks: new Set(["evidence"]) }) }), "analyst");
    assert.deepEqual(await lane("Revenue for AAA, with the evidence", { readQuestion: reading({ ...METRIC_READING, asks: new Set(["evidence"]), companies: { kind: "as_named", names: ["AAA"] } }) }), "analyst");
    assert.deepEqual(await lane("AAA YTD", { readQuestion: reading({ asks: new Set(["price_window"]), companies: { kind: "as_named", names: ["AAA"] } }) }), "analyst");
    assert.deepEqual(await lane("AAA revenue YTD", { readQuestion: reading({ ...METRIC_READING, asks: new Set(["price_window"]), companies: { kind: "as_named", names: ["AAA"] } }) }, ["AAA"]), ["AAA"]);
    assert.deepEqual(await lane("And what about its revenue?", { priorSubjects: async () => [], readQuestion: reading(METRIC_READING) }), "analyst");
    const dropped = completed((await chatHarness(pool, { model: revenueModel([]), analyst, priorSubjects: async () => [aaa], readQuestion: reading({ companies: { kind: "drop", drop: ["AAA"], add: [] } }) }).run({ ...base, userIntent: "drop AAA" })).events);
    assert.deepEqual((dropped.financial_clarification as { question: string }).question, "Dropping AAA leaves no company to compare. Name the company to look at.");
    assert.deepEqual(await lane("drop BBB", { priorSubjects: async () => [aaa, bbb], readQuestion: reading({ companies: { kind: "drop", drop: ["BBB"], add: [] } }) }, ["AAA"]), ["AAA"]);
  });

  await t.test("a retry of a turn whose engine answer is saved does not read its question again", async () => {
    const turn = { ...base, turnId: randomUUID(), userIntent: "How is AAA doing?" };
    let reads = 0;
    const readQuestion = async () => {
      reads += 1;
      return { ...NO_ASKS, companies: { kind: "as_named" as const, names: ["AAA"] } };
    };
    const first = completed((await chatHarness(pool, { model: revenueModel(["AAA"]), readQuestion }).run(turn)).events);
    const retried = completed((await chatHarness(pool, { model: revenueModel(["AAA"]), readQuestion }).run(turn)).events);
    assert.deepEqual([retried.message_id, reads], [first.message_id, 1]);
  });

  await t.test("a retried turn settles the reading of its question before it takes the run's lease", async () => {
    const thread = randomUUID();
    const turnId = randomUUID();
    // The thread is another user's, so the first attempt reserves the run and cannot publish.
    await db.query(`insert into chat_threads (thread_id, user_id) values ($1, $2)`, [thread, IDS.other]);
    const input = { threadId: thread, userId: IDS.owner, turnId, userIntent: "Revenue for AAA" };
    await chatHarness(pool, { model: revenueModel(["AAA"]) }).run(input);
    const { rows: [reserved] } = await db.query<{ run_id: string }>(`select run_id::text as run_id from financial_runs where parent_id = $1`, [thread]);
    assert.ok(reserved, "the first attempt reserved a run");
    await db.query(`update chat_threads set user_id = $2 where thread_id = $1`, [thread, IDS.owner]);

    let release!: (reading: null) => void;
    let read = false;
    const retry = chatHarness(pool, {
      model: revenueModel(["AAA"]),
      readQuestion: () => {
        read = true;
        return new Promise<null>((resolve) => { release = resolve; });
      },
    }).run(input);
    // The reading decides the lane, so the retry takes the run's lease only once it settles.
    for (let waited = 0; !read; waited += 20) {
      assert.ok(waited < 30_000, "the retry never read its question");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const leased = (await db.query(
      `select 1 from financial_runs where run_id = $1::uuid and lease_owner is not null and lease_expires_at > now()`, [reserved.run_id],
    )).rows.length > 0;
    release(null);
    assert.equal(leased, false, "no lease is held while the reading is out");
    assert.ok(completed((await retry).events).message_id, "the retry publishes once the reading settles");
  });

  await t.test("a retry of a committed turn returns its answer, whatever the thread holds since", async () => {
    const carried = async (ticker: string) => ({ ...(await resolveMention(ticker)), handoff: { display_labels: { ticker } } }) as unknown as ChatResolvedSubjectPreResolution;
    const [aaa, bbb] = [await carried("AAA"), await carried("BBB")];
    const turn = { ...base, turnId: randomUUID(), userIntent: "Drop BBB and show revenue" };
    const dropBbb = changing({ kind: "drop", drop: ["BBB"], add: [] });
    const first = completed((await chatHarness(pool, { model: revenueModel(["AAA"]), priorSubjects: async () => [aaa, bbb], readQuestion: dropBbb }).run(turn)).events);
    // The thread's latest answer is now this turn's own, about AAA alone.
    const model = revenueModel(["AAA"]);
    const retried = completed((await chatHarness(pool, { model, priorSubjects: async () => [aaa], readQuestion: dropBbb }).run(turn)).events);
    assert.deepEqual([retried.message_id, retried.clarification, model.calls], [first.message_id, undefined, 0]);
  });

  await t.test("a turn resumed before its answer was saved saves the scope and notes its first attempt planned", async () => {
    const aaa = { ...(await resolveMention("AAA")), handoff: { display_labels: { ticker: "AAA" } } } as unknown as ChatResolvedSubjectPreResolution;
    const scopeOf = async (context: { subjectPreResolutions?: ReadonlyArray<{ subject_ref: { id: string } }> }) => ({
      route: "financial_answer" as const,
      reads: "financial_answer" as const,
      companies: (context.subjectPreResolutions ?? []).map((subject) => ({ issuer_id: subject.subject_ref.id })),
      peers: false, segments: false, margin_trend: false, margins: false, metrics: [], fiscal_year: null, fiscal_quarter: null, price_window: null, benchmark: false, inherited: [],
    });
    const thread = randomUUID();
    // The thread is another user's, so the first attempt reserves the run and cannot publish.
    await db.query(`insert into chat_threads (thread_id, user_id) values ($1, $2)`, [thread, IDS.other]);
    const turn = { threadId: thread, userId: IDS.owner, turnId: randomUUID(), userIntent: "And what about its revenue?" };
    const harness = () => chatHarness(pool, { model: revenueModel(["AAA"]), priorSubjects: async () => [aaa], researchScope: scopeOf as never });
    await harness().run(turn);
    await db.query(`update chat_threads set user_id = $2 where thread_id = $1`, [thread, IDS.owner]);
    const { events } = await harness().run(turn);
    const message = (await db.query(`select blocks, research_scope from chat_messages where message_id = $1`, [completed(events).message_id])).rows[0];
    assert.deepEqual(
      [message.research_scope.companies, message.blocks.slice(1).map((block: { segments: Array<{ text: string }> }) => block.segments[0]!.text)],
      [[{ issuer_id: IDS.issuerA }], ["AAA is carried from the previous answer."]],
    );
  });

  await t.test("a retried turn resumes its reserved run and publishes one message", async () => {
    const turnId = randomUUID();
    const first = revenueModel(["AAA"]);
    const answered = completed((await chatHarness(pool, { model: first }).run({ ...base, turnId, userIntent: "Revenue for AAA" })).events);
    const second = revenueModel(["AAA"]);
    // A new coordinator stands in for a restarted process that never saw the first commit.
    const retried = completed((await chatHarness(pool, { model: second }).run({ ...base, turnId, userIntent: "Revenue for AAA" })).events);
    assert.equal(retried.message_id, answered.message_id);
    assert.equal(second.calls, 0, "the retry does not plan again");
    assert.equal((await db.query(`select count(*)::int as n from chat_messages where message_id = $1`, [answered.message_id])).rows[0].n, 1);
  });
});

test("every figure the engine names maps to the chat metric a follow-up reads, or none (#381)", () => {
  // These operations are of the figures they read; every other one is a figure.
  const ofFigures = new Set(["reported_metric", "absolute_change", "percent_change_positive_base", "ratio", "trailing_sum", "threshold", "peer_compare"]);
  const named = Object.keys(OPERATION_REGISTRY).filter((operation) => !ofFigures.has(operation));
  const engine = [...METRIC_CATALOG_V1.keys(), ...named].sort();
  assert.deepEqual(Object.keys(SCOPE_METRICS).sort(), engine);
  const unread = Object.values(SCOPE_METRICS).filter((key) => key !== null && proposedMetric(key, null, null)?.available !== true);
  assert.deepEqual(unread, []);
});

// The Call in chat (ADR 0005, ADR 0006, #604): "Make a Call on AAPL" certifies
// the inputs from SEC-ingested facts, a stored close and the cover count,
// then seals one Call block that declines its stance under rule 1 and shows
// what the price requires at today's multiple. An input outcome declines it
// under rule 0 instead. A factual answer never carries a Call or its wording.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import type { Client } from "pg";
import { dockerAvailable, workspaceRoot } from "../../../db/test/docker-pg.ts";
import { ADVICE_WORDS, callModelOperations, DEFAULT_CALL_SETTINGS, STANCE_WORDS, type CallContent, type CallContentV1 } from "../../financial-core/src/index.ts";
import { createEvidenceFinancialPort } from "../../financial-engine/src/evidence-adapter.ts";
import { buildDeterministicPlan, type PlanningModel } from "../../financial-engine/src/planner.ts";
import type { FinancialPool } from "../../financial-engine/src/ports.ts";
import { publishRequest } from "../../financial-engine/src/request.ts";
import { IDS } from "../../financial-engine/test/db-fixtures.ts";
import { createSecBackedStatementRepository } from "../../fundamentals/src/sec-facts-repository.ts";
import { secCompanyFetcher } from "../../fundamentals/test/fakes.ts";
import { mergeIssuerAway } from "../../fundamentals/test/issuer-merge-fixture.ts";
import { aaplCallInputs } from "../../fundamentals/test/sec-call-inputs-fixture.ts";
import { POLYGON_MARKET_SOURCE_ID } from "../../market/src/provider-sources.ts";
import { callBlockHash, verifyCalls, type CallBlock } from "../../snapshot/src/call.ts";
import { publishCall } from "../src/call.ts";
import { chatAuthority } from "../src/financial-runtime.ts";
import { listChatMessagesForThread } from "../src/messages.ts";
import type { ChatSubjectPreResolution } from "../src/subjects.ts";
import { chatDatabase, chatHarness, completed, resolveMention } from "./financial-fixtures.ts";

// Monday 10:00 in New York: Friday 2026-11-06's close is the latest.
const CUTOFF = "2026-11-09T15:00:00.000Z";
const FINVIZ = "00000000-0000-4000-a000-0000000000f5";

type Issuer = Readonly<{ ticker: string; issuer: string; listing: string; cik: number; accession: string }>;
const issuer = (ticker: string, index: number, cik: number, accession: string): Issuer => ({
  ticker, cik, accession, issuer: `5c000000-0000-4000-8000-0000000000${index}1`, listing: `5c000000-0000-4000-8000-0000000000${index}e`,
});
const AAPL = issuer("AAPL", 1, 320193, "0000320193-26-000026");
// AAPL's inputs under other filers: one with no consensus capture, one with no cover count, one whose capex is tagged only as productive assets, as NVIDIA's is,
// and one whose operating cash flow is tagged only for continuing operations.
const NOCN = issuer("NOCN", 2, 900002, "0000900002-26-000026");
const NOSH = issuer("NOSH", 3, 900003, "0000900003-26-000026");
const NVDA = issuer("NVDA", 4, 1045810, "0001045810-26-000026");
const CONT = issuer("CONT", 8, 900008, "0000900008-26-000026");
// AAPL's inputs, its splits checked a week later, so a Call then binds its shares and finds Friday's close a week old.
const STAL = issuer("STAL", 5, 900005, "0000900005-26-000026");
// AAPL's inputs, its last close Wednesday 2026-11-25, the day before Thanksgiving, and its splits checked on Friday.
const HOLI = issuer("HOLI", 6, 900006, "0000900006-26-000026");
// AAPL's inputs, its 10-K downloaded at 20:00 New York on 2026-11-09, already 2026-11-10 in UTC.
const EVEN = issuer("EVEN", 7, 900007, "0000900007-26-000026");
const ISSUERS = [AAPL, NOCN, NOSH, NVDA, CONT, STAL, HOLI, EVEN];

const resolve = (mention: string): Promise<ChatSubjectPreResolution> => {
  const company = ISSUERS.find((entry) => entry.ticker === mention);
  return company
    ? Promise.resolve({ status: "resolved", subject_ref: { kind: "issuer", id: company.issuer }, display_label: company.ticker, handoff: { display_labels: { ticker: company.ticker } } } as unknown as ChatSubjectPreResolution)
    : resolveMention(mention);
};

// A copy with every string's accession replaced; the lossless parser's number tokens are kept as they are.
function withAccession(value: unknown, accession: string): unknown {
  if (typeof value === "string") return value.replaceAll(AAPL.accession, accession);
  if (Array.isArray(value)) return value.map((entry) => withAccession(entry, accession));
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, withAccession(entry, accession)]));
  }
  return value;
}

// AAPL's companyfacts as another filer's: its accession, and without the cover count or with a figure under another tag when asked.
function filerFacts(company: Issuer, change: { shares?: false; retag?: readonly [from: string, to: string] } = {}): unknown {
  const facts = withAccession(aaplCallInputs(), company.accession) as { cik: unknown; facts: { "us-gaap": Record<string, unknown>; dei: Record<string, unknown> } };
  facts.cik = company.cik;
  if (change.shares === false) delete facts.facts.dei.EntityCommonStockSharesOutstanding;
  if (change.retag) {
    const [from, to] = change.retag;
    facts.facts["us-gaap"][to] = facts.facts["us-gaap"][from];
    delete facts.facts["us-gaap"][from];
  }
  return facts;
}

async function seedIssuer(db: Client, pool: FinancialPool, company: Issuer, facts: unknown, consensus: boolean, splitsCheckedAt = "2026-11-09T12:00:00Z", closedAt = "2026-11-06T21:00:00Z", publishedAt = "2026-11-09T06:00:00.000Z"): Promise<void> {
  await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, $2, $3)`, [company.issuer, `${company.ticker} Inc.`, String(company.cik)]);
  await db.query(`insert into instruments (instrument_id, issuer_id, asset_type) values ($1, $1, 'common_stock')`, [company.issuer]);
  await db.query(`insert into listings (listing_id, instrument_id, mic, ticker, trading_currency, timezone) values ($1, $2, 'XNAS', $3, 'USD', 'America/New_York')`, [company.listing, company.issuer, company.ticker]);
  await db.query(`insert into listing_split_coverage (listing_id, checked_at, source_id) values ($1, $2, $3)`, [company.listing, splitsCheckedAt, POLYGON_MARKET_SOURCE_ID]);
  await db.query(
    `insert into price_observations (listing_id, source_id, kind, price_text, currency, observed_at, known_at, fetched_at, body_sha256)
     values ($1, $2, 'session_close', '342.37', 'USD', $4::timestamptz, $4::timestamptz + interval '15 minutes', $4::timestamptz + interval '15 minutes', $3)`,
    [company.listing, POLYGON_MARKET_SOURCE_ID, "d".repeat(64), closedAt],
  );
  const statements = createSecBackedStatementRepository(pool, {
    fetcher: secCompanyFetcher(() => facts, { completed_at: publishedAt }),
    sourceId: randomUUID(),
    logger: { warn: () => {} },
  });
  assert.ok(await statements.find({ issuer_id: company.issuer, family: "income", basis: "as_reported", fiscal_year: 2026, fiscal_period: "FY" }));
  if (consensus) {
    await db.query(
      `insert into consensus_captures (issuer_id, listing_id, source_id, captured_on, retrieved_at, field_key, raw_label, raw_value, value, unit)
       values ($1, $2, $3, '2026-11-09', '2026-11-09T00:30:00Z', 'eps_growth_next_5y', 'EPS next 5Y', '8.18%', 8.18, 'percent')`,
      [company.issuer, company.listing, FINVIZ],
    );
  }
}

/** A planning model that drafts AAPL's FY2026 free cash flow, publishing only the result. */
const freeCashFlowModel: PlanningModel = (async () => ({
  model: "stub-model",
  text: JSON.stringify({
    outcome: "ready",
    subjects: [{ slot_id: "a", mention: "AAPL" }],
    operations: [
      { node_id: "ocf", operation: "reported_metric", subject_slot: "a", metric_key: "operating_cash_flow", period: { kind: "fiscal_period", fiscal_year: 2026, fiscal_period: "FY" } },
      { node_id: "capex", operation: "reported_metric", subject_slot: "a", metric_key: "capex", period: { kind: "fiscal_period", fiscal_year: 2026, fiscal_period: "FY" } },
      { node_id: "fcf", operation: "free_cash_flow", operating_cash_flow: "ocf", capex: "capex" },
    ],
    outputs: [{ output_id: "out_fcf", node_id: "fcf" }],
    thresholds: [],
  }),
})) as unknown as PlanningModel;

test("the Call in chat", { timeout: 600_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for chat Call coverage");
    return;
  }
  const { db, pool } = await chatDatabase(t, "chat-call");
  await db.query(await readFile(join(workspaceRoot, "db", "seed", "metrics.sql"), "utf8"));
  await db.query(
    `insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at) values ($1, 'polygon_market', 'market_data', 'primary', 'licensed', now()), ($2, 'finviz_dev', 'market_data', 'tertiary', 'licensed', now())
     on conflict (source_id) do nothing`,
    [POLYGON_MARKET_SOURCE_ID, FINVIZ],
  );
  await seedIssuer(db, pool, AAPL, aaplCallInputs(), true);
  await seedIssuer(db, pool, NOCN, filerFacts(NOCN), false);
  await seedIssuer(db, pool, NOSH, filerFacts(NOSH, { shares: false }), true);
  await seedIssuer(db, pool, NVDA, filerFacts(NVDA, { retag: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"] }), true);
  await seedIssuer(db, pool, CONT, filerFacts(CONT, { retag: ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"] }), true);
  await seedIssuer(db, pool, STAL, filerFacts(STAL), true, "2026-11-16T12:00:00Z");
  await seedIssuer(db, pool, HOLI, filerFacts(HOLI), true, "2026-11-27T12:00:00Z", "2026-11-25T21:00:00Z");
  await seedIssuer(db, pool, EVEN, filerFacts(EVEN), true, undefined, "2026-11-09T21:00:00Z", "2026-11-10T01:00:00.000Z");

  const ask = async (question: string, options: { clock?: string; turnId?: string; threadId?: string; model?: PlanningModel } = {}) => {
    const threadId = options.threadId ?? randomUUID();
    if (!options.threadId) await db.query(`insert into chat_threads (thread_id, user_id) values ($1, $2)`, [threadId, IDS.owner]);
    const harness = chatHarness(pool, { model: options.model ?? null, resolveMention: resolve, clock: () => new Date(options.clock ?? CUTOFF) });
    const done = completed((await harness.run({ threadId, userId: IDS.owner, userIntent: question, ...(options.turnId ? { turnId: options.turnId } : {}) })).events);
    const message = (await listChatMessagesForThread(pool, { thread_id: threadId, user_id: IDS.owner }))!.messages.find((candidate) => candidate.message_id === done.message_id)!;
    return { threadId, message, block: (message.blocks as unknown as CallBlock[])[0]! };
  };
  const rows = (call: CallContent | CallContentV1) => [...call.facts, ...call.assumptions, ...call.requires].map((row) => [row.id, row.kind, row.basis.length > 0, row.figure.text]);

  await t.test("AAPL: a sealed Call shows 36.15x and 7.3% a year, labels every row, and declines under rule 1", async () => {
    const { threadId, message, block } = await ask("Make a Call on AAPL");
    assert.equal(block.kind, "call");
    assert.deepEqual(message.block_proofs[block.id], { evidence: "unknown", calculation: "not_verified", public_by_cutoff: "unknown" }, "a Call claims nothing");
    const call = block.call;
    assert.deepEqual([call.call_date, call.subject.label, call.settings], ["2026-11-09", "AAPL", { required_return: "0.1", margin_of_safety: "1.25", bear_loss_limit: "0.25", near_band: "0.1" }]);
    assert.deepEqual(rows(call), [
      ["free_cash_flow", "deterministic_result", true, "USD 136,056,000,000"],
      ["net_cash", "deterministic_result", true, "USD 56,824,000,000"],
      ["stock_based_compensation", "reported_fact", true, "USD 13,789,000,000"],
      ["shares_outstanding", "reported_fact", true, "14,532,182,000 shares"],
      ["share_price", "market_observation", true, "USD 342.37 per share"],
      ["required_return", "owner_policy", true, "10%"],
      ["exit_multiple", "deterministic_result", true, "36.15x"],
      // No closes are captured here; financial-call-anchor.test.ts anchors AAPL's ten fiscal years.
      ["anchored_exit_multiple", "agent_assumption", true, "Not anchored: no closes are captured for the listing by the Call's cutoff."],
      ["share_change", "agent_assumption", true, "0.277% a year"],
      ["bear_case", "agent_assumption", true, "Not anchored"],
      ["required_growth", "deterministic_result", true, "7.3% a year"],
      ["required_growth_anchored", "deterministic_result", true, "Not computed: the exit multiple is not anchored."],
      ["consensus", "attributed_consensus", true, "8.18%"],
    ]);
    assert.deepEqual(call.facts.map((row) => row.citations.map((citation) => citation.text)), [
      ["10-K 0000320193-26-000026, period ended 2026-09-26, public by 2026-11-09"],
      ["10-K 0000320193-26-000026, period ended 2026-09-26, public by 2026-11-09"],
      ["10-K 0000320193-26-000026, period ended 2026-09-26, public by 2026-11-09"],
      ["0000320193-26-000026, cover date 2026-10-23, public by 2026-11-09"],
      ["Close on 2026-11-06"],
    ]);
    assert.deepEqual([call.stance.kind, call.stance.rule, call.stance.reasons.map((reason) => reason.cites)], ["declined", 1, ["anchored_exit_multiple", "bear_case"]]);
    const stored = (await db.query(`select call_date::text, settings, inputs_fingerprint, content_hash from calls where snapshot_id = $1`, [block.snapshot_id])).rows;
    assert.deepEqual(stored, [{ call_date: "2026-11-09", settings: call.settings, inputs_fingerprint: call.inputs.fingerprint, content_hash: callBlockHash(block) }]);
    assert.deepEqual(await verifyCalls([block], threadId, pool), [], "the seal regenerates the stored block");
    const text = JSON.stringify(call).replaceAll(/required return/giu, "");
    assert.equal(ADVICE_WORDS.test(text), false, `advice wording: ${ADVICE_WORDS.exec(text)?.[0]}`);
  });

  await t.test("the seal fails a tampered Call", async () => {
    const { threadId, block } = await ask("What's your call on AAPL?");
    const tampered = { ...block, call: { ...block.call, requires: [{ ...block.call.requires[0]!, figure: { kind: "value", text: "9.9% a year" } }, ...block.call.requires.slice(1)] } };
    assert.deepEqual(await verifyCalls([tampered as CallBlock], threadId, pool), [{ block_id: block.id, reason: "block" }]);
    const settings = { ...block, call: { ...block.call, settings: { ...block.call.settings, required_return: "0" } } };
    assert.deepEqual(await verifyCalls([settings as CallBlock], threadId, pool), [{ block_id: block.id, reason: "request" }]);
    assert.deepEqual(await verifyCalls([block], randomUUID(), pool), [{ block_id: block.id, reason: "inputs" }], "another thread's certificate");
  });

  await t.test("a Call saved before #605 (call.v1) regenerates as it was saved, so its seal still holds", async () => {
    // Its inputs as chat published them then (de724754): the model's nodes alone, and their six outputs.
    const threadId = randomUUID();
    await db.query(`insert into chat_threads (thread_id, user_id) values ($1, $2)`, [threadId, IDS.owner]);
    const turnId = randomUUID();
    const authority = chatAuthority(IDS.owner, threadId, turnId);
    const outcome = await publishRequest(pool, {
      authority,
      request_key: turnId,
      plan: async () => buildDeterministicPlan({
        plan_id: randomUUID(),
        origin: { kind: "chat_request", ref: `chat:${threadId}:${turnId}` },
        knowledge_cutoff: CUTOFF,
        cutoff_timezone: "UTC",
        reporting_basis: "as_restated",
        freshness_max_age_days: null,
        authority,
        parent_limits: {},
        max_model_calls: 0,
        requested_subjects: [{ mention: "AAPL", resolution: { status: "resolved", subject_ref: { kind: "issuer", id: AAPL.issuer }, label: "AAPL" } }],
        publication_unit_kind: "chat_section",
      }, {
        subjects: [{ slot_id: "a", mention: "AAPL" }],
        operations: callModelOperations("a"),
        outputs: ["free_cash_flow", "net_cash", "stock_based_compensation", "market_cap", "market_cap_px", "market_cap_shares"].map((node) => ({ output_id: `out_${node}`, node_id: node })),
        thresholds: [],
      }),
      evidence: createEvidenceFinancialPort,
      persistParent: async () => {},
    });
    assert.equal(outcome.status, "driven");
    const unit = (await db.query(`select snapshot_id::text as snapshot_id from financial_run_units where run_id = $1::uuid and state = 'sealed'`, [outcome.status === "driven" ? outcome.run_id : null])).rows[0];
    const messageId = randomUUID();
    assert.equal(await publishCall(pool, { thread_id: threadId, user_id: IDS.owner, message_id: messageId, inputs_snapshot_id: unit.snapshot_id, settings: DEFAULT_CALL_SETTINGS }), "saved");
    const message = (await listChatMessagesForThread(pool, { thread_id: threadId, user_id: IDS.owner }))!.messages.find((candidate) => candidate.message_id === messageId)!;
    const block = (message.blocks as unknown as CallBlock[])[0]!;
    // What main's test asserted of this Call.
    assert.equal(block.call.version, "call.v1");
    assert.deepEqual(rows(block.call), [
      ["free_cash_flow", "deterministic_result", true, "USD 136,056,000,000"],
      ["net_cash", "deterministic_result", true, "USD 56,824,000,000"],
      ["stock_based_compensation", "reported_fact", true, "USD 13,789,000,000"],
      ["shares_outstanding", "reported_fact", true, "14,532,182,000 shares"],
      ["share_price", "market_observation", true, "USD 342.37 per share"],
      ["required_return", "owner_policy", true, "10%"],
      ["exit_multiple", "deterministic_result", true, "36.15x"],
      ["share_change", "agent_assumption", true, "0.277% a year"],
      ["required_growth", "deterministic_result", true, "7.3% a year"],
      ["consensus", "attributed_consensus", true, "8.18%"],
    ]);
    assert.deepEqual([block.call.stance.rule, block.call.stance.reasons.map((reason) => reason.cites)], [1, ["exit_multiple"]]);
    assert.deepEqual(await verifyCalls([block], threadId, pool), [], "the seal regenerates the call.v1 block");
  });

  await t.test("a retry of a Call turn returns the saved Call and seals nothing more", async () => {
    const turnId = randomUUID();
    const first = await ask("Give me your opinion on AAPL", { turnId });
    const count = async () => Number((await db.query(`select count(*)::int as n from calls`)).rows[0]!.n);
    const before = await count();
    const again = await ask("Give me your opinion on AAPL", { turnId, threadId: first.threadId });
    assert.equal(again.message.message_id, first.message.message_id);
    assert.deepEqual(again.block, first.block);
    assert.equal(await count(), before);
  });

  await t.test("NVDA-style capex certifies: the Call is AAPL's, and free cash flow's basis names the productive-assets concept (#731)", async () => {
    const { threadId, block } = await ask("Make a Call on NVDA");
    const { call } = block;
    assert.deepEqual(call.facts[0]!.figure, { kind: "value", text: "USD 136,056,000,000" });
    assert.equal(
      call.facts[0]!.basis,
      "free_cash_flow.v1: operating cash flow less capex, as reported in the latest 10-K. Capex is filed as PaymentsToAcquireProductiveAssets, which may include purchased intangibles as well as PP&E.",
    );
    assert.deepEqual(call.requires.map((row) => row.figure.text), ["7.3% a year", "8.18%"]);
    assert.equal(call.stance.rule, 1);
    assert.deepEqual(await verifyCalls([block], threadId, pool), [], "the seal regenerates the scoped basis");
  });

  await t.test("continuing-operations OCF declines under rule 0: free cash flow is blocked_dependency, and row 3 names it", async () => {
    const { call } = (await ask("Make a Call on CONT")).block;
    assert.deepEqual(call.facts[0]!.figure, { kind: "outcome", outcome: "blocked_dependency", reason_code: "blocked_by_dependency", text: "Not certified: blocked_dependency (blocked_by_dependency)" });
    assert.deepEqual([call.stance.rule, call.stance.reasons.map((reason) => reason.cites)], [0, ["free_cash_flow"]]);
    assert.equal(call.requires[0]!.figure.text, "Not computed. Free cash flow: Not certified: blocked_dependency (blocked_by_dependency)");
  });

  await t.test("missing shares decline under rule 0", async () => {
    const { call } = (await ask("Make a Call on NOSH")).block;
    assert.equal(call.facts[3]!.figure.kind, "outcome");
    assert.deepEqual([call.stance.rule, call.stance.reasons.map((reason) => reason.cites)], [0, ["shares_outstanding"]]);
  });

  await t.test("a close older than the last session declines under rule 0 with the engine's stale_input", async () => {
    const { call } = (await ask("Make a Call on STAL", { clock: "2026-11-16T15:00:00.000Z" })).block;
    assert.equal(call.call_date, "2026-11-16");
    assert.deepEqual(call.stance.reasons, [{ cites: "share_price", text: "Share price: Not certified: missing (stale_input)" }]);
  });

  await t.test("with no consensus within 7 days the row says so, and the Call is otherwise AAPL's", async () => {
    const { call } = (await ask("Make a Call on NOCN")).block;
    assert.deepEqual(call.requires.map((row) => row.figure.text), ["7.3% a year", "Not computed: the exit multiple is not anchored.", "no consensus within 7 days"]);
    assert.equal(call.stance.rule, 1);
  });

  await t.test("a stored Call is never rewritten, and erasing its inputs' certificate erases it (0082)", async () => {
    const { threadId, message, block } = await ask("Make a Call on NOCN");
    await assert.rejects(db.query(`update calls set call_date = '2026-01-01' where snapshot_id = $1`, [block.snapshot_id]), /append-only/);
    await db.query(`delete from snapshot_financial_runs where snapshot_id = $1`, [block.call.inputs.snapshot_id]);
    const left = await db.query(
      `select (select count(*)::int from calls where snapshot_id = $1) as calls, (select count(*)::int from snapshots where snapshot_id = $1) as snapshots,
              (select count(*)::int from chat_messages where message_id = $2) as messages`,
      [block.snapshot_id, message.message_id],
    );
    assert.deepEqual(left.rows, [{ calls: 0, snapshots: 0, messages: 0 }]);
    assert.equal((await listChatMessagesForThread(pool, { thread_id: threadId, user_id: IDS.owner }))!.messages.some((entry) => entry.message_id === message.message_id), false);
  });

  await t.test("a consensus captured after the cutoff, on the Call date, leaves the sealed Call as it was", async () => {
    const { threadId, block } = await ask("Make a Call on NOCN");
    await db.query(
      `insert into consensus_captures (issuer_id, listing_id, source_id, captured_on, retrieved_at, field_key, raw_label, raw_value, value, unit)
       values ($1, $2, $3, '2026-11-09', '2026-11-09T20:00:00Z', 'eps_growth_next_5y', 'EPS next 5Y', '9.5%', 9.5, 'percent')`,
      [NOCN.issuer, NOCN.listing, FINVIZ],
    );
    assert.deepEqual(await verifyCalls([block], threadId, pool), []);
  });

  await t.test("a factual answer carries no Call and no stance wording", async () => {
    const { message } = await ask("What was AAPL's free cash flow for FY2026?", { model: freeCashFlowModel });
    const kinds = (message.blocks as Array<{ kind: string }>).map((block) => block.kind);
    assert.deepEqual([kinds[0], kinds.includes("call")], ["financial_answer", false]);
    const text = JSON.stringify(message.blocks);
    assert.equal(STANCE_WORDS.test(text), false);
  });

  await t.test("the morning after Thanksgiving, Wednesday's close is the latest session's, so the Call is not declined for it (#611)", async () => {
    const { call } = (await ask("Make a Call on HOLI", { clock: "2026-11-27T15:00:00.000Z" })).block;
    assert.deepEqual([call.call_date, call.facts[4]!.figure.text, call.facts[4]!.citations.map((citation) => citation.text)], ["2026-11-27", "USD 342.37 per share", ["Close on 2026-11-25"]]);
    assert.deepEqual([call.stance.rule, call.stance.reasons.map((reason) => reason.cites)], [1, ["anchored_exit_multiple", "bear_case"]]);
  });

  await t.test("a Call made at 21:00 in New York is dated that day, as is a last trade at 20:30 there (#614)", async () => {
    await db.query(
      `insert into price_observations (listing_id, source_id, kind, price_text, currency, observed_at, known_at, fetched_at, body_sha256)
       values ($1, $2, 'last_trade', '343.10', 'USD', '2026-11-10T01:30:00Z', '2026-11-10T01:30:05Z', '2026-11-10T01:30:05Z', $3)`,
      [AAPL.listing, POLYGON_MARKET_SOURCE_ID, "e".repeat(64)],
    );
    // A former listing in another zone does not move the Call off its active listing's calendar.
    await db.query(
      `with former as (insert into instruments (issuer_id, asset_type) values ($1, 'common_stock') returning instrument_id)
       insert into listings (instrument_id, mic, ticker, trading_currency, timezone, active_from, active_to)
       select instrument_id, 'XLON', 'AAPL-L', 'GBP', 'Europe/London', '2010-01-01', '2020-01-01' from former`,
      [AAPL.issuer],
    );
    const { block } = await ask("Make a Call on AAPL", { clock: "2026-11-10T02:00:00.000Z" });
    const call = block.call;
    assert.deepEqual([call.call_date, call.facts[4]!.figure.text, call.facts[4]!.citations.map((citation) => citation.text)], ["2026-11-09", "USD 343.1 per share", ["Close on 2026-11-09"]]);
    assert.deepEqual([call.stance.rule, call.requires[2]!.figure.text], [1, "8.18%"]);
    const stored = (await db.query(`select call_date::text from calls where snapshot_id = $1`, [block.snapshot_id])).rows;
    assert.deepEqual(stored, [{ call_date: "2026-11-09" }]);
  });

  await t.test("a 10-K public at 20:00 in New York is cited public by that day, never after the Call (#614)", async () => {
    const { call } = (await ask("Make a Call on EVEN", { clock: "2026-11-10T02:00:00.000Z" })).block;
    const publicBy = call.facts.flatMap((fact) => fact.citations.map((citation) => citation.text)).filter((text) => text.includes("public by"));
    assert.ok(publicBy.length > 0);
    assert.deepEqual([call.call_date, [...new Set(publicBy.map((text) => text.slice(-10)))]], ["2026-11-09", ["2026-11-09"]]);
  });

  // Last: AAPL's issuer is gone after it.
  await t.test("a Call on an issuer merged away since regenerates as it was sealed (#705)", async () => {
    const { threadId, block } = await ask("Make a Call on AAPL");
    await mergeIssuerAway(pool, AAPL.issuer, "Apple Inc.");
    assert.deepEqual(await verifyCalls([block], threadId, pool), []);
  });
});

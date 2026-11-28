// A figure segment seals only when its text states what its sources hold (#800): the seal
// reads each source's value and recomputes the verdict, so a chat bug cannot show a wrong
// number behind a verified link.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { DERIVATIONS } from "../../financial-core/src/figure-check.ts";
import { presentationHash, type FinancialAnswerContent } from "../../financial-core/src/index.ts";
import type { QueryExecutor } from "../../shared/src/http.ts";
import { extractBlockRefs, verifySnapshotSeal, type SnapshotVerificationInput, type VerifierBlock } from "../src/snapshot-verifier.ts";

// NVIDIA's latest-quarter answer on the golden data, recorded from a real stack with
// DEV_CAPTURE_FILE (services/app/src/dev.ts).
type Message = { blocks?: Array<{ kind: string; financial?: FinancialAnswerContent }> };
const REPLAY = JSON.parse(readFileSync(new URL("../../app/fixtures/golden-conversation.replay.json", import.meta.url), "utf8")) as { exchanges: Array<{ body: string }> };
const ANSWER = REPLAY.exchanges
  .flatMap(({ body }) => (body.startsWith("{") ? ((JSON.parse(body) as { messages?: Message[] }).messages ?? []) : []))
  .flatMap((message) => message.blocks ?? [])
  .find((block) => block.kind === "financial_answer")!.financial!;

const snapshotId = "00000000-0000-4000-8000-000000000001";
const threadId = "00000000-0000-4000-8000-000000000009";
const subjectId = "00000000-0000-4000-8000-000000000002";
const claimId = "00000000-0000-4000-8000-000000000004";
const sourceId = "00000000-0000-4000-8000-000000000006";
const factId = "00000000-0000-4000-8000-000000000003";
const unsealedClaim = "00000000-0000-4000-8000-000000000044";
const AS_OF = "2026-04-29T00:00:00.000Z";
const CLAIM_TEXT = "Data center revenue was a record $51.2 billion, up 66% from a year ago.";

// A result source as the answer's result shows it: its text and its period's.
function result(measure: string, period: string) {
  const found = ANSWER.results.find((entry) => ANSWER.labels[entry.measure_label_id]!.text === measure && ANSWER.labels[entry.period_label_id]!.text.startsWith(period))!;
  return { ref_kind: "result", ref_id: found.result_id, format: found.presented.text, period: ANSWER.labels[found.period_label_id]!.text };
}
const REVENUE = result("Revenue", "Q4 FY2026");
const REVENUE_YEAR_AGO = result("Revenue", "Q4 FY2025");
const GROSS_PROFIT = result("Gross profit", "Q4 FY2026");
const CLAIM_SOURCE = (numeral: number) => ({ ref_kind: "claim", ref_id: claimId, format: CLAIM_TEXT, numeral });

// The seal's transaction as the ledger holds it: the answer's certificate in this thread,
// and each claim's stored text.
type Certificate = { run_id: string; unit_id: string; presentation_hash: string; result_ids: string[] };
const CERTIFICATE: Certificate = { run_id: ANSWER.run_id, unit_id: ANSWER.unit_id, presentation_hash: presentationHash(ANSWER), result_ids: ANSWER.results.map((entry) => entry.result_id) };
function ledger({ certificates = [CERTIFICATE], claims = [{ claim_id: claimId, text: CLAIM_TEXT }] }: { certificates?: Certificate[]; claims?: Array<{ claim_id: string; text: string }> } = {}): QueryExecutor & { sql: string[] } {
  const sql: string[] = [];
  return {
    sql,
    query: (async (text: string, params?: unknown[]) => {
      sql.push(text);
      if (text.includes("from snapshot_financial_runs")) {
        assert.deepEqual(params?.[0], threadId, "certificates are read for this thread");
        return { rows: certificates };
      }
      if (text.includes("from claims")) return { rows: claims.filter((claim) => (params?.[0] as string[]).includes(claim.claim_id)) };
      return { rows: [] };
    }) as QueryExecutor["query"],
  };
}

function seal(segments: ReadonlyArray<object>, input: Partial<SnapshotVerificationInput> = {}, db: QueryExecutor | null = ledger()) {
  const block = {
    id: "answer",
    kind: "rich_text",
    snapshot_id: snapshotId,
    data_ref: { kind: "rich_text", id: "answer" },
    source_refs: [sourceId],
    as_of: AS_OF,
    segments: [{ type: "text", text: "Revenue was " }, ...segments],
  } as VerifierBlock;
  const disclosure = {
    id: "required-disclosures",
    kind: "disclosure",
    snapshot_id: snapshotId,
    data_ref: { kind: "disclosure_policy", id: "required" },
    source_refs: [sourceId],
    as_of: AS_OF,
    disclosure_tier: "filing_time",
    items: [`Filing-derived values are shown on a filing-time basis as of ${AS_OF}; later restatements or market updates may differ.`],
  };
  return verifySnapshotSeal({
    snapshot_id: snapshotId,
    thread_id: threadId,
    manifest: { subject_refs: [{ kind: "listing", id: subjectId }], fact_refs: [], claim_refs: [claimId], event_refs: [], document_refs: [], source_ids: [sourceId], as_of: AS_OF, basis: "reported", normalization: "raw" },
    blocks: [block, disclosure],
    claims: [{ claim_id: claimId, source_id: sourceId }],
    sources: [{ source_id: sourceId }],
    financial_answers: [ANSWER],
    ...input,
  }, db ?? undefined);
}
const SEALED = { ok: true, failures: [] };
const codes = async (sealed: ReturnType<typeof seal>) => (await sealed).failures.map((failure) => failure.reason_code);

test("a figure its result source shows seals, and one it does not show fails figure_text_mismatch", async () => {
  assert.equal(REVENUE.format, "$62.1B");
  assert.deepEqual(await seal([{ type: "figure", text: "$62.1B", sources: [REVENUE] }]), SEALED);
  const wrong = await seal([{ type: "figure", text: "$72.1B", sources: [REVENUE] }]);
  assert.deepEqual(wrong.failures, [{
    reason_code: "figure_text_mismatch",
    details: { block_id: "answer", text: "$72.1B", verdict: "wrong", expected: { kind: "amount", value: 62_100_000_000 } },
  }]);
});

test("a figure one digit off seals only when it is marked near", async () => {
  assert.deepEqual(await seal([{ type: "figure", text: "$62.2B", sources: [REVENUE], near: true }]), SEALED);
  assert.deepEqual(await codes(seal([{ type: "figure", text: "$62.2B", sources: [REVENUE] }])), ["figure_text_mismatch"]);
  assert.deepEqual(await seal([{ type: "figure", text: "about $62B", sources: [REVENUE], near: true }]), SEALED, "a hedged figure is near");
  assert.deepEqual(await codes(seal([{ type: "figure", text: "$64.1B", sources: [REVENUE], near: true }])), ["figure_text_mismatch"], "near is one and a half digits, not more");
});

// #816: the seal recomputes the verdict, so a round figure far off its source cannot seal.
test("a round figure more than a tenth off its source fails, as matched or as near", async () => {
  assert.deepEqual(await codes(seal([{ type: "figure", text: "$100B", sources: [REVENUE] }])), ["figure_text_mismatch"]);
  assert.deepEqual(await codes(seal([{ type: "figure", text: "$200B", sources: [REVENUE], near: true }])), ["figure_text_mismatch"]);
  assert.deepEqual(await seal([{ type: "figure", text: "$60B", sources: [REVENUE] }]), SEALED, "a round figure within a tenth seals");
});

test("a result source whose format or period differs from its result fails, as a result ref does in chat", async () => {
  const misread = await seal([{ type: "figure", text: "$62.1B", sources: [{ ...REVENUE, format: "$62.0B" }] }]);
  assert.deepEqual(misread.failures, [{
    reason_code: "result_ref_format_mismatch",
    details: { block_id: "answer", result_id: REVENUE.ref_id, format: "$62.0B", period: REVENUE.period, shown: "$62.1B", shown_period: REVENUE.period },
  }]);
  assert.deepEqual(await codes(seal([{ type: "figure", text: "$62.1B", sources: [{ ...REVENUE, period: "Q3 FY2026" }] }])), ["result_ref_format_mismatch"]);
  assert.deepEqual(await codes(seal([{ type: "struck", text: "$72.1B", reason: "the sources give $62.1B", sources: [{ ...REVENUE, format: "$62.0B" }] }])), ["result_ref_format_mismatch"], "a struck figure's sources too");
});

test("a figure on a result no certified answer of the message holds cannot be checked, so it fails", async () => {
  assert.equal(CERTIFICATE.presentation_hash, "543aa19e82c323c17187b0a1e856163b172d9f7fcacb0240e3f0896fec14bd01", "the hash the golden answer was sealed with");
  const unverified = (reason: string, source = REVENUE) => [{ reason_code: "figure_source_unverified", details: { block_id: "answer", ref_kind: source.ref_kind, ref_id: source.ref_id, reason } }];
  assert.deepEqual((await seal([{ type: "figure", text: "$62.1B", sources: [REVENUE] }], { financial_answers: [] })).failures, unverified("not_certified"));
  assert.deepEqual((await seal([{ type: "figure", text: "$62.1B", sources: [REVENUE] }], {}, ledger({ certificates: [] }))).failures, unverified("not_certified"), "no certificate in this thread");
  assert.deepEqual((await seal([{ type: "figure", text: "$62.1B", sources: [REVENUE] }], {}, ledger({ certificates: [{ ...CERTIFICATE, result_ids: [] }] }))).failures, unverified("not_certified"), "a result its certificate does not hold");
  assert.deepEqual((await seal([{ type: "figure", text: "$62.1B", sources: [REVENUE] }], {}, null)).failures, unverified("no_transaction_client"));
  assert.deepEqual((await seal([{ type: "struck", text: "$72.1B", reason: "the sources give $62.1B", sources: [REVENUE] }], {}, null)).failures, unverified("no_transaction_client"), "a struck figure's result source too");
});

// Codex on #812: the seal took the caller's answer at its word, so an answer altered in
// both its presentation and the figure sealed. Its values count only when a certificate of
// this thread holds the answer's presentation hash.
test("an answer altered after its certificate verifies no figure, with a client or without", async () => {
  const altered: FinancialAnswerContent = {
    ...ANSWER,
    results: ANSWER.results.map((entry) =>
      entry.result_id === REVENUE.ref_id && entry.presented.kind === "value"
        ? { ...entry, presented: { ...entry.presented, text: "$72.1B", value: "72100000000", full_text: "USD 72100000000" } }
        : entry
    ),
  };
  const figure = { type: "figure", text: "$72.1B", sources: [{ ...REVENUE, format: "$72.1B" }] };
  const failures = async (db: QueryExecutor | null) => (await seal([figure], { financial_answers: [altered] }, db)).failures;
  assert.deepEqual(await failures(ledger()), [{ reason_code: "figure_source_unverified", details: { block_id: "answer", ref_kind: "result", ref_id: REVENUE.ref_id, reason: "not_certified" } }]);
  assert.deepEqual(await failures(null), [{ reason_code: "figure_source_unverified", details: { block_id: "answer", ref_kind: "result", ref_id: REVENUE.ref_id, reason: "no_transaction_client" } }]);
});

test("a seal with no figure on a result or a claim reads neither certificates nor claims", async () => {
  const db = ledger();
  assert.deepEqual(await seal([{ type: "text", text: "nothing linked" }], {}, db), SEALED);
  assert.deepEqual(db.sql.filter((text) => text.includes("snapshot_financial_runs") || text.includes("from claims")), []);
});

test("a derived figure seals on what its sources recompute to", async () => {
  const growth = (text: string) => ({ type: "figure", text, sources: [REVENUE_YEAR_AGO, REVENUE], derivation: "growth", operands: [{ add: [0], subtract: [], over: null }, { add: [1], subtract: [], over: null }] });
  assert.deepEqual(await seal([growth("58%")]), SEALED);
  assert.deepEqual(await codes(seal([growth("68%")])), ["figure_text_mismatch"]);
  const margin = { type: "figure", text: "74.4%", sources: [GROSS_PROFIT, REVENUE], derivation: "margin", operands: [{ add: [0], subtract: [], over: null }, { add: [1], subtract: [], over: null }] };
  assert.deepEqual(await seal([margin]), SEALED);
  assert.deepEqual(await codes(seal([{ type: "figure", text: "$46.2B", sources: [GROSS_PROFIT], derivation: "sum" }])), ["figure_text_mismatch"], "a derivation without operands");
  assert.deepEqual(await codes(seal([{ type: "figure", text: "$62.1B", sources: [REVENUE], operands: [{ add: [0], subtract: [], over: null }] }])), ["figure_text_mismatch"], "operands without a derivation");
  assert.deepEqual(await codes(seal([{ ...margin, operands: [{ add: [0], subtract: [], over: null }, { add: [2], subtract: [], over: null }] }])), ["figure_text_mismatch"], "an operand past its sources");
  assert.deepEqual(await codes(seal([{ ...margin, derivation: "average" }])), ["invalid_verifier_input"]);
});

test("a figure on a claim's stated figure reads the sealed claim's text", async () => {
  assert.deepEqual(await seal([{ type: "figure", text: "$51.2B", sources: [CLAIM_SOURCE(1)] }]), SEALED);
  assert.deepEqual(await seal([{ type: "figure", text: "66%", sources: [CLAIM_SOURCE(2)] }]), SEALED);
  assert.deepEqual(await codes(seal([{ type: "figure", text: "$51.2B", sources: [CLAIM_SOURCE(2)] }])), ["figure_text_mismatch"]);
  assert.deepEqual(await codes(seal([{ type: "figure", text: "$51.2B", sources: [CLAIM_SOURCE(3)] }])), ["figure_text_mismatch"], "a claim states two figures");
  assert.deepEqual(await codes(seal([{ type: "figure", text: "$51.2B", sources: [CLAIM_SOURCE(1)] }], {}, ledger({ claims: [] }))), ["figure_source_unverified"], "no stored claim");
  assert.deepEqual(await codes(seal([{ type: "figure", text: "$51.2B", sources: [CLAIM_SOURCE(1)] }], {}, null)), ["figure_source_unverified"], "no client to read it with");
});

test("a claim source reads the claim's stored text, never the caller's", async () => {
  const stored = ledger({ claims: [{ claim_id: claimId, text: "Data center revenue was a record $41.2 billion, up 66% from a year ago." }] });
  const callerText = { claims: [{ claim_id: claimId, source_id: sourceId, text: CLAIM_TEXT } as never] };
  assert.deepEqual(await codes(seal([{ type: "figure", text: "$51.2B", sources: [CLAIM_SOURCE(1)] }], callerText, stored)), ["figure_text_mismatch"]);
});

test("a figure's sources bind like refs: a claim the snapshot did not seal fails", async () => {
  const figure = { type: "figure", text: "$51.2B", sources: [{ ...CLAIM_SOURCE(1), ref_id: unsealedClaim }] };
  assert.deepEqual(extractBlockRefs({ kind: "rich_text", segments: [figure, { type: "struck", text: "$1B", reason: "r", sources: [{ ref_kind: "fact", ref_id: factId, format: "$1B" }] }] } as unknown as VerifierBlock), [
    { ref_kind: "claim", ref_id: unsealedClaim },
    { ref_kind: "fact", ref_id: factId },
  ]);
  assert.deepEqual(await codes(seal([figure])), ["missing_claim_ref", "figure_source_unverified"]);
});

test("a figure whose text states no one figure fails", async () => {
  assert.deepEqual(await codes(seal([{ type: "figure", text: "$62.1B and $46.2B", sources: [REVENUE] }])), ["figure_text_mismatch"]);
  assert.deepEqual(await codes(seal([{ type: "figure", text: "record", sources: [REVENUE] }])), ["figure_text_mismatch"]);
  assert.deepEqual(await codes(seal([{ type: "figure", text: "$62.1B", sources: [] }])), ["figure_text_mismatch"]);
  assert.deepEqual(await codes(seal([{ type: "figure", text: "$62.1B", sources: [REVENUE, GROSS_PROFIT] }])), ["figure_text_mismatch"], "a reported figure has one source");
});

test("a struck figure states the wrong number, so only its sources are checked", async () => {
  assert.deepEqual(await seal([{ type: "struck", text: "$72.1B", reason: "the sources give $62.1B", sources: [REVENUE] }]), SEALED);
  assert.deepEqual(await seal([{ type: "struck", text: "up 30%", reason: "the filing gives 66%" }]), SEALED);
});

test("the block schema's derivations are the figure check's", () => {
  const schema = JSON.parse(readFileSync(new URL("../../../spec/finance_research_block_schema.json", import.meta.url), "utf8")) as { $defs: { FigureSegment: { properties: { derivation: { enum: string[] } } } } };
  assert.deepEqual(schema.$defs.FigureSegment.properties.derivation.enum, DERIVATIONS);
});

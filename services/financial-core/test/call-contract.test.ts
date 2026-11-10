// The Call contract (#604): what assembleCall produces, in its block,
// satisfies the canonical block schema, and the web's fixture is this output.
// Regenerate it with `UPDATE_FIXTURES=1 node --experimental-strip-types
// --test test/call-contract.test.ts`.

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { assembleCall, DEFAULT_CALL_SETTINGS, type CallContent, type CallEvidence } from "../src/index.ts";

const SCHEMA = JSON.parse(readFileSync(new URL("../../../spec/finance_research_block_schema.json", import.meta.url), "utf8"));
const WEB_FIXTURE = new URL("../../../web/src/blocks/call.fixture.json", import.meta.url);

const TEN_K = "00000000-0000-4000-8000-0000000000a1";
const PRICE_SOURCE = "00000000-0000-4000-8000-0000000000b1";
const CONSENSUS_SOURCE = "00000000-0000-4000-8000-0000000000c1";
const filing = (period_end: string) => ({ source_id: TEN_K, accession: "0000320193-26-000026", period_end, date: "2026-11-03" });

// ADR 0006's AAPL probe: F0, N and SBC from the FY2026 10-K, the cover count, and Friday's close.
const AAPL: CallEvidence = {
  call_date: "2026-11-09",
  subject: { issuer_id: "00000000-0000-4000-8000-0000000000d1", label: "AAPL" },
  settings: DEFAULT_CALL_SETTINGS,
  inputs: { snapshot_id: "00000000-0000-4000-8000-0000000000e1", run_id: "00000000-0000-4000-8000-0000000000e2", unit_id: "call", fingerprint: "f".repeat(64) },
  figures: {
    free_cash_flow: { kind: "value", value: "136056000000", currency: "USD" },
    net_cash: { kind: "value", value: "56824000000", currency: "USD" },
    stock_based_compensation: { kind: "value", value: "13789000000", currency: "USD" },
    shares_outstanding: { kind: "value", value: "14532182000", currency: null },
    share_price: { kind: "value", value: "342.37", currency: "USD" },
    market_cap: { kind: "value", value: "4975383151340", currency: "USD" },
  },
  citations: {
    free_cash_flow: [filing("2026-09-26")],
    net_cash: [filing("2026-09-26")],
    stock_based_compensation: [filing("2026-09-26")],
    shares_outstanding: [filing("2026-10-23")],
    share_price: [{ source_id: PRICE_SOURCE, accession: null, period_end: null, date: "2026-11-06" }],
  },
  fiscal_year_end: "2026-09-26",
  price_date: "2026-11-06",
  consensus: [{ source_id: CONSENSUS_SOURCE, captured_on: "2026-11-09", eps_growth_next_5y: "8.18" }],
};

function block(id: string, call: CallContent) {
  return {
    id,
    kind: "call",
    snapshot_id: "22222222-2222-4222-9222-222222222222",
    data_ref: { kind: "call", id },
    source_refs: [TEN_K, PRICE_SOURCE],
    as_of: "2026-11-09T15:00:00.000Z",
    subject_refs: [{ kind: "issuer", id: call.subject.issuer_id }],
    call,
  };
}

test("a Call declined under rule 1 and one under rule 0 satisfy the canonical block schema, and are the web's fixture", () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addSchema(SCHEMA);
  const validate = ajv.getSchema(`${SCHEMA.$id}#/$defs/Block`)!;
  const blocks = [
    block("call-1", assembleCall(AAPL)),
    block("call-2", assembleCall({ ...AAPL, subject: { ...AAPL.subject, label: "NVDA" }, figures: { ...AAPL.figures, free_cash_flow: { kind: "gap", disposition: "blocked_dependency", reason_code: "blocked_by_dependency" } }, consensus: [] })),
  ];
  for (const candidate of blocks) assert.ok(validate(candidate), JSON.stringify(validate.errors));
  assert.equal(validate({ ...blocks[0], title: "Buy" }), false, "no title field");
  assert.equal(validate({ ...blocks[0], call: { ...blocks[0]!.call, verified: true } }), false, "no field beyond the contract");
  assert.equal(validate({ ...blocks[0], call: { ...blocks[0]!.call, stance: { ...blocks[0]!.call.stance, kind: "stated" } } }), false, "only a declined stance");
  const text = `${JSON.stringify(blocks, null, 2)}\n`;
  if (process.env.UPDATE_FIXTURES === "1") writeFileSync(WEB_FIXTURE, text);
  assert.equal(readFileSync(WEB_FIXTURE, "utf8"), text);
});

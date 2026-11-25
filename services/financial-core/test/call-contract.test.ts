// The Call contract (#604): what assembleCall produces, in its block,
// satisfies the canonical block schema, and the web's fixture is this output.
// Regenerate it with `UPDATE_FIXTURES=1 node --experimental-strip-types
// --test test/call-contract.test.ts`.

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { assembleCall, assembleCallV1, assembleCallV2, type CallContent, type CallContentV1, type CallContentV2, type CallEvidenceV2 } from "../src/index.ts";

const SCHEMA = JSON.parse(readFileSync(new URL("../../../spec/finance_research_block_schema.json", import.meta.url), "utf8"));
const WEB_FIXTURE = new URL("../../../web/src/blocks/call.fixture.json", import.meta.url);
// main's web fixture at de724754, byte for byte: the two Calls #604 generated before the exit multiple was anchored (#605).
const V1_FIXTURE = new URL("../../../web/src/blocks/call.v1.fixture.json", import.meta.url);
// main's web fixture at 72a64ec6, byte for byte: the three Calls #605 generated before the base rate.
const V2_FIXTURE = new URL("../../../web/src/blocks/call.v2.fixture.json", import.meta.url);

import { AAPL, PRICE_SOURCE, TEN_K } from "./call-fixtures.ts";

function block(id: string, call: CallContent | CallContentV2 | CallContentV1) {
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

test("a Call that falls short of your hurdle, one declined under rule 0 and one under rule 1 with its exit multiple unanchored satisfy the canonical block schema, and are the web's fixture", () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addSchema(SCHEMA);
  const validate = ajv.getSchema(`${SCHEMA.$id}#/$defs/Block`)!;
  const blocks = [
    block("call-1", assembleCall(AAPL)),
    block("call-2", assembleCall({ ...AAPL, subject: { ...AAPL.subject, label: "NVDA" }, figures: { ...AAPL.figures, free_cash_flow: { kind: "gap", disposition: "blocked_dependency", reason_code: "blocked_by_dependency" } }, consensus: [] })),
    block("call-3", assembleCall({ ...AAPL, subject: { ...AAPL.subject, label: "COST" }, closes: null })),
  ];
  for (const candidate of blocks) assert.ok(validate(candidate), JSON.stringify(validate.errors));
  assert.equal(validate({ ...blocks[0], title: "Buy" }), false, "no title field");
  assert.equal(validate({ ...blocks[0], call: { ...blocks[0]!.call, verified: true } }), false, "no field beyond the contract");
  const { base_rate_table: _table, ...unnamed } = blocks[0]!.call as CallContent;
  assert.equal(validate({ ...blocks[0], call: unnamed }), false, "a call.v3 names the base-rate table it read");
  const stance = blocks[0]!.call.stance;
  assert.equal(stance.kind, "stated", "AAPL states a stance");
  const withStance = (change: Record<string, unknown>) => validate({ ...blocks[0], call: { ...blocks[0]!.call, stance: { ...stance, ...change } } });
  assert.equal(withStance({ rule: 1 }), false, "a stated stance has rule 4, 5 or 6");
  assert.equal(withStance({ text: "Buy." }), false, "a stated stance says only ADR 0005's wording");
  assert.equal(withStance({ not_shown: undefined }), false, "a stated stance names what it does not show");
  assert.equal(withStance({ kind: "declined" }), false, "a declined stance has rule 0 to 3 and no not_shown");
  const text = `${JSON.stringify(blocks, null, 2)}\n`;
  if (process.env.UPDATE_FIXTURES === "1") writeFileSync(WEB_FIXTURE, text);
  assert.equal(readFileSync(WEB_FIXTURE, "utf8"), text);
});

test("a Call saved before #605 still meets the canonical block schema as call.v1, and its inputs regenerate it exactly", () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addSchema(SCHEMA);
  const validate = ajv.getSchema(`${SCHEMA.$id}#/$defs/Block`)!;
  const saved = JSON.parse(readFileSync(V1_FIXTURE, "utf8")) as ReadonlyArray<ReturnType<typeof block>>;
  for (const candidate of saved) assert.ok(validate(candidate), JSON.stringify(validate.errors));
  const { history: _history, closes: _closes, splits: _splits, ...before } = AAPL;
  assert.deepEqual(saved, [
    block("call-1", assembleCallV1(before)),
    block("call-2", assembleCallV1({ ...before, subject: { ...before.subject, label: "NVDA" }, figures: { ...before.figures, free_cash_flow: { kind: "gap", disposition: "blocked_dependency", reason_code: "blocked_by_dependency" } }, consensus: [] })),
  ]);
  const current = block("call-1", assembleCall(AAPL));
  assert.equal(validate({ ...saved[0], call: { ...saved[0]!.call, version: "call.v2" } }), false, "a call.v2 has the anchor's rows");
  assert.equal(validate({ ...saved[0], call: { ...saved[0]!.call, stance: current.call.stance } }), false, "a call.v1 states no stance");
  assert.equal(validate({ ...current, call: { ...current.call, version: "call.v1" } }), false, "a call.v1 has only the rows it had");
});

test("a Call saved before its base rate still meets the canonical block schema as call.v2, and its inputs regenerate it exactly", () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addSchema(SCHEMA);
  const validate = ajv.getSchema(`${SCHEMA.$id}#/$defs/Block`)!;
  const saved = JSON.parse(readFileSync(V2_FIXTURE, "utf8")) as ReadonlyArray<ReturnType<typeof block>>;
  for (const candidate of saved) assert.ok(validate(candidate), JSON.stringify(validate.errors));
  const { base_rates: _rates, figures: { revenue: _revenue, ...figures }, citations: { revenue: _cited, ...citations }, ...rest } = AAPL;
  const before: CallEvidenceV2 = { ...rest, figures, citations };
  assert.deepEqual(saved, [
    block("call-1", assembleCallV2(before)),
    block("call-2", assembleCallV2({ ...before, subject: { ...before.subject, label: "NVDA" }, figures: { ...before.figures, free_cash_flow: { kind: "gap", disposition: "blocked_dependency", reason_code: "blocked_by_dependency" } }, consensus: [] })),
    block("call-3", assembleCallV2({ ...before, subject: { ...before.subject, label: "COST" }, closes: null })),
  ]);
  const current = block("call-1", assembleCall(AAPL));
  assert.equal(validate({ ...saved[0], call: { ...saved[0]!.call, version: "call.v3" } }), false, "a call.v3 has the revenue fact and the base rate");
  assert.equal(validate({ ...saved[0], call: { ...saved[0]!.call, stance: current.call.stance } }), false, "a call.v2 states no stance");
  assert.equal(validate({ ...current, call: { ...current.call, version: "call.v2" } }), false, "a call.v2 has only the rows it had");
});

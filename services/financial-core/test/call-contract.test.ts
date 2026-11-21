// The Call contract (#604): what assembleCall produces, in its block,
// satisfies the canonical block schema, and the web's fixture is this output.
// Regenerate it with `UPDATE_FIXTURES=1 node --experimental-strip-types
// --test test/call-contract.test.ts`.

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { assembleCall, assembleCallV1, type CallContent, type CallContentV1 } from "../src/index.ts";

const SCHEMA = JSON.parse(readFileSync(new URL("../../../spec/finance_research_block_schema.json", import.meta.url), "utf8"));
const WEB_FIXTURE = new URL("../../../web/src/blocks/call.fixture.json", import.meta.url);
// main's web fixture at de724754, byte for byte: the two Calls #604 generated before the exit multiple was anchored (#605).
const V1_FIXTURE = new URL("../../../web/src/blocks/call.v1.fixture.json", import.meta.url);

import { AAPL, PRICE_SOURCE, TEN_K } from "./call-fixtures.ts";

function block(id: string, call: CallContent | CallContentV1) {
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

test("a Call declined under rule 1 with its exit multiple anchored, one with it unanchored, and one under rule 0 satisfy the canonical block schema, and are the web's fixture", () => {
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
  assert.equal(validate({ ...blocks[0], call: { ...blocks[0]!.call, stance: { ...blocks[0]!.call.stance, kind: "stated" } } }), false, "only a declined stance");
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
  assert.equal(validate({ ...current, call: { ...current.call, version: "call.v1" } }), false, "a call.v1 has only the rows it had");
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  CanonicalJsonError,
  HASH_DOMAINS,
  canonicalJson,
  hashCanonical,
  planBindingHash,
  planSemanticHash,
  requestIdentityHash,
} from "../src/canonical.ts";
import { authorityFixture, mutable, OWNER_B, planFixture } from "./fixtures.ts";

function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseKeys(child)]));
}

test("canonical JSON sorts keys, keeps array order, and uses explicit nulls", () => {
  assert.equal(canonicalJson({ b: 1, a: [3, 1, 2], c: null, d: { z: "x", y: true } }), '{"a":[3,1,2],"b":1,"c":null,"d":{"y":true,"z":"x"}}');
  assert.equal(canonicalJson(-0), "0");
  assert.throws(() => canonicalJson({ a: undefined }), CanonicalJsonError);
  assert.throws(() => canonicalJson([1, undefined]), CanonicalJsonError);
  // eslint-disable-next-line no-sparse-arrays
  assert.throws(() => canonicalJson([1, , 3]), CanonicalJsonError);
});

test("canonical JSON rejects non-finite, fractional, unsafe, and non-plain values", () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, 0.1, 9007199254740993, 10n, new Date(0), new Map(), () => 1, Symbol("x")]) {
    assert.throws(() => canonicalJson({ value }), CanonicalJsonError, String(value));
  }
});

test("canonical JSON bounds nesting depth", () => {
  let nested: unknown = "leaf";
  for (let depth = 0; depth < 100; depth += 1) nested = [nested];
  assert.throws(() => canonicalJson(nested), /maximum nesting depth/);
});

test("hashes are domain separated SHA-256 over canonical JSON", () => {
  const value = { b: "2", a: "1" };
  const expected = createHash("sha256").update(`${HASH_DOMAINS.result}\u0000{"a":"1","b":"2"}`).digest("hex");
  assert.equal(hashCanonical("result", value), expected);
  assert.notEqual(hashCanonical("result", value), hashCanonical("computation", value));
});

test("object key reordering retains the semantic hash", () => {
  const plan = planFixture();
  assert.equal(planSemanticHash(reverseKeys(plan) as typeof plan), planSemanticHash(plan));
});

test("persistence IDs and provenance do not change the semantic hash", () => {
  const plan = planFixture();
  const other = mutable(plan);
  other.plan_id = "99999999-9999-4999-8999-999999999999";
  other.origin = { kind: "analyze_section", ref: "memo:section:7" };
  other.planner = { kind: "deterministic", adapter_version: "grid-adapter.v1", model: null, prompt_version: null };
  other.interpretation = { generator_version: "interp.v1", text: "Gross margin for two issuers." };
  other.thresholds[0].attribution = { kind: "saved_thesis_condition", ref: "thesis:9:v2" };
  assert.equal(planSemanticHash(other), planSemanticHash(plan));
});

test("peer display order, thresholds, cutoff, and definitions change the semantic hash", () => {
  const base = planSemanticHash(planFixture());

  const reordered = mutable(planFixture());
  reordered.subjects.members.reverse();
  assert.notEqual(planSemanticHash(reordered), base);

  const threshold = mutable(planFixture());
  threshold.thresholds[0].value = "0.41";
  assert.notEqual(planSemanticHash(threshold), base);

  const cutoff = mutable(planFixture());
  cutoff.time.knowledge_cutoff = "2024-01-16T23:59:59.999-05:00";
  assert.notEqual(planSemanticHash(cutoff), base);

  const definition = mutable(planFixture());
  definition.metric_definitions[0].definition_version = "revenue.v2";
  assert.notEqual(planSemanticHash(definition), base);

  const basis = mutable(planFixture());
  basis.policies.reporting_basis = "as_restated";
  assert.notEqual(planSemanticHash(basis), base);
});

test("two owners never share a binding or request identity because semantic hashes match", () => {
  const plan = planFixture();
  const ownerA = authorityFixture();
  const ownerB = authorityFixture(OWNER_B);
  assert.equal(planSemanticHash(plan), planSemanticHash(mutable(plan)));
  assert.notEqual(planBindingHash(plan, ownerA), planBindingHash(plan, ownerB));
  assert.notEqual(requestIdentityHash(ownerA, "turn-1"), requestIdentityHash(ownerB, "turn-1"));

  const otherParent = mutable(ownerA);
  otherParent.parent.id = "45454545-4545-4545-8545-454545454545";
  assert.notEqual(requestIdentityHash(ownerA, "turn-1"), requestIdentityHash(otherParent, "turn-1"));
  assert.equal(requestIdentityHash(ownerA, "turn-1"), requestIdentityHash(authorityFixture(), "turn-1"));
});

test("binding hash retains persistence IDs", () => {
  const plan = planFixture();
  const renamed = mutable(plan);
  renamed.plan_id = "99999999-9999-4999-8999-999999999999";
  assert.notEqual(planBindingHash(renamed, authorityFixture()), planBindingHash(plan, authorityFixture()));
});

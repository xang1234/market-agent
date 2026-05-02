import test from "node:test";
import assert from "node:assert/strict";

import {
  LicensePolicyError,
  PERMISSIVE_LICENSE_CLASSES,
  EPHEMERAL_LICENSE_CLASSES,
  decideStoragePolicy,
} from "../src/license-policy.ts";

test("permissive license class 'public' → store_blob: true", () => {
  const policy = decideStoragePolicy("public");
  assert.deepEqual(policy, { store_blob: true });
});

test("permissive license class 'licensed' → store_blob: true", () => {
  const policy = decideStoragePolicy("licensed");
  assert.deepEqual(policy, { store_blob: true });
});

test("ephemeral license class 'ephemeral' → store_blob: false with reason", () => {
  const policy = decideStoragePolicy("ephemeral");
  assert.deepEqual(policy, { store_blob: false, reason: "ephemeral_license" });
});

test("unknown license class throws LicensePolicyError (fail-closed)", () => {
  // Catches typos like "publik" or new classes added to a source row
  // without a matching policy entry. Failing closed prevents silent
  // misclassification of restricted content as storeable.
  assert.throws(
    () => decideStoragePolicy("publik"),
    (err: unknown) => err instanceof LicensePolicyError && /unknown license_class "publik"/.test(err.message),
  );
});

test("empty license class throws (sources require a non-empty license_class)", () => {
  // source-repo already validates non-empty on insert; this guards the
  // edge case where a malformed source somehow reaches the policy gate.
  assert.throws(
    () => decideStoragePolicy(""),
    (err: unknown) => err instanceof LicensePolicyError,
  );
});

test("license class is case-sensitive — 'PUBLIC' is not 'public'", () => {
  // Database stores the raw string; a normalization mismatch (e.g. a
  // provider integration that emits "Public" instead of "public") must
  // not silently fall through to a different branch. Throw, force the
  // upstream code to canonicalize.
  assert.throws(
    () => decideStoragePolicy("PUBLIC"),
    (err: unknown) => err instanceof LicensePolicyError,
  );
});

test("PERMISSIVE_LICENSE_CLASSES and EPHEMERAL_LICENSE_CLASSES are disjoint", () => {
  // The policy module's invariant: a class belongs to exactly one set.
  // If they overlap, decideStoragePolicy's branching becomes ambiguous.
  for (const cls of PERMISSIVE_LICENSE_CLASSES) {
    assert.equal(
      EPHEMERAL_LICENSE_CLASSES.includes(cls),
      false,
      `"${cls}" appears in both PERMISSIVE and EPHEMERAL sets`,
    );
  }
});


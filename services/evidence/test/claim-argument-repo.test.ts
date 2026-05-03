import test from "node:test";
import assert from "node:assert/strict";

import {
  CLAIM_ARGUMENT_ROLES,
  createClaimArgument,
  listClaimArgumentsForClaim,
} from "../src/claim-argument-repo.ts";
import type { QueryExecutor } from "../src/types.ts";

const CLAIM_ARGUMENT_ID = "11111111-1111-4111-a111-111111111111";
const CLAIM_ID = "22222222-2222-4222-a222-222222222222";
const SUBJECT_ID = "33333333-3333-4333-a333-333333333333";

function argumentRow(overrides: Record<string, unknown> = {}) {
  return {
    claim_argument_id: CLAIM_ARGUMENT_ID,
    claim_id: CLAIM_ID,
    subject_kind: "issuer",
    subject_id: SUBJECT_ID,
    role: "subject",
    created_at: new Date("2026-05-03T00:00:00.000Z"),
    ...overrides,
  };
}

function recordingDb(rows = [argumentRow()]) {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      queries.push({ text, values });
      return {
        rows: rows as R[],
        command: text.includes("insert") ? "INSERT" : "SELECT",
        rowCount: rows.length,
        oid: 0,
        fields: [],
      };
    },
  };
  return { db, queries };
}

test("createClaimArgument inserts a validated role-bound subject ref", async () => {
  const { db, queries } = recordingDb();

  const argument = await createClaimArgument(db, {
    claim_id: CLAIM_ID,
    subject_kind: "issuer",
    subject_id: SUBJECT_ID,
    role: "subject",
  });

  assert.equal(argument.claim_argument_id, CLAIM_ARGUMENT_ID);
  assert.deepEqual(argument.subject_ref, { kind: "issuer", id: SUBJECT_ID });
  assert.equal(argument.role, "subject");
  assert.match(queries[0]!.text, /insert into claim_arguments/);
  assert.deepEqual(queries[0]!.values, [CLAIM_ID, "issuer", SUBJECT_ID, "subject"]);
});

test("listClaimArgumentsForClaim returns arguments ordered by role and id", async () => {
  const { db, queries } = recordingDb([
    argumentRow({ claim_argument_id: "44444444-4444-4444-a444-444444444444", role: "supplier" }),
    argumentRow({ claim_argument_id: CLAIM_ARGUMENT_ID, role: "subject" }),
  ]);

  const argumentsForClaim = await listClaimArgumentsForClaim(db, CLAIM_ID);

  assert.equal(argumentsForClaim.length, 2);
  assert.equal(argumentsForClaim[0]!.role, "supplier");
  assert.match(queries[0]!.text, /where claim_id = \$1/);
  assert.match(queries[0]!.text, /order by role/);
  assert.match(queries[0]!.text, /claim_argument_id/);
  assert.deepEqual(queries[0]!.values, [CLAIM_ID]);
});

test("listClaimArgumentsForClaim rejects invalid claim IDs before querying", async () => {
  const { db, queries } = recordingDb();

  await assert.rejects(() => listClaimArgumentsForClaim(db, "not-a-uuid"), /claim_id/);

  assert.equal(queries.length, 0);
});

test("listClaimArgumentsForClaim rejects stored roles outside the contract", async () => {
  const { db } = recordingDb([
    argumentRow({ role: "observer" }),
  ]);

  await assert.rejects(() => listClaimArgumentsForClaim(db, CLAIM_ID), /role/);
});

test("createClaimArgument rejects invalid inputs before querying", async () => {
  const { db, queries } = recordingDb();
  const valid = {
    claim_id: CLAIM_ID,
    subject_kind: "issuer" as const,
    subject_id: SUBJECT_ID,
    role: "subject" as const,
  };

  await assert.rejects(() => createClaimArgument(db, { ...valid, claim_id: "not-a-uuid" }), /claim_id/);
  await assert.rejects(() => createClaimArgument(db, { ...valid, subject_kind: "company" as never }), /subject_kind/);
  await assert.rejects(() => createClaimArgument(db, { ...valid, subject_id: "not-a-uuid" }), /subject_id/);
  await assert.rejects(() => createClaimArgument(db, { ...valid, role: "observer" as never }), /role/);

  assert.equal(queries.length, 0);
});

test("CLAIM_ARGUMENT_ROLES pins the P3.4 role contract", () => {
  assert.deepEqual(CLAIM_ARGUMENT_ROLES, [
    "subject",
    "object",
    "customer",
    "supplier",
    "competitor",
    "regulator",
    "beneficiary",
    "constrained_party",
    "affected_party",
  ]);
  assert.equal(Object.isFrozen(CLAIM_ARGUMENT_ROLES), true);
});

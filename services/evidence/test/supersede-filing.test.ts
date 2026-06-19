import { test } from "node:test";
import assert from "node:assert/strict";
import { supersedeFilingArtifacts } from "../src/supersede-filing.ts";
import type { QueryExecutor } from "../src/types.ts";

const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";

function fakeDb(): { db: QueryExecutor; calls: Array<{ text: string; values: unknown[] }> } {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const db = {
    query: async (text: string, values: unknown[] = []) => {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 } as never;
    },
  } as unknown as QueryExecutor;
  return { db, calls };
}

test("supersedeFilingArtifacts soft-supersedes claims, hard-deletes events, marks documents (exact predicate)", async () => {
  const { db, calls } = fakeDb();
  await supersedeFilingArtifacts(db, {
    sourceIds: [S1, S2],
    claimPredicate: { equals: "insider.transaction" },
    eventType: "insider_transaction",
  });
  assert.equal(calls.length, 3, "claims, events, documents");

  // Claims: soft-supersede (stamp superseded_at), predicate bound as $2, idempotent.
  assert.match(calls[0].text, /update claims set superseded_at = now\(\)/i);
  assert.match(calls[0].text, /predicate = \$2/i, "exact predicate uses = with a bound value");
  assert.match(calls[0].text, /reported_by_source_id = any\(\$1::uuid\[\]\)/i);
  assert.match(calls[0].text, /superseded_at is null/i);
  assert.deepEqual(calls[0].values, [[S1, S2], "insider.transaction"]);

  // Events: hard-delete by event_type + jsonb source overlap.
  assert.match(calls[1].text, /delete from events/i);
  assert.match(calls[1].text, /event_type = \$2/i);
  assert.match(calls[1].text, /jsonb_array_elements_text\(source_ids\)/i);
  assert.deepEqual(calls[1].values, [[S1, S2], "insider_transaction"]);

  // Documents: mark superseded (idempotent).
  assert.match(calls[2].text, /update documents set parse_status = 'superseded'/i);
  assert.match(calls[2].text, /parse_status <> 'superseded'/i);
  assert.deepEqual(calls[2].values, [[S1, S2]]);
});

test("supersedeFilingArtifacts uses a LIKE prefix for multi-kind predicates (13F position_change.*)", async () => {
  const { db, calls } = fakeDb();
  await supersedeFilingArtifacts(db, {
    sourceIds: [S1],
    claimPredicate: { prefix: "position_change" },
    eventType: "position_change",
  });
  assert.match(calls[0].text, /predicate like \$2/i, "prefix uses LIKE");
  assert.deepEqual(calls[0].values, [[S1], "position_change.%"], "prefix becomes a LIKE pattern");
  assert.deepEqual(calls[1].values, [[S1], "position_change"]);
});

test("supersedeFilingArtifacts returns the per-step row counts", async () => {
  const { db } = fakeDb();
  const counts = await supersedeFilingArtifacts(db, { sourceIds: [S1], claimPredicate: { equals: "x" }, eventType: "y" });
  assert.deepEqual(counts, { claims: 0, events: 0, documents: 0 });
});

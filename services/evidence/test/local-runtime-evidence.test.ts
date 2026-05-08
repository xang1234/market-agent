import assert from "node:assert/strict";
import test from "node:test";

import { loadVerifierRowsForRefs } from "../src/local-runtime-evidence.ts";

test("loadVerifierRowsForRefs scopes hydrated verifier rows to public or same-user sources", async () => {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const db = {
    async query(text: string, values?: unknown[]) {
      queries.push({ text, values: values ?? [] });
      if (/from sources/i.test(text)) return { rows: [{ source_id: "11111111-1111-4111-8111-111111111111" }] };
      if (/from documents/i.test(text)) {
        return {
          rows: [
            {
              document_id: "22222222-2222-4222-8222-222222222222",
              source_id: "11111111-1111-4111-8111-111111111111",
            },
          ],
        };
      }
      if (/from claims/i.test(text)) {
        return {
          rows: [
            {
              claim_id: "33333333-3333-4333-8333-333333333333",
              source_id: "11111111-1111-4111-8111-111111111111",
            },
          ],
        };
      }
      return { rows: [] };
    },
  };

  const rows = await loadVerifierRowsForRefs(db, {
    source_ids: ["11111111-1111-4111-8111-111111111111"],
    document_refs: ["22222222-2222-4222-8222-222222222222"],
    claim_refs: ["33333333-3333-4333-8333-333333333333"],
    user_id: "44444444-4444-4444-8444-444444444444",
  });

  assert.deepEqual(rows.sources, [{ source_id: "11111111-1111-4111-8111-111111111111" }]);
  assert.equal(queries.length, 3);
  assert.deepEqual(queries.map((query) => query.values[1]), [
    "44444444-4444-4444-8444-444444444444",
    "44444444-4444-4444-8444-444444444444",
    "44444444-4444-4444-8444-444444444444",
  ]);
  assert.match(queries[0].text, /user_id is null/i);
  assert.match(queries[1].text, /join sources/i);
  assert.match(queries[2].text, /join sources/i);
});

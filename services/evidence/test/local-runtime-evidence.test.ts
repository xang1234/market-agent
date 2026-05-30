import assert from "node:assert/strict";
import test from "node:test";

import {
  GDELT_ARTICLE_DISCOVERY_PROVIDER,
  GDELT_DISCOVERY_DISCLOSURE,
  GDELT_DISCOVERY_LICENSE_CLASS,
  GDELT_DISCOVERY_TRUST_TIER,
} from "../src/gdelt-source.ts";
import {
  loadLocalRuntimeEvidence,
  loadVerifierRowsForRefs,
} from "../src/local-runtime-evidence.ts";

const SUBJECT_ID = "55555555-5555-4555-a555-555555555555";

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

test("loadLocalRuntimeEvidence carries GDELT discovery disclosure with claim citations", async () => {
  const db = {
    async query(text: string) {
      assert.match(text, /s\.provider/i);
      assert.match(text, /s\.license_class/i);
      assert.match(text, /s\.canonical_url/i);
      return {
        rows: [
          {
            claim_id: "11111111-1111-4111-a111-111111111111",
            document_id: "22222222-2222-4222-a222-222222222222",
            source_id: "33333333-3333-4333-a333-333333333333",
            text_canonical: "Acme Robotics lifted guidance after a Reuters-reported order.",
            predicate: "guidance_update",
            polarity: "positive",
            trust_tier: GDELT_DISCOVERY_TRUST_TIER,
            license_class: GDELT_DISCOVERY_LICENSE_CLASS,
            provider: GDELT_ARTICLE_DISCOVERY_PROVIDER,
            source_canonical_url: "https://reuters.com/markets/acme-robotics",
            confidence: "0.72",
            document_title: "Acme Robotics wins order as shares rise",
            published_at: "2026-05-29T12:30:00.000Z",
            effective_time: "2026-05-29T12:30:00.000Z",
            raw_blob_id: "ephemeral:33333333-3333-4333-a333-333333333333",
          },
        ],
      };
    },
  };

  const evidence = await loadLocalRuntimeEvidence(db, {
    subject_refs: [{ kind: "issuer", id: SUBJECT_ID }],
  });

  assert.equal(evidence.claims[0]?.provider, GDELT_ARTICLE_DISCOVERY_PROVIDER);
  assert.equal(evidence.claims[0]?.license_class, GDELT_DISCOVERY_LICENSE_CLASS);
  assert.equal(evidence.claims[0]?.source_canonical_url, "https://reuters.com/markets/acme-robotics");
  assert.equal(evidence.claims[0]?.source_disclosure, GDELT_DISCOVERY_DISCLOSURE);
  assert.doesNotMatch(JSON.stringify(evidence), /raw_blob_id|raw_text|FULL ARTICLE BODY/i);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  listThemeMembershipRationalesBySubject,
} from "../src/theme-repo.ts";

const THEME_ID = "11111111-1111-4111-8111-111111111111";
const MEMBERSHIP_ID = "22222222-2222-4222-8222-222222222222";
const SUBJECT_ID = "33333333-3333-4333-8333-333333333333";
const CLAIM_A = "44444444-4444-4444-8444-444444444444";
const CLAIM_B = "55555555-5555-4555-8555-555555555555";

test("listThemeMembershipRationalesBySubject joins theme mode/spec with membership rationale", async () => {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const db = {
    async query(text: string, values?: unknown[]) {
      queries.push({ text, values: values ?? [] });
      return {
        rows: [
          {
            theme_membership_id: MEMBERSHIP_ID,
            theme_id: THEME_ID,
            theme_name: "AI infrastructure",
            theme_description: "Suppliers tied to AI infrastructure buildout",
            membership_mode: "inferred",
            membership_spec: { cluster_ids: ["cluster-ai"], min_confidence: 0.7 },
            subject_kind: "issuer",
            subject_id: SUBJECT_ID,
            score: "2",
            rationale_claim_ids: [CLAIM_A, CLAIM_B],
            effective_at: "2026-05-07T00:00:00.000Z",
            expires_at: null,
          },
        ],
      };
    },
  };

  const page = await listThemeMembershipRationalesBySubject(
    db,
    { kind: "issuer", id: SUBJECT_ID },
    { asOf: "2026-05-08T00:00:00.000Z", limit: 5 },
  );

  assert.equal(page.truncated, false);
  assert.equal(page.rows[0]?.theme_name, "AI infrastructure");
  assert.equal(page.rows[0]?.membership_mode, "inferred");
  assert.equal(page.rows[0]?.rationale_supported, true);
  assert.deepEqual(page.rows[0]?.rationale_claim_ids, [CLAIM_A, CLAIM_B]);
  assert.deepEqual(queries[0]?.values, ["issuer", SUBJECT_ID, "2026-05-08T00:00:00.000Z", 6]);
  assert.match(queries[0]?.text ?? "", /join themes t/i);
  assert.match(queries[0]?.text ?? "", /t\.membership_mode/i);
});

test("listThemeMembershipRationalesBySubject marks manual memberships as unsupported rationale", async () => {
  const db = {
    async query() {
      return {
        rows: [
          {
            theme_membership_id: MEMBERSHIP_ID,
            theme_id: THEME_ID,
            theme_name: "Manual watch theme",
            theme_description: null,
            membership_mode: "manual",
            membership_spec: null,
            subject_kind: "issuer",
            subject_id: SUBJECT_ID,
            score: null,
            rationale_claim_ids: [],
            effective_at: "2026-05-07T00:00:00.000Z",
            expires_at: null,
          },
        ],
      };
    },
  };

  const page = await listThemeMembershipRationalesBySubject(db, { kind: "issuer", id: SUBJECT_ID });

  assert.equal(page.rows[0]?.membership_mode, "manual");
  assert.equal(page.rows[0]?.rationale_supported, false);
  assert.deepEqual(page.rows[0]?.rationale_claim_ids, []);
});

test("listThemeMembershipRationalesBySubject exposes explicit rule-based claim rationale", async () => {
  const db = {
    async query() {
      return {
        rows: [
          {
            theme_membership_id: MEMBERSHIP_ID,
            theme_id: THEME_ID,
            theme_name: "Rule-backed quality",
            theme_description: null,
            membership_mode: "rule_based",
            membership_spec: { rules: [{ field: "gross_margin", op: "gt", value: 0.4 }] },
            subject_kind: "issuer",
            subject_id: SUBJECT_ID,
            score: "0.91",
            rationale_claim_ids: [CLAIM_A],
            effective_at: "2026-05-07T00:00:00.000Z",
            expires_at: null,
          },
        ],
      };
    },
  };

  const page = await listThemeMembershipRationalesBySubject(db, { kind: "issuer", id: SUBJECT_ID });

  assert.equal(page.rows[0]?.membership_mode, "rule_based");
  assert.equal(page.rows[0]?.rationale_supported, true);
  assert.deepEqual(page.rows[0]?.rationale_claim_ids, [CLAIM_A]);
});

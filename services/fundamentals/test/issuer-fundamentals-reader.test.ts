import test from "node:test";
import assert from "node:assert/strict";
import type { QueryExecutor } from "../../evidence/src/types.ts";
import { loadRecentIssuerFundamentals } from "../src/issuer-fundamentals-reader.ts";

const ISSUER = { kind: "issuer" as const, id: "11111111-1111-4111-8111-111111111111" };

function recordingDb(rows: unknown[]): {
  db: QueryExecutor;
  calls: Array<{ text: string; values: unknown[] }>;
} {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const db: QueryExecutor = {
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values: values ?? [] });
      return { rows, rowCount: rows.length } as never;
    },
  };
  return { db, calls };
}

test("loadRecentIssuerFundamentals filters on channel + displayable verification, binding the defaults", async () => {
  const { db, calls } = recordingDb([]);
  await loadRecentIssuerFundamentals(db, ISSUER, { limit: 24 });

  assert.equal(calls.length, 1);
  const { text, values } = calls[0];
  // fact_id is selected for provenance (fra-eegq).
  assert.match(text, /f\.fact_id::text as fact_id/);
  // The two new eligibility predicates are present...
  assert.match(text, /entitlement_channels \? \$2/);
  assert.match(text, /verification_status = any\(\$3::verification_status\[\]\)/);
  // ...alongside the pre-existing ones.
  assert.match(text, /f\.method = 'reported'/);
  assert.match(text, /f\.superseded_by is null/);
  assert.match(text, /f\.invalidated_at is null/);
  // Params: issuer id, default channel 'app', displayable statuses, limit.
  assert.deepEqual(values, [
    ISSUER.id,
    "app",
    ["authoritative", "corroborated"],
    24,
  ]);
});

test("loadRecentIssuerFundamentals honors an explicit channel", async () => {
  const { db, calls } = recordingDb([]);
  await loadRecentIssuerFundamentals(db, ISSUER, { channel: "export", limit: 5 });
  assert.deepEqual(calls[0].values, [
    ISSUER.id,
    "export",
    ["authoritative", "corroborated"],
    5,
  ]);
});

test("loadRecentIssuerFundamentals coerces numeric/Date columns and preserves provenance", async () => {
  const { db } = recordingDb([
    {
      fact_id: "99999999-9999-4999-8999-999999999999",
      metric_key: "revenue",
      display_name: "Revenue",
      value_num: "190872000", // pg returns numeric as string
      value_text: null,
      unit: "currency",
      currency: "USD",
      fiscal_year: 2021,
      fiscal_period: "FY",
      as_of: new Date("2026-05-08T16:57:05.951Z"),
      source_id: "00000000-0000-4000-a000-000000000001",
    },
  ]);
  const [fact] = await loadRecentIssuerFundamentals(db, ISSUER, { limit: 24 });
  assert.equal(fact.fact_id, "99999999-9999-4999-8999-999999999999");
  assert.equal(fact.value_num, 190872000);
  assert.equal(fact.as_of, "2026-05-08T16:57:05.951Z");
  assert.equal(fact.display_name, "Revenue");
  assert.equal(fact.source_id, "00000000-0000-4000-a000-000000000001");
});

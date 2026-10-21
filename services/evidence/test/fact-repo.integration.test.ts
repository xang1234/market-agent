import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { bootstrapDatabase, connectedClient, dockerAvailable, workspaceRoot } from "../../../db/test/docker-pg.ts";
import { createFact, listFactsForEgress, supersedeFact, type FactInput, type FactRow } from "../src/fact-repo.ts";

test("fact rows read back from Postgres carry period dates as YYYY-MM-DD strings (#421)", { skip: !dockerAvailable(), timeout: 120_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "fact-repo-period-dates");
  const db = await connectedClient(t, databaseUrl);
  await db.query(await readFile(join(workspaceRoot, "db", "seed", "metrics.sql"), "utf8"));
  await db.query(await readFile(join(workspaceRoot, "db", "seed", "sources.sql"), "utf8"));
  const { rows: [{ metric_id }] } = await db.query<{ metric_id: string }>(
    `select metric_id::text as metric_id from metrics where metric_key = 'revenue'`,
  );
  const input: FactInput = {
    subject_kind: "issuer",
    subject_id: "22222222-2222-4222-a222-222222222222",
    metric_id,
    period_kind: "fiscal_q",
    period_start: "2026-01-01",
    period_end: "2026-03-31",
    fiscal_year: 2026,
    fiscal_period: "Q1",
    value_num: 100,
    unit: "USD",
    currency: "USD",
    as_of: "2026-05-03T00:00:00Z",
    observed_at: "2026-05-03T00:00:00Z",
    source_id: "00000000-0000-4000-a000-000000000001",
    // vendor, not reported: supersedeFact cannot yet supersede a reported fiscal fact (#447).
    method: "vendor",
    verification_status: "authoritative",
    freshness_class: "filing_time",
    coverage_level: "full",
    confidence: 1,
  };

  const created = await createFact(db, input);
  const { new_fact, superseded_fact } = await supersedeFact(db, created.fact_id, { ...input, value_num: 120 });
  const egressed = await listFactsForEgress(db, { fact_ids: [new_fact.fact_id], channel: "app" });
  const periods = (fact: FactRow) => [fact.period_start, fact.period_end];
  const quarter = ["2026-01-01", "2026-03-31"];
  assert.deepEqual(
    { created: periods(created), new_fact: periods(new_fact), superseded_fact: periods(superseded_fact), egressed: egressed.map(periods) },
    { created: quarter, new_fact: quarter, superseded_fact: quarter, egressed: [quarter] },
  );
});

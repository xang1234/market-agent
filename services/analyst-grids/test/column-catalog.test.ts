import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { bootstrapDatabase, connectedClient } from "../../../db/test/docker-pg.ts";
import { getColumn, listColumns } from "../src/column-catalog.ts";
import { verifySnapshotSeal } from "../../snapshot/src/snapshot-verifier.ts";
import type { QueryExecutor } from "../src/types.ts";

test("catalog lists the latest_market_cap column", () => {
  const entries = listColumns();
  const keys = entries.map((c) => c.column_key);
  assert.ok(keys.includes("latest_market_cap"));
  assert.equal(getColumn("latest_market_cap")?.kind, "deterministic");
});

test("latest_market_cap produces a sealable ok cell for a seeded fact", async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "analyst-grids-col");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;

  const sourceId = randomUUID();
  const issuerId = randomUUID();
  const metricId = randomUUID();
  const factId = randomUUID();
  await db.query(
    `insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at)
     values ($1, 'SEC EDGAR', 'filing', 'primary', 'permissive', now())`,
    [sourceId],
  );
  await db.query(
    `insert into issuers (issuer_id, legal_name) values ($1, 'Acme Corp')`,
    [issuerId],
  );
  await db.query(
    `insert into metrics (metric_id, metric_key, display_name, unit_class, aggregation, interpretation, canonical_source_class)
     values ($1, 'market_cap', 'Market Cap', 'currency', 'last', 'higher_is_better', 'market')`,
    [metricId],
  );
  await db.query(
    `insert into facts (fact_id, subject_kind, subject_id, metric_id, period_kind,
        value_num, unit, as_of, observed_at, source_id, method, verification_status,
        freshness_class, coverage_level, confidence, period_end)
     values ($1,'issuer',$2,$3,'point', 3200000000000, 'USD', now(), now(), $4,
        'reported','authoritative','eod','full', 0.95, '2024-03-31')`,
    [factId, issuerId, metricId, sourceId],
  );

  const producer = getColumn("latest_market_cap")!.producer;
  const result = await producer(
    { db },
    {
      subject: { kind: "issuer", id: issuerId },
      period: null,
      snapshotId: randomUUID(),
      asOf: new Date().toISOString(),
    },
  );

  assert.equal(result.status, "ok");
  assert.match(result.display.value, /3\.2/);
  assert.equal(result.primaryRef?.kind, "fact");
  assert.equal(result.primaryRef?.id, factId);
  assert.ok(result.seal, "expected a seal input");

  const verification = await verifySnapshotSeal(result.seal!);
  assert.equal(verification.ok, true, `seal must verify; failures: ${JSON.stringify(verification.failures ?? [])}`);
});

test("latest_market_cap returns missing_data when no fact exists", async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "analyst-grids-col-empty");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;
  const result = await getColumn("latest_market_cap")!.producer(
    { db },
    { subject: { kind: "issuer", id: randomUUID() }, period: null, snapshotId: randomUUID(), asOf: new Date().toISOString() },
  );
  assert.equal(result.status, "missing_data");
  assert.equal(result.seal, undefined);
});

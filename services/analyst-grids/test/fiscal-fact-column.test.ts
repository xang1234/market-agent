import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { bootstrapDatabase, connectedClient } from "../../../db/test/docker-pg.ts";
import { getColumn, listColumns } from "../src/column-catalog.ts";
import { verifySnapshotSeal } from "../../snapshot/src/snapshot-verifier.ts";
import type { GridColumnContext } from "../src/column-catalog.ts";
import type { QueryExecutor } from "../src/types.ts";

const USER_ID = "11111111-1111-4111-a111-111111111111";

function ctx(issuerId: string): GridColumnContext {
  return {
    subject: { kind: "issuer", id: issuerId },
    period: null,
    snapshotId: randomUUID(),
    asOf: new Date().toISOString(),
    userId: USER_ID,
    params: null,
  };
}

async function seedIssuerWithMetric(
  db: QueryExecutor,
  metricKey: string,
  unitClass: string,
): Promise<{ issuerId: string; sourceId: string; metricId: string }> {
  const sourceId = randomUUID();
  const issuerId = randomUUID();
  const metricId = randomUUID();
  await db.query(
    `insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at)
     values ($1, 'SEC EDGAR', 'filing', 'primary', 'permissive', now())`,
    [sourceId],
  );
  await db.query(`insert into issuers (issuer_id, legal_name) values ($1, 'Acme Corp')`, [issuerId]);
  await db.query(
    `insert into metrics (metric_id, metric_key, display_name, unit_class, aggregation, interpretation, canonical_source_class)
     values ($1, $2, $2, $3, 'last', 'higher_is_better', 'gaap')`,
    [metricId, metricKey, unitClass],
  );
  return { issuerId, sourceId, metricId };
}

async function seedFiscalFact(
  db: QueryExecutor,
  args: {
    issuerId: string;
    sourceId: string;
    metricId: string;
    value: number;
    unit: string;
    periodKind: string;
    fiscalYear: number;
    fiscalPeriod: string;
    periodEnd: string;
    asOf: string;
  },
): Promise<string> {
  const factId = randomUUID();
  await db.query(
    `insert into facts (fact_id, subject_kind, subject_id, metric_id, period_kind,
        value_num, unit, as_of, observed_at, source_id, method, verification_status,
        freshness_class, coverage_level, confidence, fiscal_year, fiscal_period, period_end)
     values ($1,'issuer',$2,$3,$4,$5,$6,$7,now(),$8,'reported','authoritative','eod','full',0.95,$9,$10,$11)`,
    [
      factId,
      args.issuerId,
      args.metricId,
      args.periodKind,
      args.value,
      args.unit,
      args.asOf,
      args.sourceId,
      args.fiscalYear,
      args.fiscalPeriod,
      args.periodEnd,
    ],
  );
  return factId;
}

test("catalog lists the fiscal-fact columns as deterministic", () => {
  const keys = listColumns().map((c) => c.column_key);
  assert.ok(keys.includes("latest_revenue"), "latest_revenue must be registered");
  assert.ok(keys.includes("latest_eps_diluted"), "latest_eps_diluted must be registered");
  assert.equal(getColumn("latest_revenue")?.kind, "deterministic");
  assert.equal(getColumn("latest_eps_diluted")?.kind, "deterministic");
});

test("latest_revenue picks the most recently reported fiscal fact and seals it", async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "grid-col-revenue");
  const db = (await connectedClient(t, databaseUrl)) as unknown as QueryExecutor;
  const seeded = await seedIssuerWithMetric(db, "revenue", "currency");

  // Older FY fact reported earlier; newer Q2 fact reported later must win.
  await seedFiscalFact(db, {
    ...seeded,
    value: 6_475_000_000,
    unit: "currency",
    periodKind: "fiscal_y",
    fiscalYear: 2024,
    fiscalPeriod: "FY",
    periodEnd: "2024-12-31",
    asOf: "2025-02-01T00:00:00.000Z",
  });
  const newest = await seedFiscalFact(db, {
    ...seeded,
    value: 1_810_000_000,
    unit: "currency",
    periodKind: "fiscal_q",
    fiscalYear: 2025,
    fiscalPeriod: "Q2",
    periodEnd: "2025-06-30",
    asOf: "2025-08-01T00:00:00.000Z",
  });

  const result = await getColumn("latest_revenue")!.producer({ db }, ctx(seeded.issuerId));

  assert.equal(result.status, "ok");
  assert.match(result.display.value, /1\.8B/, "compact currency for the newest fact");
  assert.match(result.display.value, /Q2 2025/, "the cell names the fiscal period it shows");
  assert.equal(result.primaryRef?.id, newest);
  assert.ok(result.seal, "expected a seal input");
  const verification = await verifySnapshotSeal(result.seal!);
  assert.equal(verification.ok, true, `seal must verify; failures: ${JSON.stringify(verification.failures ?? [])}`);
});

test("latest_eps_diluted formats per-share values precisely", async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "grid-col-eps");
  const db = (await connectedClient(t, databaseUrl)) as unknown as QueryExecutor;
  const seeded = await seedIssuerWithMetric(db, "eps_diluted", "currency_per_share");
  await seedFiscalFact(db, {
    ...seeded,
    value: 0.3,
    unit: "currency_per_share",
    periodKind: "fiscal_y",
    fiscalYear: 2021,
    fiscalPeriod: "FY",
    periodEnd: "2021-12-31",
    asOf: "2022-02-01T00:00:00.000Z",
  });

  const result = await getColumn("latest_eps_diluted")!.producer({ db }, ctx(seeded.issuerId));

  assert.equal(result.status, "ok");
  assert.match(result.display.value, /\$0\.30/);
  assert.match(result.display.value, /FY 2021/);
  const verification = await verifySnapshotSeal(result.seal!);
  assert.equal(verification.ok, true, `seal must verify; failures: ${JSON.stringify(verification.failures ?? [])}`);
});

test("fiscal columns report missing_data without facts and for non-issuers", async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "grid-col-fiscal-empty");
  const db = (await connectedClient(t, databaseUrl)) as unknown as QueryExecutor;

  const noFacts = await getColumn("latest_revenue")!.producer({ db }, ctx(randomUUID()));
  assert.equal(noFacts.status, "missing_data");
  assert.equal(noFacts.seal, undefined);

  const nonIssuer = await getColumn("latest_revenue")!.producer(
    { db },
    { ...ctx(randomUUID()), subject: { kind: "listing", id: randomUUID() } },
  );
  assert.equal(nonIssuer.status, "missing_data");
});

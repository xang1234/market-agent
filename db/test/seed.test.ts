import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  createContainerName,
  dbRoot,
  dockerAvailable,
  queryValue,
  run,
  startPostgres,
  stopPostgres,
  waitForPostgres,
} from "./docker-pg.ts";

const METRICS_DIGEST_EXPR =
  "md5(string_agg(metric_key || ':' || display_name || ':' || unit_class || ':' || aggregation || ':' || interpretation || ':' || canonical_source_class, ',' order by metric_key))";
const SOURCES_DIGEST_EXPR =
  "md5(string_agg(source_id::text || ':' || provider || ':' || kind::text || ':' || trust_tier::text || ':' || license_class, ',' order by source_id))";

type SeedSnapshot = {
  metricCount: string;
  sourceCount: string;
  metricsDigest: string;
  sourcesDigest: string;
};

function snapshotSeed(containerName: string): SeedSnapshot {
  const row = queryValue(
    containerName,
    `select
       (select count(*) from metrics) || '|' ||
       (select count(*) from sources) || '|' ||
       (select ${METRICS_DIGEST_EXPR} from metrics) || '|' ||
       (select ${SOURCES_DIGEST_EXPR} from sources)`,
  );
  const [metricCount, sourceCount, metricsDigest, sourcesDigest] = row.split("|");
  return { metricCount, sourceCount, metricsDigest, sourcesDigest };
}

function runSeed(databaseUrl: string) {
  return run("npm", ["run", "seed", "--", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });
}

async function bootstrapDatabase(t: test.TestContext) {
  const containerName = createContainerName("fra-6al-7-3");
  const password = "postgres";
  const hostPort = startPostgres(containerName, password);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${hostPort}/postgres`;

  t.after(() => {
    stopPostgres(containerName);
  });

  await waitForPostgres(containerName);

  const applyResult = run("npm", ["run", "apply:schema", "--", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });
  assert.equal(applyResult.status, 0, applyResult.stderr || applyResult.stdout);

  return { containerName, databaseUrl };
}

test("seed populates metrics and sources with the expected registry", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for db seed integration coverage");
    return;
  }

  const { containerName, databaseUrl } = await bootstrapDatabase(t);

  const seedResult = runSeed(databaseUrl);
  assert.equal(seedResult.status, 0, seedResult.stderr || seedResult.stdout);

  const { metricCount, sourceCount } = snapshotSeed(containerName);
  assert.equal(Number(metricCount) > 0, true, "expected metrics to be populated");
  assert.equal(Number(sourceCount) > 0, true, "expected sources to be populated");

  for (const coreMetric of ["revenue", "net_income", "eps_diluted", "gross_margin", "pe_ratio"]) {
    assert.equal(
      queryValue(containerName, `select count(*) from metrics where metric_key = '${coreMetric}'`),
      "1",
      `expected core metric ${coreMetric} to be present exactly once`,
    );
  }

  assert.equal(
    queryValue(containerName, "select count(*) from sources where provider = 'sec_edgar' and kind = 'filing'"),
    "1",
    "expected sec_edgar filing source to be present exactly once",
  );
});

test("seed is idempotent: re-running produces no duplicates", { timeout: 180000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for db seed integration coverage");
    return;
  }

  const { containerName, databaseUrl } = await bootstrapDatabase(t);

  const first = runSeed(databaseUrl);
  assert.equal(first.status, 0, first.stderr || first.stdout);

  const before = snapshotSeed(containerName);

  const second = runSeed(databaseUrl);
  assert.equal(second.status, 0, second.stderr || second.stdout);

  assert.deepEqual(snapshotSeed(containerName), before);
});

test("seeded metric and source rows satisfy referential contracts for facts", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for db seed integration coverage");
    return;
  }

  const { containerName, databaseUrl } = await bootstrapDatabase(t);

  const seedResult = runSeed(databaseUrl);
  assert.equal(seedResult.status, 0, seedResult.stderr || seedResult.stdout);

  const insertFact = run("docker", [
    "exec",
    containerName,
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `insert into facts (
       subject_kind, subject_id, metric_id, period_kind, observed_at, as_of,
       unit, confidence, source_id, method, definition_version,
       verification_status, freshness_class, coverage_level
     )
     select
       'issuer'::subject_kind,
       gen_random_uuid(),
       m.metric_id,
       'fiscal_q',
       now(),
       now(),
       'USD',
       0.9,
       s.source_id,
       'reported'::fact_method,
       1,
       'authoritative'::verification_status,
       'filing_time'::freshness_class,
       'full'::coverage_level
     from metrics m
     cross join sources s
     where m.metric_key = 'revenue' and s.provider = 'sec_edgar' and s.kind = 'filing';`,
  ]);
  assert.equal(insertFact.status, 0, insertFact.stderr || insertFact.stdout);
  assert.equal(queryValue(containerName, "select count(*) from facts"), "1");
});

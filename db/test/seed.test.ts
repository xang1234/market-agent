import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const workspaceRoot = join(import.meta.dirname, "..", "..");
const dbRoot = join(workspaceRoot, "db");
const metricsSeedPath = join(dbRoot, "seed", "metrics.sql");
const sourcesSeedPath = join(dbRoot, "seed", "sources.sql");

function run(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd ?? workspaceRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...options.env,
    },
  });
}

function dockerAvailable() {
  const result = run("docker", ["version", "--format", "{{.Server.Version}}"]);
  return result.status === 0;
}

function createContainerName() {
  return `fra-6al-7-3-${process.pid}-${Date.now()}`;
}

function lookupPublishedHostPort(containerName: string) {
  const result = run("docker", ["port", containerName, "5432/tcp"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const mapping = result.stdout.trim();
  const match = mapping.match(/:(\d+)$/);
  assert.ok(match, `expected docker port output to include a host port, got: ${mapping}`);
  return match[1];
}

function startPostgres(containerName: string, password: string) {
  const result = run("docker", [
    "run",
    "--detach",
    "--rm",
    "--name",
    containerName,
    "-e",
    `POSTGRES_PASSWORD=${password}`,
    "-p",
    "127.0.0.1::5432",
    "postgres:15",
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  return lookupPublishedHostPort(containerName);
}

function stopPostgres(containerName: string) {
  run("docker", ["rm", "--force", containerName]);
}

async function waitForPostgres(containerName: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = run("docker", ["exec", containerName, "pg_isready", "-U", "postgres"]);
    if (result.status === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  assert.fail(`Timed out waiting for Postgres container ${containerName}`);
}

function queryValue(containerName: string, sql: string) {
  const result = run("docker", [
    "exec",
    containerName,
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-tAc",
    sql,
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function countMetricKeysInSeedFile() {
  const sql = readFileSync(metricsSeedPath, "utf8");
  return Array.from(sql.matchAll(/^\s*\('([a-z_]+)',/gm)).length;
}

function countSourcesInSeedFile() {
  const sql = readFileSync(sourcesSeedPath, "utf8");
  return Array.from(sql.matchAll(/^\s*\('[0-9a-f-]{36}',/gm)).length;
}

async function bootstrapDatabase(t: test.TestContext) {
  const containerName = createContainerName();
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

  const seedResult = run("npm", ["run", "seed", "--", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });
  assert.equal(seedResult.status, 0, seedResult.stderr || seedResult.stdout);

  const expectedMetricCount = countMetricKeysInSeedFile();
  assert.ok(expectedMetricCount > 0, "expected seed file to define at least one metric");
  assert.equal(queryValue(containerName, "select count(*) from metrics"), String(expectedMetricCount));

  const expectedSourceCount = countSourcesInSeedFile();
  assert.ok(expectedSourceCount > 0, "expected seed file to define at least one source");
  assert.equal(queryValue(containerName, "select count(*) from sources"), String(expectedSourceCount));

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

  const first = run("npm", ["run", "seed", "--", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });
  assert.equal(first.status, 0, first.stderr || first.stdout);

  const metricsAfterFirst = queryValue(containerName, "select count(*) from metrics");
  const sourcesAfterFirst = queryValue(containerName, "select count(*) from sources");
  const metricsDigestAfterFirst = queryValue(
    containerName,
    "select md5(string_agg(metric_key || ':' || display_name || ':' || unit_class || ':' || aggregation || ':' || interpretation || ':' || canonical_source_class, ',' order by metric_key)) from metrics",
  );
  const sourcesDigestAfterFirst = queryValue(
    containerName,
    "select md5(string_agg(source_id::text || ':' || provider || ':' || kind::text || ':' || trust_tier::text || ':' || license_class, ',' order by source_id)) from sources",
  );

  const second = run("npm", ["run", "seed", "--", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });
  assert.equal(second.status, 0, second.stderr || second.stdout);

  assert.equal(queryValue(containerName, "select count(*) from metrics"), metricsAfterFirst);
  assert.equal(queryValue(containerName, "select count(*) from sources"), sourcesAfterFirst);
  assert.equal(
    queryValue(
      containerName,
      "select md5(string_agg(metric_key || ':' || display_name || ':' || unit_class || ':' || aggregation || ':' || interpretation || ':' || canonical_source_class, ',' order by metric_key)) from metrics",
    ),
    metricsDigestAfterFirst,
  );
  assert.equal(
    queryValue(
      containerName,
      "select md5(string_agg(source_id::text || ':' || provider || ':' || kind::text || ':' || trust_tier::text || ':' || license_class, ',' order by source_id)) from sources",
    ),
    sourcesDigestAfterFirst,
  );
});

test("seeded metric and source rows satisfy referential contracts for facts", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for db seed integration coverage");
    return;
  }

  const { containerName, databaseUrl } = await bootstrapDatabase(t);

  const seedResult = run("npm", ["run", "seed", "--", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });
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

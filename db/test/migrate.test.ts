import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  connectedClient,
  createContainerName,
  dbRoot,
  dockerAvailable,
  queryValue,
  registerLifoCleanup,
  run,
  startPostgres,
  stopPostgres,
  waitForPostgres,
  workspaceRoot,
} from "./docker-pg.ts";

const schemaPath = join(workspaceRoot, "spec", "finance_research_db_schema.sql");
const initMigrationPath = join(dbRoot, "migrations", "0001_init.up.sql");
const snapshotManifestMigrationPath = join(dbRoot, "migrations", "0005_snapshot_document_refs.up.sql");
const evidenceBundleMigrationPath = join(dbRoot, "migrations", "0017_evidence_bundles.up.sql");
const agentRunClaimsMigrationPath = join(dbRoot, "migrations", "0018_agent_run_claims.up.sql");
const alertsFiredMigrationPath = join(dbRoot, "migrations", "0019_alerts_fired.up.sql");
const notificationDeliveryMigrationPath = join(dbRoot, "migrations", "0020_notification_delivery.up.sql");

function loadExpectedTables() {
  return Array.from(
    readFileSync(schemaPath, "utf8").matchAll(/^create table ([a-z_][a-z0-9_]*) \($/gim),
    (match) => match[1],
  ).sort();
}

test("snapshot manifest forward migration owns post-baseline snapshot columns", () => {
  const initMigration = readFileSync(initMigrationPath, "utf8");
  const forwardMigration = readFileSync(snapshotManifestMigrationPath, "utf8");
  const schema = readFileSync(schemaPath, "utf8");

  for (const column of ["document_refs", "tool_call_result_hashes"]) {
    assert.doesNotMatch(initMigration, new RegExp(`\\b${column}\\b`));
    assert.match(forwardMigration, new RegExp(`\\b${column}\\b`));
    assert.match(schema, new RegExp(`\\b${column}\\b`));
  }
});

test("evidence bundle schema blocks direct updates and deletes", () => {
  const forwardMigration = readFileSync(evidenceBundleMigrationPath, "utf8");
  const schema = readFileSync(schemaPath, "utf8");

  for (const sql of [forwardMigration, schema]) {
    assert.match(sql, /create function prevent_evidence_bundle_modification\(\) returns trigger/i);
    assert.match(sql, /raise exception 'evidence_bundles are immutable/i);
    assert.match(sql, /create trigger evidence_bundles_immutable/i);
    assert.match(sql, /before update or delete on evidence_bundles/i);
  }
});

test("agent run claim schema enforces one running row per agent", () => {
  const forwardMigration = readFileSync(agentRunClaimsMigrationPath, "utf8");
  const schema = readFileSync(schemaPath, "utf8");

  for (const sql of [forwardMigration, schema]) {
    assert.match(sql, /claim_expires_at timestamptz/i);
    assert.match(sql, /create unique index(?: if not exists)? agent_run_logs_one_running_per_agent_idx/i);
    assert.match(sql, /where agent_id is not null/i);
    assert.match(sql, /status = 'running'/i);
    assert.match(sql, /ended_at is null/i);
  }
});

test("alerts fired schema records trigger provenance before notification delivery", () => {
  const forwardMigration = readFileSync(alertsFiredMigrationPath, "utf8");
  const schema = readFileSync(schemaPath, "utf8");

  for (const sql of [forwardMigration, schema]) {
    assert.match(sql, /create table alerts_fired/i);
    assert.match(sql, /run_id uuid not null references agent_run_logs\(agent_run_log_id\)/i);
    assert.match(sql, /finding_id uuid not null references findings\(finding_id\)/i);
    assert.match(sql, /trigger_refs jsonb not null/i);
    assert.match(sql, /status text not null default 'pending_notification'/i);
    assert.match(sql, /status in \('pending_notification', 'notified', 'failed', 'acknowledged'\)/i);
    assert.match(sql, /unique \(agent_id, run_id, rule_id, finding_id\)/i);
    assert.match(sql, /create index alerts_fired_finding_idx on alerts_fired\(finding_id\)/i);
  }
});

test("notification delivery schema records preferences and delivery attempts", () => {
  const forwardMigration = readFileSync(notificationDeliveryMigrationPath, "utf8");
  const schema = readFileSync(schemaPath, "utf8");

  for (const sql of [forwardMigration, schema]) {
    assert.match(sql, /create table notification_preferences/i);
    assert.match(sql, /user_id uuid not null references users\(user_id\)/i);
    assert.match(sql, /agent_id uuid references agents\(agent_id\)/i);
    assert.match(sql, /channel text not null/i);
    assert.match(sql, /digest_cadence text not null default 'immediate'/i);
    assert.match(sql, /create table notification_deliveries/i);
    assert.match(sql, /alert_fired_id uuid references alerts_fired\(alert_fired_id\)/i);
    assert.match(sql, /status text not null/i);
    assert.match(sql, /blocked_fact_ids jsonb not null default '\[\]'::jsonb/i);
    assert.match(sql, /create index notification_deliveries_user_channel_idx/i);
  }
});

test("migrate up applies pending migrations and records them in schema_migrations", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for db migration integration coverage");
    return;
  }

  const containerName = createContainerName("fra-6al-7-2");
  const password = "postgres";
  const hostPort = startPostgres(containerName, password);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${hostPort}/postgres`;

  t.after(() => {
    stopPostgres(containerName);
  });

  await waitForPostgres(containerName, databaseUrl);

  const migrateResult = run("npm", ["run", "migrate", "--", "up", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });

  assert.equal(migrateResult.status, 0, migrateResult.stderr || migrateResult.stdout);
  assert.equal(queryValue(containerName, "select count(*) from schema_migrations"), "20");
  assert.deepEqual(
    queryValue(containerName, "select version || ':' || name from schema_migrations order by version").split("\n"),
    [
      "0001:init",
      "0002:issuer_aliases",
      "0003:default_manual_watchlist",
      "0004:agent_run_log",
      "0005:snapshot_document_refs",
      "0006:chat_messages_snapshot_not_null",
      "0007:documents_parent_idx",
      "0008:chat_threads_archived_at",
      "0009:theme_memberships_unique",
      "0010:analyze_template_runs",
      "0011:sources_user_id",
      "0012:document_kind_press_release",
      "0013:mentions_unique",
      "0014:entity_impacts_channel_constraint",
      "0015:object_blob_gc_queue",
      "0016:fact_review_queue",
      "0017:evidence_bundles",
      "0018:agent_run_claims",
      "0019:alerts_fired",
      "0020:notification_delivery",
    ],
  );

  const publicTables = queryValue(
    containerName,
    "select tablename from pg_tables where schemaname = 'public' order by tablename",
  )
    .split("\n")
    .filter(Boolean)
    .filter((table) => table !== "schema_migrations")
    .sort();

  assert.deepEqual(publicTables, loadExpectedTables());

  const bundleId = "00000000-0000-0000-0000-000000000001";
  const bundlePayload = `{"bundle_id":"${bundleId}","documents":[],"evidence":[]}`;
  const insertBundleResult = run("docker", [
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
    `insert into evidence_bundles (bundle_id, bundle) values ('${bundleId}', '${bundlePayload}'::jsonb)`,
  ]);
  assert.equal(insertBundleResult.status, 0, insertBundleResult.stderr || insertBundleResult.stdout);

  const updateBundleResult = run("docker", [
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
    `update evidence_bundles set bundle = jsonb_set(bundle, '{documents}', '[]'::jsonb) where bundle_id = '${bundleId}'`,
  ]);
  assert.notEqual(updateBundleResult.status, 0);
  assert.match(updateBundleResult.stderr || updateBundleResult.stdout, /evidence_bundles are immutable/);

  const deleteBundleResult = run("docker", [
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
    `delete from evidence_bundles where bundle_id = '${bundleId}'`,
  ]);
  assert.notEqual(deleteBundleResult.status, 0);
  assert.match(deleteBundleResult.stderr || deleteBundleResult.stdout, /evidence_bundles are immutable/);
});

test("migrate status reports all migrations as applied after migrate up", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for db migration integration coverage");
    return;
  }

  const containerName = createContainerName("fra-6al-7-2");
  const password = "postgres";
  const hostPort = startPostgres(containerName, password);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${hostPort}/postgres`;

  t.after(() => {
    stopPostgres(containerName);
  });

  await waitForPostgres(containerName, databaseUrl);

  const upResult = run("npm", ["run", "migrate", "--", "up", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });
  assert.equal(upResult.status, 0, upResult.stderr || upResult.stdout);

  const statusResult = run("npm", ["run", "migrate", "--", "status", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });

  assert.equal(statusResult.status, 0, statusResult.stderr || statusResult.stdout);
  assert.match(statusResult.stdout, /0001\s+init\s+applied/);
  assert.match(statusResult.stdout, /0002\s+issuer_aliases\s+applied/);
  assert.match(statusResult.stdout, /0003\s+default_manual_watchlist\s+applied/);
  assert.match(statusResult.stdout, /0004\s+agent_run_log\s+applied/);
  assert.match(statusResult.stdout, /0005\s+snapshot_document_refs\s+applied/);
  assert.match(statusResult.stdout, /0006\s+chat_messages_snapshot_not_null\s+applied/);
  assert.match(statusResult.stdout, /0007\s+documents_parent_idx\s+applied/);
  assert.match(statusResult.stdout, /0008\s+chat_threads_archived_at\s+applied/);
  assert.match(statusResult.stdout, /0009\s+theme_memberships_unique\s+applied/);
  assert.match(statusResult.stdout, /0010\s+analyze_template_runs\s+applied/);
  assert.match(statusResult.stdout, /0011\s+sources_user_id\s+applied/);
  assert.match(statusResult.stdout, /0012\s+document_kind_press_release\s+applied/);
  assert.match(statusResult.stdout, /0013\s+mentions_unique\s+applied/);
  assert.match(statusResult.stdout, /0014\s+entity_impacts_channel_constraint\s+applied/);
  assert.match(statusResult.stdout, /0015\s+object_blob_gc_queue\s+applied/);
  assert.match(statusResult.stdout, /0016\s+fact_review_queue\s+applied/);
  assert.match(statusResult.stdout, /0017\s+evidence_bundles\s+applied/);
  assert.match(statusResult.stdout, /0018\s+agent_run_claims\s+applied/);
  assert.match(statusResult.stdout, /0019\s+alerts_fired\s+applied/);
  assert.match(statusResult.stdout, /0020\s+notification_delivery\s+applied/);
});

test("migrate down rolls back the most recently applied migration", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for db migration integration coverage");
    return;
  }

  const containerName = createContainerName("fra-6al-7-2");
  const password = "postgres";
  const hostPort = startPostgres(containerName, password);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${hostPort}/postgres`;

  t.after(() => {
    stopPostgres(containerName);
  });

  await waitForPostgres(containerName, databaseUrl);

  const upResult = run("npm", ["run", "migrate", "--", "up", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });
  assert.equal(upResult.status, 0, upResult.stderr || upResult.stdout);

  const totalApplied = Number(queryValue(containerName, "select count(*) from schema_migrations"));
  const rollbackCount = totalApplied - 12;
  assert.equal(rollbackCount > 0, true, "precondition: 0013 or newer migrations must be applied before rollback");
  for (let i = 0; i < rollbackCount; i += 1) {
    const downResult = run("npm", ["run", "migrate", "--", "down", "--database-url", databaseUrl], {
      cwd: dbRoot,
      env: { DATABASE_URL: databaseUrl },
    });
    assert.equal(downResult.status, 0, downResult.stderr || downResult.stdout);
  }

  assert.equal(queryValue(containerName, "select count(*) from schema_migrations"), "12");
  assert.equal(
    queryValue(containerName, "select count(*) from pg_tables where schemaname = 'public' and tablename = 'agent_run_logs'"),
    "1",
  );
  assert.equal(
    queryValue(containerName, "select count(*) from information_schema.columns where table_name = 'snapshots' and column_name in ('document_refs', 'tool_call_result_hashes')"),
    "2",
  );
  assert.equal(
    queryValue(containerName, "select count(*) from pg_indexes where schemaname = 'public' and indexname = 'watchlists_default_manual_per_user_idx'"),
    "1",
  );
  assert.equal(
    queryValue(containerName, "select count(*) from pg_tables where schemaname = 'public' and tablename = 'issuer_aliases'"),
    "1",
  );
  assert.equal(
    queryValue(
      containerName,
      "select count(*) from pg_indexes where schemaname = 'public' and indexname in ('documents_parent_idx', 'documents_conversation_idx')",
    ),
    "2",
  );
  assert.equal(
    queryValue(
      containerName,
      "select count(*) from information_schema.columns where table_name = 'chat_threads' and column_name = 'archived_at'",
    ),
    "1",
    "0008's archived_at column must remain — only 0013 and newer should have been rolled back",
  );
  // 0009's effects must remain — only 0013 and newer were rolled back.
  assert.equal(
    queryValue(
      containerName,
      "select count(*) from pg_constraint where conname = 'theme_memberships_theme_subject_unique'",
    ),
    "1",
    "0009's unique constraint must remain — only 0013 and newer should have been rolled back",
  );
  // 0010's effects must remain — only 0013 and newer were rolled back.
  assert.equal(
    queryValue(
      containerName,
      "select count(*) from pg_tables where schemaname = 'public' and tablename = 'analyze_template_runs'",
    ),
    "1",
    "0010's analyze_template_runs table must remain — only 0013 and newer should have been rolled back",
  );
  // 0011's effects must remain — only 0013 and newer were rolled back.
  assert.equal(
    queryValue(
      containerName,
      "select count(*) from information_schema.columns where table_name = 'sources' and column_name = 'user_id'",
    ),
    "1",
    "0011's sources.user_id column must remain — only 0013 and newer should have been rolled back",
  );
  // 0012's effects must remain — only 0013 and newer were rolled back.
  assert.equal(
    queryValue(
      containerName,
      "select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'document_kind' and e.enumlabel = 'press_release'",
    ),
    "1",
    "press_release enum value added by 0012.up must remain — only 0013 and newer should have been rolled back",
  );
  // 0013-specific assertion: mention dedupe index must be gone after rollback.
  assert.equal(
    queryValue(
      containerName,
      "select count(*) from pg_indexes where schemaname = 'public' and indexname = 'mentions_document_subject_prominence_idx'",
    ),
    "0",
    "mentions unique index added by 0013.up must be removed by 0013.down",
  );
});

test("migrate down exits cleanly when nothing is applied", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for db migration integration coverage");
    return;
  }

  const containerName = createContainerName("fra-6al-7-2");
  const password = "postgres";
  const hostPort = startPostgres(containerName, password);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${hostPort}/postgres`;

  t.after(() => {
    stopPostgres(containerName);
  });

  await waitForPostgres(containerName, databaseUrl);

  const downResult = run("npm", ["run", "migrate", "--", "down", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });

  assert.equal(downResult.status, 0, downResult.stderr || downResult.stdout);
  assert.match(downResult.stdout, /No applied migrations to roll back/);
});

test("migrate status fails when an applied migration is missing locally", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for db migration integration coverage");
    return;
  }

  const containerName = createContainerName("fra-6al-7-2");
  const password = "postgres";
  const hostPort = startPostgres(containerName, password);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${hostPort}/postgres`;

  t.after(() => {
    stopPostgres(containerName);
  });

  await waitForPostgres(containerName, databaseUrl);

  const result = run("docker", [
    "exec",
    containerName,
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-c",
    "create table schema_migrations (version text primary key, name text not null, applied_at timestamptz not null default now()); insert into schema_migrations(version, name) values ('9999', 'missing_local');",
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const statusResult = run("npm", ["run", "migrate", "--", "status", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });

  assert.notEqual(statusResult.status, 0);
  assert.match(statusResult.stderr || statusResult.stdout, /Applied migration 9999 is missing locally/);
});

test("verify:schema succeeds after migrate up", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for db migration integration coverage");
    return;
  }

  const containerName = createContainerName("fra-6al-7-2");
  const password = "postgres";
  const hostPort = startPostgres(containerName, password);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${hostPort}/postgres`;

  t.after(() => {
    stopPostgres(containerName);
  });

  await waitForPostgres(containerName, databaseUrl);

  const upResult = run("npm", ["run", "migrate", "--", "up", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });
  assert.equal(upResult.status, 0, upResult.stderr || upResult.stdout);

  const verifyResult = run("npm", ["run", "verify:schema", "--", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });

  assert.equal(verifyResult.status, 0, verifyResult.stderr || verifyResult.stdout);
});

test("migrate up creates indexed issuer aliases and backfills issuer names", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for db migration integration coverage");
    return;
  }

  const containerName = createContainerName("fra-6al-4-6");
  const password = "postgres";
  const hostPort = startPostgres(containerName, password);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${hostPort}/postgres`;

  registerLifoCleanup(t, () => stopPostgres(containerName));

  await waitForPostgres(containerName, databaseUrl);

  const client = await connectedClient(t, databaseUrl);

  await client.query(readFileSync(initMigrationPath, "utf8"));
  await client.query(`
    create table schema_migrations (
      version text primary key,
      name text not null,
      applied_at timestamptz not null default now()
    );
    insert into schema_migrations(version, name) values ('0001', 'init');
  `);
  await client.query(
    `insert into issuers (legal_name, former_names)
     values ($1, $2::jsonb)`,
    ["Alphabet Inc.", JSON.stringify(["Google", null, ""])],
  );

  const upResult = run("npm", ["run", "migrate", "--", "up", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });
  assert.equal(upResult.status, 0, upResult.stderr || upResult.stdout);

  assert.equal(
    queryValue(containerName, "select count(*) from pg_tables where schemaname = 'public' and tablename = 'issuer_aliases'"),
    "1",
  );
  assert.equal(
    queryValue(containerName, "select count(*) from pg_indexes where schemaname = 'public' and indexname = 'issuer_aliases_normalized_name_idx'"),
    "1",
  );
  assert.equal(
    queryValue(containerName, "select count(*) from issuer_aliases where normalized_name = 'alphabet inc' and match_reason = 'legal_name'"),
    "1",
  );
  assert.equal(
    queryValue(containerName, "select count(*) from issuer_aliases where normalized_name = 'google' and match_reason = 'former_name'"),
    "1",
  );
  assert.equal(
    queryValue(containerName, "select count(*) from issuer_aliases where normalized_name = ''"),
    "0",
  );
});

test("migrate up keeps issuer aliases synchronized on issuer writes", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for db migration integration coverage");
    return;
  }

  const containerName = createContainerName("fra-6al-4-6");
  const password = "postgres";
  const hostPort = startPostgres(containerName, password);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${hostPort}/postgres`;

  registerLifoCleanup(t, () => stopPostgres(containerName));

  await waitForPostgres(containerName, databaseUrl);

  const upResult = run("npm", ["run", "migrate", "--", "up", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });
  assert.equal(upResult.status, 0, upResult.stderr || upResult.stdout);

  const client = await connectedClient(t, databaseUrl);

  const issuer = await client.query<{ issuer_id: string }>(
    `insert into issuers (legal_name, former_names)
     values ($1, $2::jsonb)
     returning issuer_id`,
    ["Trigger Corp.", JSON.stringify(["Old Trigger", null, ""])],
  );
  const issuerId = issuer.rows[0].issuer_id;

  assert.equal(
    queryValue(containerName, `select count(*) from issuer_aliases where issuer_id = '${issuerId}' and normalized_name = 'trigger corp' and match_reason = 'legal_name'`),
    "1",
  );
  assert.equal(
    queryValue(containerName, `select count(*) from issuer_aliases where issuer_id = '${issuerId}' and normalized_name = 'old trigger' and match_reason = 'former_name'`),
    "1",
  );
  assert.equal(
    queryValue(containerName, `select count(*) from issuer_aliases where issuer_id = '${issuerId}' and normalized_name = ''`),
    "0",
  );

  await client.query(
    `update issuers
        set legal_name = $2,
            former_names = $3::jsonb
      where issuer_id = $1`,
    [issuerId, "Renamed Corp.", JSON.stringify(["Earlier Corp"])],
  );

  assert.equal(
    queryValue(containerName, `select count(*) from issuer_aliases where issuer_id = '${issuerId}' and normalized_name in ('trigger corp', 'old trigger')`),
    "0",
  );
  assert.equal(
    queryValue(containerName, `select count(*) from issuer_aliases where issuer_id = '${issuerId}' and normalized_name = 'renamed corp' and match_reason = 'legal_name'`),
    "1",
  );
  assert.equal(
    queryValue(containerName, `select count(*) from issuer_aliases where issuer_id = '${issuerId}' and normalized_name = 'earlier corp' and match_reason = 'former_name'`),
    "1",
  );
});

test("migrate up provisions the implicit default manual watchlist on user insert", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for db migration integration coverage");
    return;
  }

  const containerName = createContainerName("fra-6al-6-1");
  const password = "postgres";
  const hostPort = startPostgres(containerName, password);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${hostPort}/postgres`;

  registerLifoCleanup(t, () => stopPostgres(containerName));

  await waitForPostgres(containerName, databaseUrl);

  const client = await connectedClient(t, databaseUrl);

  // Seed a user before migrations run so the backfill path is exercised alongside the trigger.
  await client.query(readFileSync(initMigrationPath, "utf8"));
  await client.query(`
    create table schema_migrations (
      version text primary key,
      name text not null,
      applied_at timestamptz not null default now()
    );
    insert into schema_migrations(version, name) values ('0001', 'init');
  `);
  const preMigrationUser = await client.query<{ user_id: string }>(
    `insert into users (email) values ($1) returning user_id`,
    ["pre-migration@example.test"],
  );
  const preMigrationUserId = preMigrationUser.rows[0].user_id;

  const upResult = run("npm", ["run", "migrate", "--", "up", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });
  assert.equal(upResult.status, 0, upResult.stderr || upResult.stdout);

  // Backfill: the existing user now has exactly one manual watchlist named 'Watchlist'.
  assert.equal(
    queryValue(containerName, `select count(*) from watchlists where user_id = '${preMigrationUserId}' and mode = 'manual' and name = 'Watchlist'`),
    "1",
  );

  // Trigger: inserting a fresh user auto-creates one manual watchlist.
  const postMigrationUser = await client.query<{ user_id: string }>(
    `insert into users (email) values ($1) returning user_id`,
    ["post-migration@example.test"],
  );
  const postMigrationUserId = postMigrationUser.rows[0].user_id;
  assert.equal(
    queryValue(containerName, `select count(*) from watchlists where user_id = '${postMigrationUserId}' and mode = 'manual'`),
    "1",
  );

  // Invariant: the unique partial index rejects a second manual watchlist for the same user.
  await assert.rejects(
    client.query(
      `insert into watchlists (user_id, name, mode) values ($1, $2, 'manual')`,
      [postMigrationUserId, "Second Manual"],
    ),
    /watchlists_default_manual_per_user_idx|duplicate key/i,
  );

  // Non-manual modes are not constrained by the partial index.
  await client.query(
    `insert into watchlists (user_id, name, mode) values ($1, $2, 'screen')`,
    [postMigrationUserId, "Screen Derivation"],
  );
  assert.equal(
    queryValue(containerName, `select count(*) from watchlists where user_id = '${postMigrationUserId}'`),
    "2",
  );
});

test("migrate up enforces listings uniqueness and fact confidence bounds", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for db migration integration coverage");
    return;
  }

  const containerName = createContainerName("fra-6al-7-2");
  const password = "postgres";
  const hostPort = startPostgres(containerName, password);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${hostPort}/postgres`;

  t.after(() => {
    stopPostgres(containerName);
  });

  await waitForPostgres(containerName, databaseUrl);

  const upResult = run("npm", ["run", "migrate", "--", "up", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });
  assert.equal(upResult.status, 0, upResult.stderr || upResult.stdout);

  const setupResult = run("docker", [
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
    `insert into issuers (legal_name) values ('Example Issuer');
     insert into instruments (issuer_id, asset_type)
     select issuer_id, 'common_stock'::asset_type from issuers where legal_name = 'Example Issuer';
     insert into listings (instrument_id, mic, ticker, trading_currency, timezone)
     select instrument_id, 'XNAS', 'EXMPL', 'USD', 'UTC' from instruments limit 1;
     insert into metrics (metric_key, display_name, unit_class, aggregation, interpretation, canonical_source_class)
     values ('test_metric', 'Test Metric', 'currency', 'sum', 'neutral', 'gaap');
     insert into sources (provider, kind, trust_tier, license_class, retrieved_at)
     values ('test_provider', 'internal', 'primary', 'internal', now());`,
  ]);
  assert.equal(setupResult.status, 0, setupResult.stderr || setupResult.stdout);

  const duplicateListingResult = run("docker", [
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
    `insert into listings (instrument_id, mic, ticker, trading_currency, timezone)
     select instrument_id, 'XNAS', 'EXMPL', 'USD', 'UTC' from instruments limit 1;`,
  ]);
  assert.notEqual(duplicateListingResult.status, 0);
  assert.match(
    duplicateListingResult.stderr || duplicateListingResult.stdout,
    /duplicate key value violates unique constraint/,
  );

  const invalidConfidenceResult = run("docker", [
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
       metric_id,
       'fiscal_q',
       now(),
       now(),
       'USD',
       2,
       (select source_id from sources where provider = 'test_provider'),
       'reported'::fact_method,
       1,
       'authoritative'::verification_status,
       'filing_time'::freshness_class,
       'full'::coverage_level
     from metrics
     where metric_key = 'test_metric';`,
  ]);
  assert.notEqual(invalidConfidenceResult.status, 0);
  assert.match(
    invalidConfidenceResult.stderr || invalidConfidenceResult.stdout,
    /violates check constraint/,
  );
});

test("migrate up rolls back schema changes when recording the migration fails", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for db migration integration coverage");
    return;
  }

  const containerName = createContainerName("fra-6al-7-2");
  const password = "postgres";
  const hostPort = startPostgres(containerName, password);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${hostPort}/postgres`;

  t.after(() => {
    stopPostgres(containerName);
  });

  await waitForPostgres(containerName, databaseUrl);

  const triggerResult = run("docker", [
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
    `create table schema_migrations (version text primary key, name text not null, applied_at timestamptz not null default now());
     create function reject_schema_migrations_insert() returns trigger language plpgsql as $$
     begin
       raise exception 'rejecting schema_migrations insert';
     end;
     $$;
     create trigger schema_migrations_reject_insert
       before insert on schema_migrations
       for each row execute function reject_schema_migrations_insert();`,
  ]);
  assert.equal(triggerResult.status, 0, triggerResult.stderr || triggerResult.stdout);

  const upResult = run("npm", ["run", "migrate", "--", "up", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });

  assert.notEqual(upResult.status, 0);
  assert.match(upResult.stderr || upResult.stdout, /rejecting schema_migrations insert/);
  assert.equal(queryValue(containerName, "select count(*) from schema_migrations"), "0");
  assert.equal(
    queryValue(containerName, "select count(*) from pg_tables where schemaname = 'public' and tablename <> 'schema_migrations'"),
    "0",
  );
});

test("migrate down rolls back schema changes when removing the migration record fails", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for db migration integration coverage");
    return;
  }

  const containerName = createContainerName("fra-6al-7-2");
  const password = "postgres";
  const hostPort = startPostgres(containerName, password);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${hostPort}/postgres`;

  t.after(() => {
    stopPostgres(containerName);
  });

  await waitForPostgres(containerName, databaseUrl);

  const upResult = run("npm", ["run", "migrate", "--", "up", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });
  assert.equal(upResult.status, 0, upResult.stderr || upResult.stdout);

  const triggerResult = run("docker", [
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
    `create function reject_schema_migrations_delete() returns trigger language plpgsql as $$
     begin
       raise exception 'rejecting schema_migrations delete';
     end;
     $$;
     create trigger schema_migrations_reject_delete
       before delete on schema_migrations
       for each row execute function reject_schema_migrations_delete();`,
  ]);
  assert.equal(triggerResult.status, 0, triggerResult.stderr || triggerResult.stdout);

  const downResult = run("npm", ["run", "migrate", "--", "down", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });

  assert.notEqual(downResult.status, 0);
  assert.match(downResult.stderr || downResult.stdout, /rejecting schema_migrations delete/);
  assert.equal(queryValue(containerName, "select count(*) from schema_migrations"), "20");
  assert.equal(
    queryValue(containerName, "select count(*) from pg_tables where schemaname = 'public' and tablename = 'agent_run_logs'"),
    "1",
  );
  // Positive proof that the rollback was actually rejected: the most-recent
  // migration's schema change must still be in place. If the runner
  // accidentally executed the down DDL before hitting the trigger block, the
  // schema_migrations row count alone wouldn't catch that — checking the
  // latest migration's actual artifact does. 0020 added the notification_deliveries
  // table; the down would remove it, so its presence is
  // independent proof the down DDL did not execute.
  assert.equal(
    queryValue(
      containerName,
      "select count(*) from pg_tables where schemaname = 'public' and tablename = 'notification_deliveries'",
    ),
    "1",
  );
});

test("migrate down fails when any applied migration is missing locally", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for db migration integration coverage");
    return;
  }

  const containerName = createContainerName("fra-6al-7-2");
  const password = "postgres";
  const hostPort = startPostgres(containerName, password);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${hostPort}/postgres`;

  t.after(() => {
    stopPostgres(containerName);
  });

  await waitForPostgres(containerName, databaseUrl);

  const upResult = run("npm", ["run", "migrate", "--", "up", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });
  assert.equal(upResult.status, 0, upResult.stderr || upResult.stdout);

  const insertMissingResult = run("docker", [
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
    "insert into schema_migrations(version, name) values ('0000', 'missing_local');",
  ]);
  assert.equal(insertMissingResult.status, 0, insertMissingResult.stderr || insertMissingResult.stdout);

  const downResult = run("npm", ["run", "migrate", "--", "down", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });

  assert.notEqual(downResult.status, 0);
  assert.match(downResult.stderr || downResult.stdout, /Applied migration 0000 is missing locally/);
  assert.equal(queryValue(containerName, "select count(*) from schema_migrations"), "21");
  assert.equal(queryValue(containerName, "select count(*) from pg_tables where schemaname = 'public' and tablename = 'users'"), "1");
});

test("migrate up applies 0009 cleanly even when legacy duplicate theme_memberships rows exist", { timeout: 120000 }, async (t) => {
  // Regression: the prior 0009 migration added the unique constraint
  // directly, which would hard-fail on any environment where the
  // race-induced duplicates the constraint is meant to prevent had
  // already happened. The migration now dedupes legacy duplicates
  // before adding the constraint; this test pins that behavior.
  if (!dockerAvailable()) {
    t.skip("Docker is required for db migration integration coverage");
    return;
  }

  const containerName = createContainerName("fra-6al-7-2");
  const password = "postgres";
  const hostPort = startPostgres(containerName, password);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${hostPort}/postgres`;

  registerLifoCleanup(t, () => stopPostgres(containerName));

  await waitForPostgres(containerName, databaseUrl);

  // Apply all migrations, then roll back through 0009 so we land on the
  // schema as it existed before that migration (no unique constraint on
  // theme_memberships). Loop count is total_applied - 8 (rollback through
  // and including 0009) so this stays correct as new migrations land.
  const upResult = run("npm", ["run", "migrate", "--", "up", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });
  assert.equal(upResult.status, 0, upResult.stderr || upResult.stdout);
  const totalApplied = Number(queryValue(containerName, "select count(*) from schema_migrations"));
  const rollbackCount = totalApplied - 8;
  for (let i = 0; i < rollbackCount; i++) {
    const downResult = run("npm", ["run", "migrate", "--", "down", "--database-url", databaseUrl], {
      cwd: dbRoot,
      env: { DATABASE_URL: databaseUrl },
    });
    assert.equal(downResult.status, 0, downResult.stderr || downResult.stdout);
  }
  assert.equal(
    queryValue(
      containerName,
      "select count(*) from pg_constraint where conname = 'theme_memberships_theme_subject_unique'",
    ),
    "0",
    "precondition: 0009's unique constraint must be absent before we seed duplicates",
  );

  // Seed two duplicate (theme_id, subject_kind, subject_id) rows.
  const client = await connectedClient(t, databaseUrl);
  const themeIns = await client.query<{ theme_id: string }>(
    `insert into themes (name, membership_mode, active_from)
     values ('dedupe-test', 'manual', now())
     returning theme_id::text as theme_id`,
  );
  const themeId = themeIns.rows[0].theme_id;
  const subjectId = "11111111-1111-4111-8111-111111111111";
  await client.query(
    `insert into theme_memberships (theme_id, subject_kind, subject_id, score)
     values ($1::uuid, 'issuer'::subject_kind, $2::uuid, 0.5),
            ($1::uuid, 'issuer'::subject_kind, $2::uuid, 0.7)`,
    [themeId, subjectId],
  );
  assert.equal(
    queryValue(
      containerName,
      `select count(*) from theme_memberships where theme_id = '${themeId}' and subject_kind = 'issuer' and subject_id = '${subjectId}'`,
    ),
    "2",
    "precondition: two duplicate rows must exist before re-applying 0009",
  );

  // Re-apply migrations. 0009's dedupe must collapse the duplicates
  // before the unique constraint is added; otherwise the alter table
  // hard-fails.
  const reupResult = run("npm", ["run", "migrate", "--", "up", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });
  assert.equal(reupResult.status, 0, reupResult.stderr || reupResult.stdout);
  assert.equal(
    queryValue(
      containerName,
      `select count(*) from theme_memberships where theme_id = '${themeId}' and subject_kind = 'issuer' and subject_id = '${subjectId}'`,
    ),
    "1",
    "0009 dedupe must collapse duplicates to a single row per (theme_id, subject_kind, subject_id)",
  );
  assert.equal(
    queryValue(
      containerName,
      "select count(*) from pg_constraint where conname = 'theme_memberships_theme_subject_unique'",
    ),
    "1",
    "0009 must successfully add the unique constraint after dedupe",
  );
});

test("migrate up applies 0013 cleanly when legacy duplicate mentions rows exist", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for db migration integration coverage");
    return;
  }

  const containerName = createContainerName("fra-6j0-3");
  const password = "postgres";
  const hostPort = startPostgres(containerName, password);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${hostPort}/postgres`;

  registerLifoCleanup(t, () => stopPostgres(containerName));

  await waitForPostgres(containerName, databaseUrl);

  const upResult = run("npm", ["run", "migrate", "--", "up", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });
  assert.equal(upResult.status, 0, upResult.stderr || upResult.stdout);

  const appliedCount = Number(queryValue(containerName, "select count(*) from schema_migrations"));
  const rollbackCount = appliedCount - 12;
  assert.equal(rollbackCount > 0, true, "precondition: 0013 or newer migrations must be applied before rollback");
  for (let i = 0; i < rollbackCount; i += 1) {
    const downResult = run("npm", ["run", "migrate", "--", "down", "--database-url", databaseUrl], {
      cwd: dbRoot,
      env: { DATABASE_URL: databaseUrl },
    });
    assert.equal(downResult.status, 0, downResult.stderr || downResult.stdout);
  }

  assert.equal(
    queryValue(
      containerName,
      "select count(*) from pg_indexes where schemaname = 'public' and indexname = 'mentions_document_subject_prominence_idx'",
    ),
    "0",
    "precondition: 0013's unique index must be absent before we seed duplicates",
  );

  const seedResult = run("docker", [
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
    `insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at)
     values ('11111111-1111-4111-a111-111111111111', 'test', 'article', 'tertiary', 'public', now());
     insert into documents (document_id, source_id, kind, content_hash, raw_blob_id)
     values (
       '22222222-2222-4222-a222-222222222222',
       '11111111-1111-4111-a111-111111111111',
       'article',
       'sha256:mentions-dedupe',
       'sha256:0000000000000000000000000000000000000000000000000000000000000000'
     );
     insert into mentions (mention_id, document_id, subject_kind, subject_id, prominence, mention_count, confidence)
     values
       ('33333333-3333-4333-a333-333333333331', '22222222-2222-4222-a222-222222222222', 'issuer', '44444444-4444-4444-a444-444444444444', 'headline', 2, 0.4),
       ('33333333-3333-4333-a333-333333333332', '22222222-2222-4222-a222-222222222222', 'issuer', '44444444-4444-4444-a444-444444444444', 'headline', 5, 0.9),
       ('33333333-3333-4333-a333-333333333333', '22222222-2222-4222-a222-222222222222', 'issuer', '44444444-4444-4444-a444-444444444444', 'body', 7, 0.6);`,
  ]);
  assert.equal(seedResult.status, 0, seedResult.stderr || seedResult.stdout);
  assert.equal(
    queryValue(containerName, "select count(*) from mentions where prominence = 'headline'"),
    "2",
    "precondition: duplicate headline mention rows must exist before re-applying 0013",
  );

  const reupResult = run("npm", ["run", "migrate", "--", "up", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });
  assert.equal(reupResult.status, 0, reupResult.stderr || reupResult.stdout);

  assert.equal(
    queryValue(containerName, "select count(*) from mentions"),
    "2",
    "0013 dedupe must keep one row per (document_id, subject_kind, subject_id, prominence)",
  );
  assert.equal(
    queryValue(
      containerName,
      "select mention_count || '|' || confidence from mentions where prominence = 'headline'",
    ),
    "7|0.9",
    "0013 dedupe must preserve aggregate mention_count and strongest confidence",
  );
  assert.equal(
    queryValue(
      containerName,
      "select count(*) from pg_indexes where schemaname = 'public' and indexname = 'mentions_document_subject_prominence_idx'",
    ),
    "1",
    "0013 must successfully add the unique index after dedupe",
  );
});

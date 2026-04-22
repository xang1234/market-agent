# fra-6al.7.2 Migration Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tracked SQL migration runner in `db/` with `up`, `down`, and `status`, plus `0001_init` forward/backward migrations and Docker-backed rollback coverage.

**Architecture:** Keep migrations as plain SQL files in `db/migrations/` and implement a thin TypeScript runner in `db/scripts/migrate.ts`. Reuse the existing `pg` client and Docker-backed Postgres 15 test harness, with `schema_migrations` as the only tracking state outside product tables.

**Tech Stack:** Node 24 with `--experimental-strip-types`, TypeScript-in-place scripts, `pg`, Docker `postgres:15`, SQL migration files, Node test runner.

---

## File Map

- Create: `db/migrations/0001_init.up.sql`
  Responsibility: immutable snapshot of the current normative schema pack.
- Create: `db/migrations/0001_init.down.sql`
  Responsibility: reverse migration that removes product schema objects created by `0001_init` while leaving the migration system usable.
- Create: `db/scripts/migrate.ts`
  Responsibility: CLI entry point for `up`, `down`, and `status`.
- Create: `db/test/migrate.test.ts`
  Responsibility: Docker-backed integration coverage for forward/backward migration behavior.
- Modify: `db/scripts/schema-support.ts`
  Responsibility: add migration discovery, migration-state queries, and shared SQL-file helpers.
- Modify: `db/package.json`
  Responsibility: expose `npm run migrate`.
- Modify: `db/README.md`
  Responsibility: document tracked migration workflow and command usage.

## Task 1: Add Failing Integration Tests for `up` and `status`

**Files:**
- Create: `db/test/migrate.test.ts`
- Test: `db/test/migrate.test.ts`

- [ ] **Step 1: Write the failing integration tests**

```ts
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const workspaceRoot = join(import.meta.dirname, "..", "..");
const dbRoot = join(workspaceRoot, "db");
const schemaPath = join(workspaceRoot, "spec", "finance_research_db_schema.sql");

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
  return `fra-6al-7-2-${process.pid}-${Date.now()}`;
}

function lookupPublishedHostPort(containerName: string) {
  const result = run("docker", ["port", containerName, "5432/tcp"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const mapping = result.stdout.trim();
  const match = mapping.match(/:(\\d+)$/);
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

function loadExpectedTables() {
  return Array.from(
    readFileSync(schemaPath, "utf8").matchAll(/^create table ([a-z_][a-z0-9_]*) \\($/gim),
    (match) => match[1],
  ).sort();
}

test("migrate up applies 0001_init and records it in schema_migrations", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for db migration integration coverage");
    return;
  }

  const containerName = createContainerName();
  const password = "postgres";
  const hostPort = startPostgres(containerName, password);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${hostPort}/postgres`;

  t.after(() => {
    stopPostgres(containerName);
  });

  await waitForPostgres(containerName);

  const migrateResult = run("npm", ["run", "migrate", "--", "up", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });

  assert.equal(migrateResult.status, 0, migrateResult.stderr || migrateResult.stdout);
  assert.equal(queryValue(containerName, "select count(*) from schema_migrations"), "1");
  assert.equal(
    queryValue(containerName, "select version || ':' || name from schema_migrations order by version"),
    "0001:init",
  );

  const publicTableCount = Number(queryValue(containerName, "select count(*) from pg_tables where schemaname = 'public'"));
  assert.ok(publicTableCount >= loadExpectedTables().length);
});

test("migrate status reports 0001_init as applied after migrate up", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for db migration integration coverage");
    return;
  }

  const containerName = createContainerName();
  const password = "postgres";
  const hostPort = startPostgres(containerName, password);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${hostPort}/postgres`;

  t.after(() => {
    stopPostgres(containerName);
  });

  await waitForPostgres(containerName);

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
  assert.match(statusResult.stdout, /0001\\s+init\\s+applied/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
cd db
node --experimental-strip-types --test test/migrate.test.ts
```

Expected: FAIL with `Missing script: "migrate"` and/or missing migration files such as `db/migrations/0001_init.up.sql`.

- [ ] **Step 3: Write the minimal implementation for `up` and `status`**

Create `db/migrations/0001_init.up.sql` by copying the normative schema pack exactly:

```bash
cp spec/finance_research_db_schema.sql \
  db/migrations/0001_init.up.sql
```

Create `db/migrations/0001_init.down.sql` immediately so the migration registry already has a complete pair:

```sql
drop table if exists eval_run_results;
drop table if exists verifier_fail_logs;
drop table if exists citation_logs;
drop table if exists tool_call_logs;
drop table if exists chat_messages;
drop table if exists chat_threads;
drop table if exists run_activities;
drop table if exists findings;
drop table if exists agents;
drop table if exists analyze_templates;
drop table if exists watchlist_members;
drop table if exists watchlists;
drop table if exists snapshots;
drop table if exists computations;
drop table if exists facts;
drop table if exists event_subjects;
drop table if exists events;
drop table if exists claim_cluster_members;
drop table if exists claim_clusters;
drop table if exists claim_evidence;
drop table if exists entity_impacts;
drop table if exists claim_arguments;
drop table if exists claims;
drop table if exists mentions;
drop table if exists documents;
drop table if exists sources;
drop table if exists metrics;
drop table if exists portfolio_holdings;
drop table if exists portfolios;
drop table if exists theme_memberships;
drop table if exists themes;
drop table if exists listings;
drop table if exists instruments;
drop table if exists issuers;
drop table if exists users;

drop type if exists chat_role;
drop type if exists watchlist_mode;
drop type if exists activity_stage;
drop type if exists finding_severity;
drop type if exists event_status;
drop type if exists impact_horizon;
drop type if exists impact_direction;
drop type if exists polarity;
drop type if exists claim_status;
drop type if exists claim_modality;
drop type if exists coverage_level;
drop type if exists freshness_class;
drop type if exists verification_status;
drop type if exists fact_method;
drop type if exists parse_status;
drop type if exists document_kind;
drop type if exists trust_tier;
drop type if exists source_kind;
drop type if exists asset_type;
drop type if exists subject_kind;

drop extension if exists pgcrypto;
```

Update `db/package.json`:

```json
{
  "name": "db",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "engines": {
    "node": ">=22.6.0"
  },
  "scripts": {
    "apply:schema": "node --experimental-strip-types scripts/apply-schema.ts",
    "verify:schema": "node --experimental-strip-types scripts/verify-schema.ts",
    "migrate": "node --experimental-strip-types scripts/migrate.ts",
    "test": "node --experimental-strip-types --test test/**/*.test.ts"
  },
  "dependencies": {
    "pg": "^8.20.0"
  },
  "devDependencies": {
    "@types/pg": "^8.20.0"
  }
}
```

Extend `db/scripts/schema-support.ts` with migration helpers:

```ts
import { readFile, readdir } from "node:fs/promises";
// keep existing imports

const migrationsDir = join(workspaceRoot, "db", "migrations");

export type MigrationFilePair = {
  version: string;
  name: string;
  upPath: string;
  downPath: string;
};

export async function loadSqlFile(filePath: string) {
  return readFile(filePath, "utf8");
}

export async function ensureSchemaMigrationsTable(client: Client) {
  await client.query(`
    create table if not exists schema_migrations (
      version text primary key,
      name text not null,
      applied_at timestamptz not null default now()
    )
  `);
}

export async function listAppliedMigrations(client: Client) {
  const result = await client.query<{ version: string; name: string; applied_at: string }>(
    "select version, name, applied_at::text from schema_migrations order by version",
  );
  return result.rows;
}

export async function loadMigrationFiles() {
  const entries = (await readdir(migrationsDir)).sort();
  const pairs = new Map<string, Partial<MigrationFilePair>>();

  for (const entry of entries) {
    const match = entry.match(/^(\\d{4})_(.+)\\.(up|down)\\.sql$/);
    if (!match) continue;

    const [, version, name, direction] = match;
    const existing = pairs.get(version) ?? { version, name };
    const filePath = join(migrationsDir, entry);

    if (direction === "up") existing.upPath = filePath;
    if (direction === "down") existing.downPath = filePath;

    if (existing.name !== name) {
      throw new Error(`Migration ${version} has inconsistent names: ${existing.name} vs ${name}`);
    }

    pairs.set(version, existing);
  }

  const migrations = Array.from(pairs.values()).map((pair) => {
    if (!pair.version || !pair.name || !pair.upPath || !pair.downPath) {
      throw new Error(`Migration pair is incomplete for version ${pair.version ?? "unknown"}`);
    }

    return pair as MigrationFilePair;
  });

  return migrations.sort((a, b) => a.version.localeCompare(b.version));
}
```

Create `db/scripts/migrate.ts`:

```ts
import {
  applyStatements,
  ensureSchemaMigrationsTable,
  getDatabaseUrl,
  listAppliedMigrations,
  loadMigrationFiles,
  loadSqlFile,
  redactDatabaseUrl,
  splitSqlStatements,
  withClient,
} from "./schema-support.ts";

type Command = "up" | "status";

function getCommand(): Command {
  const command = process.argv[2];
  if (command === "up" || command === "status") return command;
  throw new Error('Usage: npm run migrate -- <up|status> [--database-url <url>]');
}

async function runUp(databaseUrl: string) {
  await withClient(databaseUrl, async (client) => {
    await ensureSchemaMigrationsTable(client);

    const localMigrations = await loadMigrationFiles();
    const applied = await listAppliedMigrations(client);
    const appliedVersions = new Set(applied.map((migration) => migration.version));

    for (const local of localMigrations) {
      if (appliedVersions.has(local.version)) continue;

      const sql = await loadSqlFile(local.upPath);
      await applyStatements(client, splitSqlStatements(sql));
      await client.query(
        "insert into schema_migrations(version, name) values ($1, $2)",
        [local.version, local.name],
      );
    }

    console.log(`Applied pending migrations to ${redactDatabaseUrl(databaseUrl)}`);
  });
}

async function runStatus(databaseUrl: string) {
  await withClient(databaseUrl, async (client) => {
    await ensureSchemaMigrationsTable(client);

    const localMigrations = await loadMigrationFiles();
    const applied = await listAppliedMigrations(client);
    const appliedVersions = new Set(applied.map((migration) => migration.version));

    for (const migration of localMigrations) {
      const state = appliedVersions.has(migration.version) ? "applied" : "pending";
      console.log(`${migration.version} ${migration.name} ${state}`);
    }
  });
}

async function main() {
  const databaseUrl = getDatabaseUrl();
  const command = getCommand();

  if (command === "up") {
    await runUp(databaseUrl);
    return;
  }

  await runStatus(databaseUrl);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
```

- [ ] **Step 4: Run the targeted tests to verify they pass**

Run:

```bash
cd db
node --experimental-strip-types --test test/migrate.test.ts
```

Expected: PASS for:
- `migrate up applies 0001_init and records it in schema_migrations`
- `migrate status reports 0001_init as applied after migrate up`

- [ ] **Step 5: Commit Task 1**

```bash
cd .
git add db/package.json db/migrations/0001_init.up.sql db/migrations/0001_init.down.sql db/scripts/schema-support.ts db/scripts/migrate.ts db/test/migrate.test.ts
git commit -m "feat(db): add migration runner up and status"
```

## Task 2: Add Failing Rollback Tests for `down`

**Files:**
- Modify: `db/test/migrate.test.ts`
- Modify: `db/scripts/migrate.ts`

- [ ] **Step 1: Extend the integration test with rollback coverage**

Append to `db/test/migrate.test.ts`:

```ts
test("migrate down rolls back the most recently applied migration", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for db migration integration coverage");
    return;
  }

  const containerName = createContainerName();
  const password = "postgres";
  const hostPort = startPostgres(containerName, password);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${hostPort}/postgres`;

  t.after(() => {
    stopPostgres(containerName);
  });

  await waitForPostgres(containerName);

  const upResult = run("npm", ["run", "migrate", "--", "up", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });
  assert.equal(upResult.status, 0, upResult.stderr || upResult.stdout);

  const downResult = run("npm", ["run", "migrate", "--", "down", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });
  assert.equal(downResult.status, 0, downResult.stderr || downResult.stdout);

  assert.equal(queryValue(containerName, "select count(*) from schema_migrations"), "0");
  assert.equal(queryValue(containerName, "select count(*) from pg_tables where schemaname = 'public' and tablename <> 'schema_migrations'"), "0");
});

test("migrate down exits cleanly when nothing is applied", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for db migration integration coverage");
    return;
  }

  const containerName = createContainerName();
  const password = "postgres";
  const hostPort = startPostgres(containerName, password);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${hostPort}/postgres`;

  t.after(() => {
    stopPostgres(containerName);
  });

  await waitForPostgres(containerName);

  const downResult = run("npm", ["run", "migrate", "--", "down", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });

  assert.equal(downResult.status, 0, downResult.stderr || downResult.stdout);
  assert.match(downResult.stdout, /No applied migrations to roll back/);
});
```

- [ ] **Step 2: Run the rollback tests to verify they fail**

Run:

```bash
cd db
node --experimental-strip-types --test --test-name-pattern "migrate down" test/migrate.test.ts
```

Expected: FAIL because `migrate.ts` does not yet accept `down`.

- [ ] **Step 3: Implement the `down` command**
The down SQL file already exists from Task 1. Extend the runner to execute it:

Replace `db/scripts/migrate.ts` with:

```ts
import {
  applyStatements,
  ensureSchemaMigrationsTable,
  getDatabaseUrl,
  listAppliedMigrations,
  loadMigrationFiles,
  loadSqlFile,
  redactDatabaseUrl,
  splitSqlStatements,
  withClient,
} from "./schema-support.ts";

type Command = "up" | "down" | "status";

function getCommand(): Command {
  const command = process.argv[2];
  if (command === "up" || command === "down" || command === "status") return command;
  throw new Error('Usage: npm run migrate -- <up|down|status> [--database-url <url>]');
}

async function runUp(databaseUrl: string) {
  await withClient(databaseUrl, async (client) => {
    await ensureSchemaMigrationsTable(client);

    const localMigrations = await loadMigrationFiles();
    const applied = await listAppliedMigrations(client);
    const appliedVersions = new Set(applied.map((migration) => migration.version));

    for (const migration of localMigrations) {
      if (appliedVersions.has(migration.version)) continue;

      const sql = await loadSqlFile(migration.upPath);
      await applyStatements(client, splitSqlStatements(sql));
      await client.query(
        "insert into schema_migrations(version, name) values ($1, $2)",
        [migration.version, migration.name],
      );
      console.log(`Applied ${migration.version} ${migration.name}`);
    }

    console.log(`Migration up complete for ${redactDatabaseUrl(databaseUrl)}`);
  });
}

async function runDown(databaseUrl: string) {
  await withClient(databaseUrl, async (client) => {
    await ensureSchemaMigrationsTable(client);

    const localMigrations = await loadMigrationFiles();
    const localMap = new Map(localMigrations.map((migration) => [migration.version, migration]));
    const applied = await listAppliedMigrations(client);
    const lastApplied = applied.at(-1);

    if (!lastApplied) {
      console.log("No applied migrations to roll back.");
      return;
    }

    const migration = localMap.get(lastApplied.version);
    if (!migration) {
      throw new Error(`Applied migration ${lastApplied.version} is missing locally.`);
    }

    const sql = await loadSqlFile(migration.downPath);
    await applyStatements(client, splitSqlStatements(sql));
    await client.query("delete from schema_migrations where version = $1", [migration.version]);
    console.log(`Rolled back ${migration.version} ${migration.name}`);
  });
}

async function runStatus(databaseUrl: string) {
  await withClient(databaseUrl, async (client) => {
    await ensureSchemaMigrationsTable(client);

    const localMigrations = await loadMigrationFiles();
    const applied = await listAppliedMigrations(client);
    const appliedVersions = new Set(applied.map((migration) => migration.version));

    for (const migration of localMigrations) {
      const state = appliedVersions.has(migration.version) ? "applied" : "pending";
      console.log(`${migration.version} ${migration.name} ${state}`);
    }
  });
}

async function main() {
  const databaseUrl = getDatabaseUrl();
  const command = getCommand();

  if (command === "up") {
    await runUp(databaseUrl);
    return;
  }

  if (command === "down") {
    await runDown(databaseUrl);
    return;
  }

  await runStatus(databaseUrl);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
```

- [ ] **Step 4: Run the rollback tests to verify they pass**

Run:

```bash
cd db
node --experimental-strip-types --test --test-name-pattern "migrate down" test/migrate.test.ts
```

Expected: PASS for:
- `migrate down rolls back the most recently applied migration`
- `migrate down exits cleanly when nothing is applied`

- [ ] **Step 5: Commit Task 2**

```bash
cd .
git add db/migrations/0001_init.down.sql db/scripts/migrate.ts db/test/migrate.test.ts
git commit -m "feat(db): add migration rollback support"
```

## Task 3: Add Migration Validation and Mismatch Guards

**Files:**
- Modify: `db/scripts/schema-support.ts`
- Modify: `db/scripts/migrate.ts`
- Create: `db/test/migration-registry.test.ts`

- [ ] **Step 1: Write failing tests for duplicate, incomplete, and mismatch handling**

Create `db/test/migration-registry.test.ts`:

```ts
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { loadMigrationFiles } from "../scripts/schema-support.ts";

test("loadMigrationFiles rejects incomplete migration pairs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fra-6al-7-2-incomplete-"));
  await writeFile(join(dir, "0001_init.up.sql"), "select 1;");

  await assert.rejects(
    () => loadMigrationFiles(dir),
    /Migration pair is incomplete for version 0001/,
  );
});

test("loadMigrationFiles rejects duplicate version names", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fra-6al-7-2-duplicate-"));
  await writeFile(join(dir, "0001_init.up.sql"), "select 1;");
  await writeFile(join(dir, "0001_init.down.sql"), "select 1;");
  await writeFile(join(dir, "0001_other.up.sql"), "select 1;");
  await writeFile(join(dir, "0001_other.down.sql"), "select 1;");

  await assert.rejects(
    () => loadMigrationFiles(dir),
    /Duplicate migration version 0001/,
  );
});
```

Modify `db/test/migrate.test.ts` by adding one mismatch assertion:

```ts
test("migrate status fails when an applied migration is missing locally", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for db migration integration coverage");
    return;
  }

  const containerName = createContainerName();
  const password = "postgres";
  const hostPort = startPostgres(containerName, password);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${hostPort}/postgres`;

  t.after(() => {
    stopPostgres(containerName);
  });

  await waitForPostgres(containerName);

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
```

- [ ] **Step 2: Run the new validation tests to verify they fail**

Run:

```bash
cd db
node --experimental-strip-types --test test/migration-registry.test.ts test/migrate.test.ts
```

Expected: FAIL because `loadMigrationFiles` does not yet accept a directory override, does not detect duplicate versions cleanly, and `status` does not reject missing-local applied versions.

- [ ] **Step 3: Implement validation guards**

Replace the migration helpers in `db/scripts/schema-support.ts` with:

```ts
export async function loadMigrationFiles(directory = migrationsDir) {
  const entries = (await readdir(directory)).sort();
  const pairs = new Map<string, Partial<MigrationFilePair>>();

  for (const entry of entries) {
    const match = entry.match(/^(\\d{4})_(.+)\\.(up|down)\\.sql$/);
    if (!match) continue;

    const [, version, name, direction] = match;
    const filePath = join(directory, entry);
    const existing = pairs.get(version);

    if (existing && existing.name && existing.name !== name) {
      throw new Error(`Duplicate migration version ${version}`);
    }

    const next = existing ?? { version, name };
    if (direction === "up") next.upPath = filePath;
    if (direction === "down") next.downPath = filePath;
    pairs.set(version, next);
  }

  const migrations = Array.from(pairs.values()).map((pair) => {
    if (!pair.version || !pair.name || !pair.upPath || !pair.downPath) {
      throw new Error(`Migration pair is incomplete for version ${pair.version ?? "unknown"}`);
    }

    return pair as MigrationFilePair;
  });

  return migrations.sort((a, b) => a.version.localeCompare(b.version));
}

export function assertAppliedMigrationsExistLocally(
  localMigrations: MigrationFilePair[],
  appliedVersions: string[],
) {
  const localVersions = new Set(localMigrations.map((migration) => migration.version));
  for (const version of appliedVersions) {
    if (!localVersions.has(version)) {
      throw new Error(`Applied migration ${version} is missing locally.`);
    }
  }
}
```

Update `db/scripts/migrate.ts` to use the guard in both `up` and `status`:

```ts
import {
  applyStatements,
  assertAppliedMigrationsExistLocally,
  ensureSchemaMigrationsTable,
  getDatabaseUrl,
  listAppliedMigrations,
  loadMigrationFiles,
  loadSqlFile,
  redactDatabaseUrl,
  splitSqlStatements,
  withClient,
} from "./schema-support.ts";

// inside runUp and runStatus after fetching localMigrations + applied:
assertAppliedMigrationsExistLocally(
  localMigrations,
  applied.map((migration) => migration.version),
);
```

- [ ] **Step 4: Run the validation tests to verify they pass**

Run:

```bash
cd db
node --experimental-strip-types --test test/migration-registry.test.ts test/migrate.test.ts
```

Expected: PASS for the duplicate/incomplete/missing-local checks plus the existing migration integration cases.

- [ ] **Step 5: Commit Task 3**

```bash
cd .
git add db/scripts/schema-support.ts db/scripts/migrate.ts db/test/migration-registry.test.ts db/test/migrate.test.ts
git commit -m "test(db): validate migration registry invariants"
```

## Task 4: Document and Verify the Full Migration Workflow

**Files:**
- Modify: `db/README.md`
- Modify: `db/test/migrate.test.ts` (only if command output assertions need adjustment)

- [ ] **Step 1: Update README for tracked migrations**

Replace `db/README.md` with:

````md
# DB Bootstrap

Apply the normative schema pack directly:

```bash
cd db
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres npm run apply:schema
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres npm run verify:schema
```

Run tracked migrations:

```bash
cd db
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres npm run migrate -- up
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres npm run migrate -- status
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres npm run migrate -- down
```

Run integration tests:

```bash
cd db
npm test
```

Notes:
- `0001_init.up.sql` is an immutable snapshot of the current normative schema pack.
- `schema_migrations` tracks applied migration versions.
- `down` rolls back one migration per invocation.
````

- [ ] **Step 2: Run the full DB verification suite**

Run:

```bash
cd db
npm test
git diff --check
```

Expected:
- `npm test` PASS with migration integration coverage
- `git diff --check` produces no output

- [ ] **Step 3: Close the bead and sync tracker state**

Run:

```bash
cd .
bd close fra-6al.7.2 --reason "Added tracked SQL migrations with up/down/status plus Docker-backed forward/backward migration coverage."
bd sync
```

Expected:
- `fra-6al.7.2` transitions to `closed`
- `.beads/issues.jsonl` is updated

- [ ] **Step 4: Commit the final documentation/tracker changes**

```bash
cd .
git add db/README.md .beads/issues.jsonl
git commit -m "docs(db): document tracked migration workflow"
```

- [ ] **Step 5: Push and verify the branch is fully landed**

```bash
cd .
git pull --rebase
bd sync
git push
git status --short --branch
```

Expected final status:
- branch shows no local modifications
- branch is up to date with `origin/p0.2.3-route-scope-metadata`

## Plan Self-Review

Spec coverage:
- migration file format/layout: Task 1 and Task 2
- tracking table: Task 1
- runner commands (`up`, `down`, `status`): Task 1 and Task 2
- rollback contract: Task 2
- validation/mismatch handling: Task 3
- Docker-backed forward/backward verification: Task 1, Task 2, Task 4
- documentation: Task 4

Placeholder scan:
- no `TODO`, `TBD`, or “implement later” placeholders remain
- each code-changing step includes concrete code or exact shell commands

Type consistency:
- migration record type is consistently `MigrationFilePair`
- CLI entry point is consistently `db/scripts/migrate.ts`
- commands are consistently `up`, `down`, and `status`

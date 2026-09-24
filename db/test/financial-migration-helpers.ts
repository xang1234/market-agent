// Shared harness for the verified-finance migrations (0046+): one Postgres
// container per test file, separate databases for the fresh canonical schema
// and the frozen-base upgrade path, and a normalized catalog snapshot so
// fresh/upgrade parity is compared exactly rather than by table names.

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { Client } from "pg";
import {
  createContainerName,
  dbRoot,
  registerLifoCleanup,
  startPostgres,
  stopPostgres,
  waitForPostgres,
  workspaceRoot,
} from "./docker-pg.ts";

const FROZEN_BASE_PATH = join(dbRoot, "test", "fixtures", "financial-base-19c84e4.sql");
const CANONICAL_SCHEMA_PATH = join(workspaceRoot, "spec", "finance_research_db_schema.sql");
const MIGRATIONS_DIR = join(dbRoot, "migrations");

export type PostgresServer = { containerName: string; baseUrl: string };

export async function startServer(t: TestContext, prefix: string): Promise<PostgresServer> {
  const containerName = createContainerName(prefix);
  registerLifoCleanup(t, () => stopPostgres(containerName));
  const port = startPostgres(containerName, "postgres");
  const baseUrl = `postgresql://postgres:postgres@127.0.0.1:${port}`;
  await waitForPostgres(containerName, `${baseUrl}/postgres`);
  return { containerName, baseUrl };
}

/** Creates an empty database on the server and returns a connected client. */
export async function createDatabase(t: TestContext, server: PostgresServer, name: string): Promise<Client> {
  const admin = new Client({ connectionString: `${server.baseUrl}/postgres` });
  await admin.connect();
  try {
    await admin.query(`create database ${name}`);
  } finally {
    await admin.end();
  }
  const client = new Client({ connectionString: `${server.baseUrl}/${name}` });
  await client.connect();
  registerLifoCleanup(t, () => client.end().catch(() => {}));
  return client;
}

/** Schema as it existed at the plan base, before any verified-finance migration. */
export async function applyFrozenBase(client: Client): Promise<void> {
  await client.query(await readFile(FROZEN_BASE_PATH, "utf8"));
}

export async function applyCanonicalSchema(client: Client): Promise<void> {
  await client.query(await readFile(CANONICAL_SCHEMA_PATH, "utf8"));
}

export async function applyMigration(client: Client, version: string, direction: "up" | "down"): Promise<void> {
  const file = (await readdir(MIGRATIONS_DIR)).find((name) => name.startsWith(`${version}_`) && name.endsWith(`.${direction}.sql`));
  if (!file) throw new Error(`migration ${version} ${direction} not found`);
  const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
  await client.query("begin");
  try {
    await client.query(sql);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

/** First migration after the frozen base: 0046 onward are the verified-finance migrations. */
const FIRST_FINANCIAL_MIGRATION = "0046";

/** Applies every verified-finance migration in order, as a deployed database would receive them. */
export async function applyFinancialMigrations(client: Client): Promise<void> {
  const versions = [...new Set((await readdir(MIGRATIONS_DIR)).map((name) => name.slice(0, 4)))]
    .filter((version) => /^\d{4}$/u.test(version) && version >= FIRST_FINANCIAL_MIGRATION)
    .sort();
  for (const version of versions) await applyMigration(client, version, "up");
}

export type CatalogSnapshot = Record<"columns" | "constraints" | "indexes" | "views" | "triggers" | "functions" | "enums", string[]>;

/** Order-insensitive description of everything a migration can change in `public`. */
export async function catalogSnapshot(client: Client): Promise<CatalogSnapshot> {
  const rows = async (sql: string) => (await client.query<{ entry: string }>(sql)).rows.map((row) => row.entry).sort();
  return {
    columns: await rows(`
      select c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
             || case when a.attnotnull then ' not null' else '' end
             || coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), '') as entry
        from pg_attribute a
        join pg_class c on c.oid = a.attrelid
        join pg_namespace n on n.oid = c.relnamespace
        left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
       where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped`),
    constraints: await rows(`
      select conrelid::regclass || ' ' || conname || ' ' || pg_get_constraintdef(oid) as entry
        from pg_constraint where connamespace = 'public'::regnamespace`),
    indexes: await rows(`select indexdef as entry from pg_indexes where schemaname = 'public'`),
    views: await rows(`select viewname || ': ' || definition as entry from pg_views where schemaname = 'public'`),
    triggers: await rows(`select pg_get_triggerdef(oid) as entry from pg_trigger where not tgisinternal`),
    functions: await rows(`select pg_get_functiondef(oid) as entry from pg_proc where pronamespace = 'public'::regnamespace`),
    enums: await rows(`
      select t.typname || ': ' || string_agg(e.enumlabel, ', ' order by e.enumsortorder) as entry
        from pg_type t join pg_enum e on e.enumtypid = t.oid
       group by t.typname`),
  };
}

export const IDS = {
  owner: "0f000000-0000-4000-8000-000000000001",
  otherOwner: "0f000000-0000-4000-8000-000000000002",
  issuer: "0f000000-0000-4000-8000-0000000000a1",
  metric: "0f000000-0000-4000-8000-0000000000b1",
  publicSource: "0f000000-0000-4000-8000-0000000000c1",
  privateSource: "0f000000-0000-4000-8000-0000000000c2",
  originalFact: "0f000000-0000-4000-8000-0000000000d1",
  restatedFact: "0f000000-0000-4000-8000-0000000000d2",
  privateFact: "0f000000-0000-4000-8000-0000000000d3",
} as const;

/**
 * Representative pre-migration evidence: an original fact later superseded by a
 * restatement, and a fact from a user's private upload.
 */
export async function seedLegacyEvidence(client: Client): Promise<void> {
  await client.query(`
    insert into users (user_id, email) values
      ('${IDS.owner}', 'owner@example.test'),
      ('${IDS.otherOwner}', 'other@example.test');
    insert into metrics (metric_id, metric_key, display_name, unit_class, aggregation, interpretation, canonical_source_class)
      values ('${IDS.metric}', 'revenue', 'Revenue', 'currency', 'sum', 'higher_is_better', 'filing');
    insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at, user_id) values
      ('${IDS.publicSource}', 'sec_edgar', 'filing', 'primary', 'public', '2024-02-01T00:00:00Z', null),
      ('${IDS.privateSource}', 'user_upload', 'upload', 'user', 'private', '2024-02-02T00:00:00Z', '${IDS.owner}');
    insert into facts (fact_id, subject_kind, subject_id, metric_id, period_kind, period_start, period_end, fiscal_year, fiscal_period,
                       value_num, unit, currency, scale, as_of, reported_at, observed_at, source_id, method,
                       verification_status, freshness_class, coverage_level, confidence, superseded_by, supersedes) values
      ('${IDS.originalFact}', 'issuer', '${IDS.issuer}', '${IDS.metric}', 'fiscal_y', '2023-01-01', '2023-12-31', 2023, 'FY',
       383285000000.123456789012345678, 'currency', 'USD', 1, '2024-01-10T00:00:00Z', '2024-01-10T00:00:00Z', '2024-02-01T00:00:00Z',
       '${IDS.publicSource}', 'reported', 'authoritative', 'filing_time', 'full', 1, '${IDS.restatedFact}', null),
      ('${IDS.restatedFact}', 'issuer', '${IDS.issuer}', '${IDS.metric}', 'fiscal_y', '2023-01-01', '2023-12-31', 2023, 'FY',
       383000000000, 'currency', 'USD', 1, '2024-06-01T00:00:00Z', '2024-06-01T00:00:00Z', '2024-06-02T00:00:00Z',
       '${IDS.publicSource}', 'reported', 'authoritative', 'filing_time', 'full', 1, null, '${IDS.originalFact}'),
      ('${IDS.privateFact}', 'issuer', '${IDS.issuer}', '${IDS.metric}', 'fiscal_y', '2023-01-01', '2023-12-31', 2023, 'FY',
       1, 'currency', 'USD', 1, '2024-02-02T00:00:00Z', null, '2024-02-02T00:00:00Z',
       '${IDS.privateSource}', 'extracted', 'candidate', 'filing_time', 'partial', 0.5, null, null);
  `);
}

/** Asserts that `sql` fails with a message matching `pattern`, inside a savepoint so the client stays usable. */
export async function expectRejected(client: Client, sql: string, pattern: RegExp, params: unknown[] = []): Promise<void> {
  await client.query("begin");
  try {
    await client.query(sql, params);
  } catch (error) {
    await client.query("rollback");
    const message = error instanceof Error ? error.message : String(error);
    if (!pattern.test(message)) throw new Error(`expected rejection matching ${pattern}, got: ${message}`);
    return;
  }
  await client.query("rollback");
  throw new Error(`expected rejection matching ${pattern}, but the statement succeeded`);
}

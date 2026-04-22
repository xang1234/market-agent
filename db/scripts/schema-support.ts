import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(scriptDir, "..", "..");
const schemaPath = join(workspaceRoot, "spec", "finance_research_db_schema.sql");

export function getDatabaseUrl() {
  const argValue = process.argv.find((value) => value.startsWith("--database-url="));
  const splitValue = process.argv.findIndex((value) => value === "--database-url");

  if (argValue) {
    return argValue.slice("--database-url=".length);
  }

  if (splitValue >= 0 && process.argv[splitValue + 1]) {
    return process.argv[splitValue + 1];
  }

  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  throw new Error("DATABASE_URL is required. Pass --database-url <url> or set DATABASE_URL.");
}

export async function loadSchemaSql() {
  return readFile(schemaPath, "utf8");
}

export function loadExpectedTableNames(schemaSql: string) {
  return Array.from(
    schemaSql.matchAll(/^create table ([a-z_][a-z0-9_]*) \($/gim),
    (match) => match[1],
  ).sort();
}

export function splitSqlStatements(schemaSql: string) {
  const statements: string[] = [];
  let currentStatement = "";

  for (const line of schemaSql.split(/\r?\n/)) {
    currentStatement = currentStatement ? `${currentStatement}\n${line}` : line;

    if (line.trim().endsWith(";")) {
      const statement = currentStatement.trim();
      if (statement) {
        statements.push(statement);
      }

      currentStatement = "";
    }
  }

  const trailingStatement = currentStatement.trim();
  if (trailingStatement) {
    statements.push(trailingStatement);
  }

  return statements;
}

export function redactDatabaseUrl(databaseUrl: string) {
  try {
    const parsed = new URL(databaseUrl);
    if (parsed.password) {
      parsed.password = "***";
    }

    return parsed.toString();
  } catch {
    return databaseUrl;
  }
}

export async function withClient<T>(databaseUrl: string, action: (client: Client) => Promise<T>) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    return await action(client);
  } finally {
    await client.end();
  }
}

export async function listPublicTables(client: Client) {
  const result = await client.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public' order by tablename",
  );

  return result.rows.map((row) => row.tablename);
}

export async function extensionInstalled(client: Client, extensionName: string) {
  const result = await client.query<{ installed: boolean }>(
    "select exists(select 1 from pg_extension where extname = $1) as installed",
    [extensionName],
  );

  return result.rows[0]?.installed ?? false;
}

export function diffTables(expectedTables: string[], installedTables: string[]) {
  const expected = new Set(expectedTables);
  const installed = new Set(installedTables);

  return {
    missing: expectedTables.filter((table) => !installed.has(table)),
    extra: installedTables.filter((table) => !expected.has(table)),
  };
}

export async function applyStatements(client: Client, statements: string[]) {
  await client.query("begin");

  try {
    for (const [index, statement] of statements.entries()) {
      try {
        await client.query(statement);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Statement ${index + 1} failed: ${message}`);
      }
    }

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

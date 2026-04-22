import {
  assertAppliedMigrationsExistLocally,
  type MigrationFilePair,
  type Queryable,
  ensureSchemaMigrationsTable,
  executeSql,
  getDatabaseUrl,
  listAppliedMigrations,
  loadMigrationFiles,
  loadSqlFile,
  redactDatabaseUrl,
  withAdvisoryLock,
  withTransaction,
  withClient,
} from "./schema-support.ts";

type Command = "up" | "down" | "status";
const migrationLockKey = "finance_research_db_migrations";

function getCommand(): Command {
  const command = process.argv[2];
  if (command === "up" || command === "down" || command === "status") return command;
  throw new Error('Usage: npm run migrate -- <up|down|status> [--database-url <url>]');
}

async function runUp(databaseUrl: string) {
  const localMigrations = await loadMigrationFiles();

  await withClient(databaseUrl, async (client) => {
    await withMigrationLock(client, async () => {
      await ensureSchemaMigrationsTable(client);

      const applied = await listAppliedMigrations(client);
      assertAppliedMigrationsExistLocally(localMigrations, applied);
      const appliedVersions = new Set(applied.map((migration) => migration.version));

      for (const local of localMigrations) {
        if (appliedVersions.has(local.version)) continue;

        const sql = await loadSqlFile(local.upPath);
        await withTransaction(client, async () => {
          await executeSql(client, sql, `Migration ${local.version} up`);
          await client.query(
            "insert into schema_migrations(version, name) values ($1, $2)",
            [local.version, local.name],
          );
        });
      }
    });

    console.log(`Applied pending migrations to ${redactDatabaseUrl(databaseUrl)}`);
  });
}

async function runStatus(databaseUrl: string) {
  const localMigrations = await loadMigrationFiles();

  await withClient(databaseUrl, async (client) => {
    await ensureSchemaMigrationsTable(client);

    const applied = await listAppliedMigrations(client);
    assertAppliedMigrationsExistLocally(localMigrations, applied);
    const appliedVersions = new Set(applied.map((migration) => migration.version));

    for (const migration of localMigrations) {
      const state = appliedVersions.has(migration.version) ? "applied" : "pending";
      console.log(`${migration.version} ${migration.name} ${state}`);
    }
  });
}

async function runDown(databaseUrl: string) {
  const localMigrations = await loadMigrationFiles();
  const localMap = new Map(localMigrations.map((migration) => [migration.version, migration]));

  await withClient(databaseUrl, async (client) => {
    let rolledBack: MigrationFilePair | null = null;

    await withMigrationLock(client, async () => {
      await ensureSchemaMigrationsTable(client);

      const applied = await listAppliedMigrations(client);
      assertAppliedMigrationsExistLocally(localMigrations, applied);
      const lastApplied = applied.at(-1);

      if (!lastApplied) {
        return;
      }

      const migration = localMap.get(lastApplied.version);
      if (!migration) {
        throw new Error(`Applied migration ${lastApplied.version} is missing locally.`);
      }

      const sql = await loadSqlFile(migration.downPath);
      await withTransaction(client, async () => {
        await executeSql(client, sql, `Migration ${migration.version} down`);
        await client.query("delete from schema_migrations where version = $1", [migration.version]);
      });
      rolledBack = migration;
    });

    if (!rolledBack) {
      console.log("No applied migrations to roll back.");
      return;
    }

    console.log(`Rolled back ${rolledBack.version} ${rolledBack.name}`);
  });
}

async function withMigrationLock<T>(client: Queryable, action: () => Promise<T>) {
  return withAdvisoryLock(client, migrationLockKey, action);
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

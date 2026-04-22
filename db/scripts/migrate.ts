import {
  assertAppliedMigrationsExistLocally,
  ensureSchemaMigrationsTable,
  executeSql,
  getDatabaseUrl,
  listAppliedMigrations,
  loadMigrationFiles,
  loadSqlFile,
  redactDatabaseUrl,
  withTransaction,
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
    assertAppliedMigrationsExistLocally(
      localMigrations,
      applied.map((migration) => migration.version),
    );
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

    console.log(`Applied pending migrations to ${redactDatabaseUrl(databaseUrl)}`);
  });
}

async function runStatus(databaseUrl: string) {
  await withClient(databaseUrl, async (client) => {
    await ensureSchemaMigrationsTable(client);

    const localMigrations = await loadMigrationFiles();
    const applied = await listAppliedMigrations(client);
    assertAppliedMigrationsExistLocally(
      localMigrations,
      applied.map((migration) => migration.version),
    );
    const appliedVersions = new Set(applied.map((migration) => migration.version));

    for (const migration of localMigrations) {
      const state = appliedVersions.has(migration.version) ? "applied" : "pending";
      console.log(`${migration.version} ${migration.name} ${state}`);
    }
  });
}

async function runDown(databaseUrl: string) {
  await withClient(databaseUrl, async (client) => {
    await ensureSchemaMigrationsTable(client);

    const localMigrations = await loadMigrationFiles();
    const localMap = new Map(localMigrations.map((migration) => [migration.version, migration]));
    const applied = await listAppliedMigrations(client);
    assertAppliedMigrationsExistLocally(
      localMigrations,
      applied.map((migration) => migration.version),
    );
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
    await withTransaction(client, async () => {
      await executeSql(client, sql, `Migration ${migration.version} down`);
      await client.query("delete from schema_migrations where version = $1", [migration.version]);
    });
    console.log(`Rolled back ${migration.version} ${migration.name}`);
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

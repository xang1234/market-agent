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

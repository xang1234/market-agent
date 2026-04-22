import {
  applySqlText,
  diffTables,
  getDatabaseUrl,
  listPublicTables,
  loadExpectedTableNames,
  loadSchemaSql,
  redactDatabaseUrl,
  withClient,
} from "./schema-support.ts";

async function main() {
  const databaseUrl = getDatabaseUrl();
  const schemaSql = await loadSchemaSql();
  const expectedTables = loadExpectedTableNames(schemaSql);

  await withClient(databaseUrl, async (client) => {
    await applySqlText(client, schemaSql, "finance_research_db_schema.sql");

    const installedTables = await listPublicTables(client);
    const { missing } = diffTables(expectedTables, installedTables);

    if (missing.length > 0) {
      throw new Error(`Schema apply completed but missing tables: ${missing.join(", ")}`);
    }

    console.log(`Applied finance_research_db_schema.sql to ${redactDatabaseUrl(databaseUrl)}`);
    console.log(`Installed ${installedTables.length} public tables.`);
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});

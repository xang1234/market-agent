import {
  diffTables,
  extensionInstalled,
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
    const installedTables = await listPublicTables(client);
    const { missing, extra } = diffTables(expectedTables, installedTables);
    const hasPgcrypto = await extensionInstalled(client, "pgcrypto");

    if (!hasPgcrypto) {
      throw new Error("pgcrypto extension is not installed.");
    }

    if (missing.length > 0 || extra.length > 0) {
      const issues = [
        missing.length > 0 ? `missing tables: ${missing.join(", ")}` : "",
        extra.length > 0 ? `unexpected tables: ${extra.join(", ")}` : "",
      ].filter(Boolean);

      throw new Error(`Schema verification failed for ${redactDatabaseUrl(databaseUrl)}: ${issues.join("; ")}`);
    }

    console.log(`Schema verification passed for ${redactDatabaseUrl(databaseUrl)}`);
    console.log(`pgcrypto installed; ${installedTables.length} public tables present.`);
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});

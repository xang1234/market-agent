import { readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyStatements,
  getDatabaseUrl,
  loadSqlFile,
  redactDatabaseUrl,
  splitSqlStatements,
  withClient,
} from "./schema-support.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const seedDir = resolve(scriptDir, "..", "seed");

async function loadSeedFiles() {
  const entries = (await readdir(seedDir))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  return entries.map((name) => ({ name, path: join(seedDir, name) }));
}

async function main() {
  const databaseUrl = getDatabaseUrl();
  const seedFiles = await loadSeedFiles();

  if (seedFiles.length === 0) {
    console.log("No seed files found; nothing to do.");
    return;
  }

  await withClient(databaseUrl, async (client) => {
    for (const file of seedFiles) {
      const sql = await loadSqlFile(file.path);
      await applyStatements(client, splitSqlStatements(sql));
      console.log(`Applied seed ${file.name}`);
    }

    console.log(`Seeded ${redactDatabaseUrl(databaseUrl)} (${seedFiles.length} file(s)).`);
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});

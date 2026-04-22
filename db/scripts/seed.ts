import { readdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applySqlText,
  getDatabaseUrl,
  loadSqlFile,
  redactDatabaseUrl,
  withClient,
} from "./schema-support.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const seedDir = resolve(scriptDir, "..", "seed");

async function loadSeedFilePaths() {
  const entries = await readdir(seedDir);
  return entries
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => join(seedDir, name));
}

async function main() {
  const seedPaths = await loadSeedFilePaths();

  if (seedPaths.length === 0) {
    console.log("No seed files found; nothing to do.");
    return;
  }

  const databaseUrl = getDatabaseUrl();

  await withClient(databaseUrl, async (client) => {
    for (const path of seedPaths) {
      const sql = await loadSqlFile(path);
      await applySqlText(client, sql, `seed ${basename(path)}`);
      console.log(`Applied seed ${basename(path)}`);
    }

    console.log(`Seeded ${redactDatabaseUrl(databaseUrl)} (${seedPaths.length} file(s)).`);
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});

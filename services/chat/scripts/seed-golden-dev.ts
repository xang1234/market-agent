// Seeds the golden conversation's frozen dataset (#118) into a dev database, for
// dev-shell's no-keys mode (DEV_NO_KEYS=true, #122). Idempotent: dev-shell runs it on
// every `up`. All-or-nothing: a clash with existing identities rolls back.
import { pathToFileURL } from "node:url";
import { Client } from "pg";

import { GOLDEN_COMPANIES, seedGoldenDataset } from "../test/golden/dataset.ts";

const RESET_COMMAND = "docker compose -f docker-compose.dev.yml --env-file .env.dev down -v";

// Data mode (DEV_MODE=data, #123) must run on live data only. A database left over from
// a frozen mode still holds the authoritative golden facts and long-lived quote/bar
// caches, so a live check would pass on frozen values; refuse it.
export async function assertNoGoldenDataset(databaseUrl: string): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rowCount } = await client.query(`select 1 from issuers where issuer_id = $1::uuid`, [GOLDEN_COMPANIES[0]!.issuer_id]);
    if (rowCount) {
      throw new Error(
        `this database holds the frozen golden dataset (${GOLDEN_COMPANIES.map((c) => c.ticker).join(", ")}) ` +
          `from DEV_NO_KEYS or DEV_MODE=analyst; data mode needs live data only. Reset it first: ${RESET_COMMAND}`,
      );
    }
  } finally {
    await client.end();
  }
}

export async function seedGoldenDevDatabase(databaseUrl: string): Promise<"seeded" | "already-seeded"> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const marker = GOLDEN_COMPANIES[0]!;
    const { rowCount } = await client.query(`select 1 from issuers where issuer_id = $1::uuid`, [marker.issuer_id]);
    if (rowCount) return "already-seeded";

    await client.query("begin");
    try {
      await seedGoldenDataset(client);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      const tickers = GOLDEN_COMPANIES.map((c) => c.ticker).join(", ");
      throw new Error(
        `golden dataset (${tickers}) could not be seeded; this database already has conflicting ` +
          `identities (e.g. provider-hydrated tickers). No-keys mode needs a fresh database: ` +
          RESET_COMMAND,
        { cause: error },
      );
    }
    return "seeded";
  } finally {
    await client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required to seed the golden dataset");
  if (process.argv.includes("--assert-absent")) {
    await assertNoGoldenDataset(databaseUrl);
  } else {
    const outcome = await seedGoldenDevDatabase(databaseUrl);
    console.log(outcome === "seeded" ? "Seeded the golden dataset (frozen mode)." : "Golden dataset already seeded.");
  }
}

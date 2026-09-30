// Seeds the golden conversation's frozen dataset (#118) into a dev database, for
// dev-shell's no-keys mode (DEV_NO_KEYS=true, #122). Idempotent: dev-shell runs it on
// every `up`. All-or-nothing: a clash with existing identities rolls back.
import { pathToFileURL } from "node:url";
import { Client } from "pg";

import { GOLDEN_COMPANIES, seedGoldenDataset } from "../test/golden/dataset.ts";

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
          `docker compose -f docker-compose.dev.yml --env-file .env.dev down -v`,
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
  const outcome = await seedGoldenDevDatabase(databaseUrl);
  console.log(outcome === "seeded" ? "Seeded the golden dataset (no-keys mode)." : "Golden dataset already seeded.");
}

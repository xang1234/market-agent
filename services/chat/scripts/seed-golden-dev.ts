// Seeds the golden conversation's frozen dataset (#118) into a dev database, for
// dev-shell's no-keys mode (DEV_NO_KEYS=true, #122). Idempotent: dev-shell runs it on
// every `up`. All-or-nothing: a clash with existing identities rolls back.
import { pathToFileURL } from "node:url";
import { Client } from "pg";

import { GOLDEN_COMPANIES, GOLDEN_SOURCE_ID, GoldenFactMismatchError, seedFiledClaims, seedGoldenDataset, seedGoldenProofs } from "../test/golden/dataset.ts";

const RESET_COMMAND = "docker compose -f docker-compose.dev.yml --env-file .env.dev down -v";
const UNIQUE_VIOLATION = "23505";

// Seeded once the marker issuer or the golden source is on file. repair:issuer-splits merges a golden
// issuer into the live issuer of its ticker (#597), and its facts keep the golden source.
async function holdsGoldenDataset(client: Client): Promise<boolean> {
  const { rowCount } = await client.query(
    `select 1 from issuers where issuer_id = $1::uuid union all select 1 from sources where source_id = $2::uuid`,
    [GOLDEN_COMPANIES[0]!.issuer_id, GOLDEN_SOURCE_ID],
  );
  return Boolean(rowCount);
}

// Data mode (DEV_MODE=data, #123) must run on live data only. A database left over from
// a frozen mode still holds the authoritative golden facts and long-lived quote/bar
// caches, so a live check would pass on frozen values; refuse it.
export async function assertNoGoldenDataset(databaseUrl: string): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    if (await holdsGoldenDataset(client)) {
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
    if (await holdsGoldenDataset(client)) {
      await client.query("begin");
      try {
        // Databases seeded before #597 hold CIKs with leading zeros. A CIK another issuer already holds keeps them until repair:issuer-splits merges that issuer.
        await client.query(
          `update issuers iss set cik = g.cik, updated_at = now()
             from unnest($1::uuid[], $2::text[]) as g(issuer_id, cik)
            where iss.issuer_id = g.issuer_id and iss.cik <> g.cik and ltrim(iss.cik, '0') = g.cik
              and not exists (select 1 from issuers other where other.cik = g.cik)`,
          [GOLDEN_COMPANIES.map((c) => c.issuer_id), GOLDEN_COMPANIES.map((c) => c.cik)],
        );
        await seedFiledClaims(client);
        await seedGoldenProofs(client);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        if (!(error instanceof GoldenFactMismatchError)) throw error;
        throw new Error(
          `golden dataset (${GOLDEN_COMPANIES.map((c) => c.ticker).join(", ")}) is seeded, but its facts differ from ` +
            `the dataset (${error.message}), so its proofs could not be added. Reset it: ${RESET_COMMAND}`,
          { cause: error },
        );
      }
      return "already-seeded";
    }

    await client.query("begin");
    try {
      await seedGoldenDataset(client);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      if ((error as { code?: unknown }).code !== UNIQUE_VIOLATION) throw error;
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

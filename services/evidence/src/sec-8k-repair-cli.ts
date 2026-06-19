// One-time repair of legacy document-only 8-K filings (fra-5uf7).
//
//   DATABASE_URL=... SEC_EDGAR_USER_AGENT=... npm run repair:sec-8k
//
// Finds 8-K documents the old generic backfill stored with no typed artifacts, re-fetches
// each filing's header for its item codes + filing date, and attaches the events +
// material_event claims to the EXISTING document (reusing its source). Idempotent: a
// repaired document drops out of the candidate set, so a rerun only processes the rest.
import { Pool } from "pg";
import { SecEdgarClient } from "./sec-edgar.ts";
import { runRepair8kDrain } from "./sec-8k-repair.ts";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const secClient = SecEdgarClient.fromEnv();
  const pool = new Pool({ connectionString: databaseUrl });
  let result;
  try {
    result = await runRepair8kDrain({ db: pool, secClient }, {
      onDocument: (candidate, outcome) => {
        if (typeof outcome === "object") {
          console.error(
            `${candidate.accession}: failed —`,
            outcome.error instanceof Error ? outcome.error.message : outcome.error,
          );
        } else {
          console.log(`${candidate.accession} (${candidate.form}): ${outcome}`);
        }
      },
    });
  } finally {
    await pool.end();
  }
  console.log(
    `done: ${result.repaired} repaired, ${result.untracked} untracked, ${result.no_items} no-items, ` +
      `${result.no_date} no-date, ${result.failed} failed`,
  );
  // Per-document failures are logged and the drain continues, but automation must still
  // see a non-zero exit when any document failed.
  if (result.failed > 0) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

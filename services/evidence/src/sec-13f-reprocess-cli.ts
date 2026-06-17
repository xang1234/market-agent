// Harvest CUSIP→issuer mappings from the seeded superinvestors' 13F filings and
// reprocess the holdings read model (fra-msx1).
//
//   DATABASE_URL=... SEC_EDGAR_USER_AGENT=... OPENFIGI_REFERENCE_ENABLED=true \
//     [OPENFIGI_API_KEY=...] npm run reprocess:sec-13f [-- <cik> ...]
//
// With no args, reprocesses every seeded superinvestor filer. For each filer's recent
// 13F-HR filings it enriches every reported CUSIP via OpenFIGI (so previously
// unresolved holdings become resolvable), then re-resolves + upserts the read model.
// Read-model only (no position-change claims; fra-su3m). Idempotent: insertHolding
// upserts. No S3 is needed — the reprocess refreshes the read model, it does not
// re-archive the filing (already stored at first ingest).
import { Pool } from "pg";
import { SecEdgarClient } from "./sec-edgar.ts";
import { reprocessFiler13f } from "./sec-13f-reprocess.ts";
import { SUPERINVESTOR_FILERS } from "./superinvestor-filers.ts";
import { openReferenceProviderConfigFromEnv } from "../../resolver/src/provider-sources.ts";

// Exported for tests: parse + validate the requested CIKs (positive integers),
// de-duped. Empty argv → all seeded superinvestor filers.
export function parseFilerCikArgs(argv: ReadonlyArray<string>): number[] {
  const requested = argv.map((a) => a.trim()).filter((a) => a.length > 0);
  if (requested.length === 0) {
    return [...SUPERINVESTOR_FILERS.keys()].map((cik) => Number(cik));
  }
  const ciks = requested.map((a) => Number(a));
  const invalid = requested.filter((_, i) => !Number.isInteger(ciks[i]) || ciks[i]! <= 0);
  if (invalid.length > 0) {
    throw new Error(`invalid CIK(s): ${invalid.join(", ")} (expected positive integers)`);
  }
  return [...new Set(ciks)];
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const openfigi = openReferenceProviderConfigFromEnv(process.env).openfigi;
  if (!openfigi.enabled) throw new Error("OPENFIGI_REFERENCE_ENABLED=true is required to harvest CUSIPs");

  const ciks = parseFilerCikArgs(process.argv.slice(2));
  const secClient = SecEdgarClient.fromEnv();
  const pool = new Pool({ connectionString: databaseUrl });
  let hadFailures = false;
  try {
    for (const cik of ciks) {
      try {
        const result = await reprocessFiler13f({ db: pool, secClient, openfigi }, { cik });
        console.log(
          `CIK ${cik}: ${result.accessionsProcessed} accession(s), ` +
            `${result.cusipsEnriched} CUSIP(s) enriched, ${result.cusipsUnmapped} unmapped, ` +
            `${result.holdingsUpserted} holding(s) upserted`,
        );
      } catch (error) {
        hadFailures = true;
        console.error(`CIK ${cik}: 13F reprocess failed —`, error instanceof Error ? error.message : error);
      }
    }
  } finally {
    await pool.end();
  }
  // Per-filer failures are logged and the loop continues, but automation must still
  // see a non-zero exit when any filer failed.
  if (hadFailures) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

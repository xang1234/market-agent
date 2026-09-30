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
  const parsed = requested.map((raw) => ({ raw, cik: Number(raw) }));
  const invalid = parsed.filter((p) => !Number.isInteger(p.cik) || p.cik <= 0);
  if (invalid.length > 0) {
    throw new Error(`invalid CIK(s): ${invalid.map((p) => p.raw).join(", ")} (expected positive integers)`);
  }
  return [...new Set(parsed.map((p) => p.cik))];
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const openfigi = openReferenceProviderConfigFromEnv(process.env).openfigi;
  if (!openfigi.enabled) throw new Error("OPENFIGI_REFERENCE_ENABLED=true is required to harvest CUSIPs");

  const ciks = parseFilerCikArgs(process.argv.slice(2));
  const secClient = SecEdgarClient.fromEnv();
  // Build the pool directly rather than via createEvidenceCliRuntime: that runtime
  // hard-requires S3 env to construct an object store, which this read-model refresh
  // never uses (it reuses the already-archived source, it does not re-ingest blobs).
  const pool = new Pool({ connectionString: databaseUrl });
  let hadFailures = false;
  try {
    for (const cik of ciks) {
      try {
        const result = await reprocessFiler13f({ db: pool, secClient, openfigi }, { cik });
        console.log(
          `CIK ${cik}: ${result.accessionsProcessed} accession(s), ` +
            `${result.cusipsEnriched} CUSIP(s) enriched, ${result.cusipsUnmapped} unmapped, ` +
            `${result.holdingsUpserted} holding(s) upserted, ${result.supersededSkipped} superseded-skipped`,
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

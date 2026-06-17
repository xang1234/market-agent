// Enrich instruments with CUSIP→issuer mappings via OpenFIGI.
//
//   DATABASE_URL=... OPENFIGI_REFERENCE_ENABLED=true [OPENFIGI_API_KEY=...] \
//     npm run enrich:cusips -- <cusip> [<cusip> ...]
//
// A CLI/batch step (not part of the 13F ingest path): feed it the CUSIPs of
// unresolved holdings and it gets-or-creates the issuer/instrument and records
// the cusip, so subsequent 13F resolution hits the fast DB path.
import { Pool } from "pg";
import { openReferenceProviderConfigFromEnv } from "./provider-sources.ts";
import { enrichCusip, type EnrichCusipResult } from "./cusip-enrichment.ts";

// Exported for tests: validate (9-char alphanumeric), uppercase, and de-dupe the
// requested CUSIPs; throw on a malformed one so a typo fails loudly.
export function parseCusipArgs(argv: ReadonlyArray<string>): string[] {
  const cusips = argv.map((arg) => arg.trim().toUpperCase()).filter((arg) => arg.length > 0);
  const invalid = cusips.filter((cusip) => !/^[0-9A-Z]{9}$/.test(cusip));
  if (invalid.length > 0) {
    throw new Error(`invalid CUSIP(s): ${invalid.join(", ")} (expected 9 alphanumeric characters)`);
  }
  return [...new Set(cusips)];
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const cusips = parseCusipArgs(process.argv.slice(2));
  if (cusips.length === 0) throw new Error("provide at least one CUSIP");
  const openfigi = openReferenceProviderConfigFromEnv(process.env).openfigi;
  if (!openfigi.enabled) throw new Error("OPENFIGI_REFERENCE_ENABLED=true is required");

  const pool = new Pool({ connectionString: databaseUrl });
  const counts: Record<EnrichCusipResult["status"], number> = { already: 0, enriched: 0, unmapped: 0 };
  let hadFailures = false;
  try {
    for (const cusip of cusips) {
      try {
        const result = await enrichCusip({ db: pool, openfigi }, cusip);
        counts[result.status] += 1;
        const detail = [result.ticker, result.issuer_id && `→ ${result.issuer_id}`].filter(Boolean).join(" ");
        console.log(`${cusip}: ${result.status}${detail ? ` ${detail}` : ""}`);
      } catch (error) {
        hadFailures = true;
        console.error(`${cusip}: failed —`, error instanceof Error ? error.message : error);
      }
    }
    console.log(`done: ${counts.enriched} enriched, ${counts.already} already, ${counts.unmapped} unmapped`);
  } finally {
    await pool.end();
  }
  if (hadFailures) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

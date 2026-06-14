import { Pool } from "pg";
import { loadArtifactConfig } from "./config.ts";
import { fetchWeeklyBundle, fetchWeeklyManifest } from "./release-client.ts";
import { runWeeklyReferenceEtl } from "./etl.ts";

// Entrypoint for the weekly-reference ETL job (npm run job:weekly-reference). All
// IO lives here; the orchestrator (etl.ts) is pure of fetch/pool/env. Idempotent —
// the ledger sha256 gate makes an extra run a cheap no-op. Pass --force to re-ingest.
async function main(): Promise<void> {
  const config = loadArtifactConfig(process.env);
  if (!config.enabled) {
    console.log("screener-artifacts ETL disabled (set SCREENER_ARTIFACTS_ENABLE=true). Exiting.");
    return;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  const force = process.argv.includes("--force");

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    for (const market of config.markets) {
      const label = `weekly-reference ${market}`;
      try {
        const manifest = await fetchWeeklyManifest(config, market);
        const bundle = await fetchWeeklyBundle(config, manifest);
        const report = await runWeeklyReferenceEtl(pool, manifest, bundle, { force });
        console.log(
          `${label}: ${report.status} as_of=${manifest.as_of_date} total=${report.rowsTotal} ` +
            `ingested=${report.rowsIngested} skipped=${report.rowsSkipped} facts=${report.factsWritten} ` +
            `batch=${report.ingestionBatchId ?? "-"}`,
        );
        if (report.errorSamples.length > 0) {
          console.warn(`${label}: ${report.errorSamples.length} sample row errors → ${report.errorSamples.join(" | ")}`);
        }
      } catch (error) {
        process.exitCode = 1;
        console.error(`${label}: failed — ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});

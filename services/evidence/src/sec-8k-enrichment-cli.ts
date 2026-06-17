// Enrich high-severity 8-K material-event claims with an LLM narrative (fra-ajvd.6).
//
//   DATABASE_URL=... SEC_EDGAR_USER_AGENT=... \
//     LLM_CHANNELS=<provider> LLM_<PROVIDER>_BASE_URL=... LLM_<PROVIDER>_API_KEY=... \
//     LLM_<PROVIDER>_MODELS=<model> LITELLM_MODEL=<provider>/<model> \
//     npm run enrich:sec-8k
//   (or point LLM_SETTINGS_ENV_FILE=<path> at a file with the same vars.)
//
// Finds high-severity 8-K claims not yet enriched, re-fetches each filing, LLM-extracts
// a description of what happened, and records it as a separate material_event.<type>.detail
// claim on the same event (the deterministic claim is left untouched). A batch step, never
// the atomic crawl (the LLM call is external/slow). Idempotent: enriched_at marks the
// deterministic claim processed, so a rerun only processes claims added since the last run.
import { Pool } from "pg";
import { SecEdgarClient } from "./sec-edgar.ts";
import { runEnrich8kDrain } from "./sec-8k-enrichment.ts";
import { createLlmRouterFromEnv } from "../../llm/src/settings-loader.ts";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const llm = await createLlmRouterFromEnv(process.env);
  if (!llm) {
    throw new Error(
      "no LLM deployment configured — set LLM_CHANNELS + the channel's " +
        "LLM_<PROVIDER>_{BASE_URL,API_KEY,MODELS} and LITELLM_MODEL=<provider>/<model> " +
        "(or LLM_SETTINGS_ENV_FILE=<path>); a model not present in its channel's LLM_<PROVIDER>_MODELS yields no deployment",
    );
  }

  const secClient = SecEdgarClient.fromEnv();
  const pool = new Pool({ connectionString: databaseUrl });
  let result;
  try {
    result = await runEnrich8kDrain({ db: pool, llm, secClient }, {
      onClaim: (candidate, outcome) => {
        if (typeof outcome === "object") {
          console.error(
            `${candidate.accession} (${candidate.eventType}): failed —`,
            outcome.error instanceof Error ? outcome.error.message : outcome.error,
          );
        } else {
          console.log(`${candidate.accession} (${candidate.eventType}): ${outcome}`);
        }
      },
    });
  } finally {
    await pool.end();
  }
  console.log(
    `done: ${result.enriched} enriched, ${result.empty} empty, ${result.unparseable} unparseable, ` +
      `${result.noop} already-done, ${result.failed} failed`,
  );
  // Per-claim failures are logged and the drain continues, but automation must still see
  // a non-zero exit when any claim failed.
  if (result.failed > 0) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

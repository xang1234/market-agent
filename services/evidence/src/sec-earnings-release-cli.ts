// Extract management's explanations and guidance from earnings-release 8-Ks
// (sec-earnings-release-extraction.ts).
//
//   DATABASE_URL=... SEC_EDGAR_USER_AGENT=... \
//     LLM_CHANNELS=<provider> LLM_<PROVIDER>_BASE_URL=... LLM_<PROVIDER>_API_KEY=... \
//     LLM_<PROVIDER>_MODELS=<model> LITELLM_MODEL=<provider>/<model> \
//     npm run extract:earnings-releases
//   (or point LLM_SETTINGS_ENV_FILE=<path> at a file with the same vars.)
//
// Finds Item 2.02 8-Ks not yet processed, re-fetches each, and stores the
// verbatim management statements a model picks from its EX-99 exhibits. A batch
// step, never the atomic crawl (the model call is external and slow).
// Idempotent: enriched_at marks each Item 2.02 claim processed.
import { Pool } from "pg";
import { createLlmRouterFromEnv } from "../../llm/src/settings-loader.ts";
import { runReleaseExtractionDrain, type ExtractReleaseDrainResult } from "./sec-earnings-release-extraction.ts";
import { SecEdgarClient } from "./sec-edgar.ts";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const llm = await createLlmRouterFromEnv(process.env, { purpose: "extraction" });
  if (!llm) {
    throw new Error(
      "no LLM deployment configured — set LLM_CHANNELS + the channel's " +
        "LLM_<PROVIDER>_{BASE_URL,API_KEY,MODELS} and LITELLM_MODEL=<provider>/<model> " +
        "(or LLM_SETTINGS_ENV_FILE=<path>)",
    );
  }
  const secClient = SecEdgarClient.fromEnv();
  const pool = new Pool({ connectionString: databaseUrl });
  let result;
  try {
    result = await runReleaseExtractionDrain({ db: pool, llm, secClient }, {
      onClaim: (candidate, outcome) => {
        if (typeof outcome === "object") {
          console.error(`${candidate.accession}: failed —`, outcome.error instanceof Error ? outcome.error.message : outcome.error);
        } else {
          console.log(`${candidate.accession}: ${outcome}`);
        }
      },
    });
  } finally {
    await pool.end();
  }
  console.log(
    `done: ${result.extracted} extracted, ${result.empty} empty, ${result.unparseable} unparseable, ` +
      `${result.no_exhibits} without exhibits, ${result.noop} already-done, ${result.failed} failed`,
  );
  // Per-filing failures are logged and the drain continues, but automation must
  // still see a non-zero exit when any filing is left to retry.
  if (drainIncomplete(result)) process.exitCode = 1;
}

// A filing that failed, or that the model answered badly, is left unread for
// the next run.
export function drainIncomplete(result: ExtractReleaseDrainResult): boolean {
  return result.failed > 0 || result.unparseable > 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

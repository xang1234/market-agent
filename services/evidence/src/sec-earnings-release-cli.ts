// Extract management's explanations and guidance from earnings-release 8-Ks
// (sec-earnings-release-extraction.ts).
//
//   DATABASE_URL=... SEC_EDGAR_USER_AGENT=... \
//     LLM_CHANNELS=<provider> LLM_<PROVIDER>_BASE_URL=... LLM_<PROVIDER>_API_KEY=... \
//     LLM_<PROVIDER>_MODELS=<model> LITELLM_MODEL=<provider>/<model> \
//     npm run extract:earnings-releases [-- --rebind [--retry] [--limit N]]
//   (or point LLM_SETTINGS_ENV_FILE=<path> at a file with the same vars.)
//
// Finds Item 2.02 8-Ks not yet processed, re-fetches each, and stores the
// verbatim management statements a model picks from its EX-99 exhibits. A batch
// step, never the atomic crawl (the model call is external and slow).
// Idempotent: enriched_at marks each Item 2.02 claim processed.
// --rebind instead binds explanations already stored with no fiscal period, in
// place, reading each release once (#542). --retry first clears the marks on
// those a rebind read but could not bind, so it reads them again; --limit N
// reads at most N releases.
import { parseArgs } from "node:util";
import { Pool } from "pg";
import { logPoolErrors } from "../../shared/src/pool-client.ts";
import { createLlmRouterFromEnv } from "../../llm/src/settings-loader.ts";
import {
  clearRebindMarks,
  runRebindDrain,
  runReleaseExtractionDrain,
  type ExtractReleaseDrainResult,
  type RebindDrainResult,
} from "./sec-earnings-release-extraction.ts";
import { SecEdgarClient } from "./sec-edgar.ts";

async function main(): Promise<void> {
  const { values: flags } = parseArgs({ options: { rebind: { type: "boolean" }, retry: { type: "boolean" }, limit: { type: "string" } } });
  const limit = flags.limit === undefined ? undefined : Number(flags.limit);
  if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) throw new Error("--limit takes a whole number of releases");
  if (!flags.rebind && (flags.retry || limit !== undefined)) throw new Error("--retry and --limit apply to --rebind");
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
  const pool = logPoolErrors(new Pool({ connectionString: databaseUrl }));
  const report = (accession: string, outcome: string | { error: unknown }) => {
    if (typeof outcome === "object") {
      console.error(`${accession}: failed —`, outcome.error instanceof Error ? outcome.error.message : outcome.error);
    } else {
      console.log(`${accession}: ${outcome}`);
    }
  };
  let incomplete: boolean;
  try {
    if (flags.rebind) {
      if (flags.retry) console.log(`retry: ${await clearRebindMarks(pool)} explanations to read again`);
      const result = await runRebindDrain({ db: pool, llm, secClient }, {
        limit,
        onRelease: (candidate, read) =>
          report(candidate.accession, "error" in read ? read : read.unlocated > 0 ? `${read.outcome}, ${read.unlocated} unlocated` : read.outcome),
      });
      console.log(
        `done: ${result.bound} bound, ${result.unbound} unbound, ${result.unparseable} unparseable, ` +
          `${result.noop} already-done, ${result.unasked} with none located, ${result.failed} failed; ${result.unlocated} sentences unlocated`,
      );
      incomplete = drainIncomplete(result);
    } else {
      const result = await runReleaseExtractionDrain({ db: pool, llm, secClient }, { onClaim: (candidate, outcome) => report(candidate.accession, outcome) });
      console.log(
        `done: ${result.extracted} extracted, ${result.empty} empty, ${result.unparseable} unparseable, ` +
          `${result.no_exhibits} without exhibits, ${result.noop} already-done, ${result.failed} failed`,
      );
      incomplete = drainIncomplete(result);
    }
  } finally {
    await pool.end();
  }
  // Per-filing failures are logged and the drain continues, but automation must
  // still see a non-zero exit when any filing is left to retry.
  if (incomplete) process.exitCode = 1;
}

// A filing that failed, or that the model answered badly, is left unread for
// the next run, as is a stored sentence a rebind could not locate.
export function drainIncomplete(result: ExtractReleaseDrainResult | RebindDrainResult): boolean {
  return result.failed > 0 || result.unparseable > 0 || ("unlocated" in result && result.unlocated > 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

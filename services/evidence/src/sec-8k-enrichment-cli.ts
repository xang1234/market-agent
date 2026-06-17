// Enrich high-severity 8-K material-event claims with an LLM narrative (fra-ajvd.6).
//
//   DATABASE_URL=... SEC_EDGAR_USER_AGENT=... LITELLM_MODEL=... LLM_<provider>_API_KEY=... \
//     npm run enrich:sec-8k
//
// Finds high-severity 8-K claims not yet enriched, re-fetches each filing, LLM-extracts
// a description of what happened, and augments the claim text in place. A batch step,
// never the atomic crawl (the LLM call is external/slow). Idempotent: enriched_at gates
// re-enrichment, so a rerun only processes claims added since the last run.
import { Pool } from "pg";
import { SecEdgarClient } from "./sec-edgar.ts";
import { findEnrich8kCandidates, enrich8kClaim, type Enrich8kOutcome } from "./sec-8k-enrichment.ts";
import { createLlmRouterFromEnv } from "../../llm/src/settings-loader.ts";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const llm = await createLlmRouterFromEnv(process.env);
  if (!llm) throw new Error("no LLM deployment configured (set LITELLM_MODEL + a provider API key/base URL)");

  const secClient = SecEdgarClient.fromEnv();
  const pool = new Pool({ connectionString: databaseUrl });
  const counts: Record<Enrich8kOutcome, number> = { enriched: 0, empty: 0, unparseable: 0 };
  let hadFailures = false;
  try {
    const candidates = await findEnrich8kCandidates(pool);
    console.log(`[enrich:sec-8k] ${candidates.length} high-severity claim(s) to enrich`);
    for (const candidate of candidates) {
      try {
        const outcome = await enrich8kClaim({ db: pool, llm, secClient }, candidate);
        counts[outcome] += 1;
        console.log(`${candidate.accession} (${candidate.eventType}): ${outcome}`);
      } catch (error) {
        hadFailures = true;
        console.error(
          `${candidate.accession} (${candidate.eventType}): failed —`,
          error instanceof Error ? error.message : error,
        );
      }
    }
    console.log(`done: ${counts.enriched} enriched, ${counts.empty} empty, ${counts.unparseable} unparseable`);
  } finally {
    await pool.end();
  }
  // Per-claim failures are logged and the loop continues, but automation must still see
  // a non-zero exit when any claim failed.
  if (hadFailures) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

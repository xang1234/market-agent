// Extract business and risk claims from 10-Ks (sec-10k-claims.ts).
//
//   DATABASE_URL=... S3_*=... LLM_*=... SEC_EDGAR_USER_AGENT=... \
//     npm run extract:10k-claims -- --file <10-K.htm> --ticker <TICKER>
//     npm run extract:10k-claims -- --backfill [--ticker <TICKER> ...] [--limit N] [--concurrency N]
//
// --file reads a local 10-K and sends no SEC request. --backfill reads each
// issuer's latest 10-K from EDGAR, every issuer with a CIK unless --ticker
// names some, behind the client's Fair Access limiter. A document is read
// once, so a rerun adds no rows and calls no model.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { createLlmRouterFromEnv } from "../../llm/src/settings-loader.ts";
import { createEvidenceCliRuntime } from "./evidence-cli-runtime.ts";
import {
  backfillIssuer10k,
  extract10kClaims,
  resolveCompetitorByName,
  storeTenK,
  type Extract10kResult,
  type TenKBackfillDeps,
} from "./sec-10k-claims.ts";
import type { QueryExecutor } from "./types.ts";

export function resultLine(result: Extract10kResult, ms: number): string {
  return `outcome=${result.outcome} extracted=${result.extracted} dropped_unquoted=${result.droppedUnquoted} ` +
    `competitors=${result.competitors.resolved}/${result.competitors.named} missing=${result.missing.join(",") || "none"} ` +
    `ms=${ms} llm_calls=${result.llmCalls}`;
}

type Issuer = { issuer_id: string; legal_name: string; cik: string | null; ticker: string | null };

async function issuers(db: QueryExecutor, tickers: string[]): Promise<Issuer[]> {
  const { rows } = await db.query<Issuer>(
    `select distinct on (iss.issuer_id) iss.issuer_id::text as issuer_id, iss.legal_name, iss.cik, l.ticker
       from issuers iss
       left join instruments i on i.issuer_id = iss.issuer_id
       left join listings l on l.instrument_id = i.instrument_id and (l.active_to is null or l.active_to > now())
      where ($1::text[] is null and iss.cik is not null) or l.ticker = any($1::text[])
      order by iss.issuer_id, l.ticker`,
    [tickers.length > 0 ? tickers.map((ticker) => ticker.toUpperCase()) : null],
  );
  return rows.sort((a, b) => a.legal_name.localeCompare(b.legal_name));
}

async function main(): Promise<void> {
  const { values: flags } = parseArgs({
    options: {
      file: { type: "string" },
      ticker: { type: "string", multiple: true },
      backfill: { type: "boolean" },
      limit: { type: "string" },
      concurrency: { type: "string" },
    },
  });
  const tickers = flags.ticker ?? [];
  const limit = flags.limit === undefined ? Infinity : Number(flags.limit);
  const concurrency = flags.concurrency === undefined ? 1 : Number(flags.concurrency);
  if (!(limit === Infinity || (Number.isInteger(limit) && limit > 0))) throw new Error("--limit takes a whole number of issuers");
  if (!(Number.isInteger(concurrency) && concurrency > 0 && concurrency <= 8)) throw new Error("--concurrency takes 1 to 8");
  if (flags.backfill === (flags.file !== undefined)) throw new Error("pass one of --file <path> --ticker <TICKER>, or --backfill");
  if (flags.file !== undefined && tickers.length !== 1) throw new Error("--file needs one --ticker");

  // Run with --env-file=.env.dev, as the verify boot recipe does, the dev
  // stack's Postgres is named only by its parts.
  const { DEV_POSTGRES_USER: user = "postgres", DEV_POSTGRES_PASSWORD: password = "postgres", DEV_POSTGRES_PORT: port, DEV_POSTGRES_DB: database = "market_agent" } = process.env;
  if (!process.env.DATABASE_URL && port) process.env.DATABASE_URL = `postgresql://${user}:${password}@127.0.0.1:${port}/${database}`;
  const llm = await createLlmRouterFromEnv(process.env, { purpose: "extraction" });
  if (!llm) throw new Error("no LLM deployment configured: set LLM_CHANNELS and LITELLM_MODEL (or LLM_SETTINGS_ENV_FILE)");
  const { db, objectStore, secClient } = createEvidenceCliRuntime();
  const deps: TenKBackfillDeps = { db, llm, objectStore, secClient, resolveCompetitor: (name) => resolveCompetitorByName(db, name) };
  let failed = false;
  try {
    if (flags.file !== undefined) {
      const [issuer, ...others] = await issuers(db, tickers);
      if (issuer === undefined || others.length > 0) throw new Error(`${tickers[0]} must name exactly one stored issuer`);
      const started = Date.now();
      const bytes = readFileSync(flags.file);
      const doc = await storeTenK(deps, { issuerId: issuer.issuer_id, bytes, url: null, accession: null, filedDate: null, retrievedAt: new Date().toISOString() });
      const result = await extract10kClaims(deps, { ...doc, issuerId: issuer.issuer_id, html: bytes.toString("utf8"), effectiveTime: null });
      console.log(resultLine(result, Date.now() - started));
      failed = result.outcome === "unparseable";
    } else {
      const queue = (await issuers(db, tickers)).slice(0, limit);
      const totals: Record<string, number> = {};
      for (const ticker of tickers.filter((ticker) => !queue.some((issuer) => issuer.ticker === ticker.toUpperCase()))) {
        failed = true;
        console.error(`${ticker}: no stored issuer`);
      }
      const work = async () => {
        for (let issuer = queue.shift(); issuer !== undefined; issuer = queue.shift()) {
          const label = `${issuer.ticker ?? "-"} ${issuer.legal_name}`;
          const started = Date.now();
          if (issuer.cik === null) {
            totals.no_cik = (totals.no_cik ?? 0) + 1;
            console.log(`${label}: outcome=no_cik`);
            continue;
          }
          try {
            const result = await backfillIssuer10k(deps, { issuerId: issuer.issuer_id, cik: Number(issuer.cik) });
            totals[result.outcome] = (totals[result.outcome] ?? 0) + 1;
            if (result.outcome === "unparseable") failed = true;
            console.log(`${label}: ${"accession" in result ? `${result.accession} ${resultLine(result, Date.now() - started)}` : "outcome=no_10k"}`);
          } catch (error) {
            failed = true;
            totals.failed = (totals.failed ?? 0) + 1;
            console.error(`${label}: failed: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      };
      await Promise.all(Array.from({ length: concurrency }, work));
      console.log(`done: ${Object.entries(totals).map(([outcome, n]) => `${outcome}=${n}`).join(" ") || "no issuers"}`);
    }
  } finally {
    await db.end();
  }
  // A document left unread (an error, or a reply the model answered badly) is
  // read again by the next run; automation sees a non-zero exit until then.
  if (failed) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

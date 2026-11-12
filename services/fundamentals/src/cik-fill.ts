// Fills the CIK of every issuer that lacks one from SEC's company_tickers.json,
// matched by the tickers of the issuer's active listings. The weekly reference
// import carries names but no CIK, and fundamentals reads SEC facts only for an
// issuer with one, so it runs after each import (scripts/dev-shell.sh
// reference-import).
//
//   DATABASE_URL=... SEC_EDGAR_USER_AGENT=... npm run fill:ciks [-- --file company_tickers.json]
//
// One download of company_tickers.json per run. With --file, a file written in
// the last day is read instead, and otherwise the download replaces it, so a
// rerun the same day makes no request and next week's import gets SEC's newest.
// A rerun is safe: a CIK is only ever set where none is.

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { Pool } from "pg";
import { normalizeCik } from "../../shared/src/identifiers.ts";
import { logPoolErrors } from "../../shared/src/pool-client.ts";
import type { FundamentalsQueryExecutor } from "./sec-facts-repository.ts";
import { isSourceNumber, parseFinancialJson } from "./lossless-financial-json.ts";
import { createSecCompanyFactsHttpFetcher } from "./sec-edgar-http.ts";

export const COMPANY_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const CACHE_MAX_AGE_MS = 86_400_000;

export type CikFillOutcome = "filled" | "already_set" | "skipped_duplicate" | "unmatched";
export type CikFillReport = Record<CikFillOutcome, number>;

/** SEC's company_tickers.json, parsed: each ticker's CIK, without leading zeros. */
export function companyTickerCiks(json: unknown): Map<string, string> {
  const ciks = new Map<string, string>();
  for (const entry of Object.values(json as Record<string, { cik_str: unknown; ticker: unknown }>)) {
    const cik = isSourceNumber(entry.cik_str) ? entry.cik_str.token : String(entry.cik_str);
    if (typeof entry.ticker === "string" && /^\d+$/.test(cik) && !ciks.has(entry.ticker)) ciks.set(entry.ticker, normalizeCik(cik));
  }
  return ciks;
}

/**
 * Each issuer with an active listing, by outcome. An issuer takes the CIK of
 * its first listed ticker SEC knows, unless another issuer already holds that
 * CIK: that is #597's split, where the SEC facts stay on the other issuer, and
 * this one has none until the two merge.
 */
export async function fillMissingCiks(
  db: FundamentalsQueryExecutor,
  ciks: ReadonlyMap<string, string>,
  log: Pick<Console, "error"> = console,
): Promise<CikFillReport> {
  const report: CikFillReport = { filled: 0, already_set: 0, skipped_duplicate: 0, unmatched: 0 };
  const { rows: issuers } = await db.query<{ issuer_id: string; cik: string | null; tickers: string[] }>(
    `select iss.issuer_id::text as issuer_id, iss.cik, array_agg(distinct l.ticker order by l.ticker) as tickers
       from issuers iss
       join instruments i on i.issuer_id = iss.issuer_id
       join listings l on l.instrument_id = i.instrument_id
      where l.active_to is null
      group by iss.issuer_id, iss.cik
      order by iss.issuer_id`,
  );
  for (const issuer of issuers) {
    if (issuer.cik !== null) {
      report.already_set += 1;
      continue;
    }
    // ponytail: the first ticker in order; an issuer whose share classes SEC filed under two CIKs takes the first one's.
    const ticker = issuer.tickers.find((candidate) => ciks.has(candidate));
    if (ticker === undefined) {
      report.unmatched += 1;
      continue;
    }
    const cik = ciks.get(ticker)!;
    const { rows: [holder] } = await db.query<{ issuer_id: string }>(
      `select issuer_id::text as issuer_id from issuers where ltrim(cik, '0') = $1 and issuer_id <> $2::uuid limit 1`,
      [cik, issuer.issuer_id],
    );
    if (holder !== undefined) {
      log.error(`${ticker}: CIK ${cik} belongs to issuer ${holder.issuer_id}; not attached`);
      report.skipped_duplicate += 1;
      continue;
    }
    const { rows } = await db.query(
      `update issuers set cik = $2, updated_at = now() where issuer_id = $1::uuid and cik is null returning issuer_id`,
      [issuer.issuer_id, cik],
    );
    // Another writer (resolver discovery) set it since the read.
    report[rows.length === 1 ? "filled" : "already_set"] += 1;
  }
  return report;
}

/** The parsed company_tickers.json: from `file` when it was written in the last day, else downloaded once, and written to `file` when one is given. */
export async function loadCompanyTickerCiks(file: string | undefined, download: () => Promise<unknown>, now = Date.now()): Promise<Map<string, string>> {
  if (file !== undefined && existsSync(file) && now - statSync(file).mtimeMs < CACHE_MAX_AGE_MS) {
    return companyTickerCiks(parseFinancialJson(readFileSync(file, "utf8")));
  }
  const ciks = companyTickerCiks(await download());
  if (file !== undefined) {
    const entries = [...ciks].map(([ticker, cik], index) => [index, { cik_str: Number(cik), ticker }]);
    writeFileSync(file, JSON.stringify(Object.fromEntries(entries)));
  }
  return ciks;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const { values } = parseArgs({ options: { file: { type: "string" } } });
  const ciks = await loadCompanyTickerCiks(values.file, async () => {
    const userAgent = process.env.SEC_EDGAR_USER_AGENT;
    if (!userAgent) throw new Error("SEC_EDGAR_USER_AGENT is required to download company_tickers.json");
    return (await createSecCompanyFactsHttpFetcher({ userAgent })(COMPANY_TICKERS_URL)).json;
  });
  const pool = logPoolErrors(new Pool({ connectionString: databaseUrl }));
  try {
    const report = await fillMissingCiks(pool, ciks);
    console.log(`fill-ciks: filled=${report.filled} already_set=${report.already_set} skipped_duplicate=${report.skipped_duplicate} unmatched=${report.unmatched} sec_tickers=${ciks.size}`);
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

// Fills the CIK of every issuer that lacks one from SEC's company_tickers.json,
// matched by the tickers of the issuer's active US listings. The weekly reference
// import carries names but no CIK, and fundamentals reads SEC facts only for an
// issuer with one, so it runs after each import (scripts/dev-shell.sh
// reference-import).
//
//   DATABASE_URL=... SEC_EDGAR_USER_AGENT=... npm run fill:ciks [-- --file company_tickers.json]
//
// One download of company_tickers.json per run. With --file, a file written in
// the last day is read instead, and otherwise the download replaces it, so a
// rerun the same day makes no request and next week's import gets SEC's newest.
// A rerun is safe: each CIK goes to the same issuer every run.

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { Pool } from "pg";
import { normalizeCik, US_EQUITY_MICS } from "../../shared/src/identifiers.ts";
import { logPoolErrors } from "../../shared/src/pool-client.ts";
import { withPinnedTransaction } from "./pinned-transaction.ts";
import type { FundamentalsTransactionalQueryExecutor } from "./sec-facts-repository.ts";
import { isSourceNumber, parseFinancialJson } from "./lossless-financial-json.ts";
import { createSecCompanyFactsHttpFetcher } from "./sec-edgar-http.ts";

export const COMPANY_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const CACHE_MAX_AGE_MS = 86_400_000;

export type CikFillOutcome = "filled" | "reassigned" | "held_with_data" | "already_set" | "skipped_duplicate" | "unmatched";
export type CikFillReport = Record<CikFillOutcome, number>;

/** SEC's company_tickers.json, parsed: each ticker's CIK, without leading zeros, in SEC's order. */
export function companyTickerCiks(json: unknown): Map<string, string> {
  const ciks = new Map<string, string>();
  for (const entry of Object.values(json as Record<string, { cik_str: unknown; ticker: unknown }>)) {
    const cik = isSourceNumber(entry.cik_str) ? entry.cik_str.token : String(entry.cik_str);
    if (typeof entry.ticker === "string" && /^\d+$/.test(cik) && !ciks.has(entry.ticker)) ciks.set(entry.ticker, normalizeCik(cik));
  }
  return ciks;
}

type ListedIssuer = { issuer_id: string; cik: string | null; tickers: string[] };
type CikClaim = ListedIssuer & { ticker: string; claimedCik: string };

/**
 * Each issuer with an active US listing, by outcome. A same-symbol listing
 * abroad, such as Anglo American's XLON AAL, is another company and never
 * matches. SEC lists a CIK's first ticker at the company's rank and files
 * ETNs and other share classes under the same CIK further down, as AMJB
 * under JPMorgan's. A CIK held by an issuer with data read from SEC by it
 * stays there (#597). The claims from its filings hang off those filings, and
 * 13F rows and claims about it are resolved by CUSIP or name, not its CIK.
 */
export async function fillMissingCiks(
  db: FundamentalsTransactionalQueryExecutor,
  ciks: ReadonlyMap<string, string>,
  log: Pick<Console, "error"> = console,
): Promise<CikFillReport> {
  const report: CikFillReport = { filled: 0, reassigned: 0, held_with_data: 0, already_set: 0, skipped_duplicate: 0, unmatched: 0 };
  const rank = new Map([...ciks.keys()].map((ticker, index) => [ticker, index]));
  const byRank = (a: string, b: string) => rank.get(a)! - rank.get(b)!;
  const { rows: issuers } = await db.query<ListedIssuer>(
    `select iss.issuer_id::text as issuer_id, iss.cik, array_agg(distinct l.ticker order by l.ticker) as tickers
       from issuers iss
       join instruments i on i.issuer_id = iss.issuer_id
       join listings l on l.instrument_id = i.instrument_id
      where l.active_to is null and l.mic = any($1::text[])
      group by iss.issuer_id, iss.cik
      order by iss.issuer_id`,
    [US_EQUITY_MICS],
  );
  const claims: CikClaim[] = [];
  for (const issuer of issuers) {
    const [ticker] = issuer.tickers.filter((candidate) => rank.has(candidate)).sort(byRank);
    if (ticker !== undefined) claims.push({ ...issuer, ticker, claimedCik: ciks.get(ticker)! });
    else report[issuer.cik === null ? "unmatched" : "already_set"] += 1;
  }
  const holdsClaimed = (claim: CikClaim) => claim.cik !== null && normalizeCik(claim.cik) === claim.claimedCik;
  const owners = new Map<string, CikClaim>();
  for (const claim of [...claims].sort((a, b) => byRank(a.ticker, b.ticker) || Number(holdsClaimed(b)) - Number(holdsClaimed(a)))) {
    if (!owners.has(claim.claimedCik) && (claim.cik === null || holdsClaimed(claim))) owners.set(claim.claimedCik, claim);
  }
  for (const claim of claims) {
    if (claim.cik !== null) {
      report.already_set += 1;
      continue;
    }
    const owner = owners.get(claim.claimedCik)!;
    if (owner !== claim) {
      log.error(`${claim.ticker}: CIK ${claim.claimedCik} goes to ${owner.ticker}'s issuer ${owner.issuer_id}; not attached`);
      report.skipped_duplicate += 1;
    } else {
      report[await attachCik(db, owner, log)] += 1;
    }
  }
  return report;
}

async function attachCik(db: FundamentalsTransactionalQueryExecutor, owner: CikClaim, log: Pick<Console, "error">): Promise<CikFillOutcome> {
  return withPinnedTransaction(db, async (tx) => {
    const { rows: [self] } = await tx.query<{ cik: string | null }>(`select cik from issuers where issuer_id = $1::uuid for update`, [owner.issuer_id]);
    // Another writer (resolver discovery) set it since the read.
    if (self?.cik !== null) return "already_set";
    const { rows: holders } = await tx.query<{ issuer_id: string; held: string[] }>(
      `select issuer_id::text as issuer_id, array_remove(array[
                case when exists (
                  select 1 from facts f join sources s using (source_id)
                   where f.subject_kind = 'issuer' and f.subject_id = iss.issuer_id and s.provider = 'sec_edgar') then 'facts' end,
                case when exists (
                  select 1 from mentions m join documents d using (document_id) join sources s using (source_id)
                   where m.subject_kind = 'issuer' and m.subject_id = iss.issuer_id and s.provider = 'sec_edgar') then 'filings' end,
                case when exists (select 1 from insider_transactions where issuer_id = iss.issuer_id) then 'Form 4 transactions' end,
                case when exists (select 1 from sec_issuer_downloads where issuer_id = iss.issuer_id) then 'companyfacts downloads' end
              ], null) as held
         from issuers iss
        where ltrim(iss.cik, '0') = $1 and iss.issuer_id <> $2::uuid
        order by iss.issuer_id
          for update`,
      [owner.claimedCik, owner.issuer_id],
    );
    const withData = holders.find((holder) => holder.held.length > 0);
    if (withData !== undefined) {
      log.error(`${owner.ticker}: CIK ${owner.claimedCik} stays on issuer ${withData.issuer_id}, which holds SEC ${withData.held.join(", ")}; not moved`);
      return "held_with_data";
    }
    const moved = holders.map((holder) => holder.issuer_id);
    await tx.query(`update issuers set cik = null, updated_at = now() where issuer_id = any($1::uuid[])`, [moved]);
    await tx.query(`update issuers set cik = $2, updated_at = now() where issuer_id = $1::uuid`, [owner.issuer_id, owner.claimedCik]);
    if (moved.length === 0) return "filled";
    log.error(`${owner.ticker}: CIK ${owner.claimedCik} moved from issuer ${moved.join(", ")} to issuer ${owner.issuer_id}`);
    return "reassigned";
  });
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

/** loadCompanyTickerCiks, downloading from SEC with SEC_EDGAR_USER_AGENT. */
export function loadSecTickerCiks(file: string | undefined): Promise<Map<string, string>> {
  return loadCompanyTickerCiks(file, async () => {
    const userAgent = process.env.SEC_EDGAR_USER_AGENT;
    if (!userAgent) throw new Error("SEC_EDGAR_USER_AGENT is required to download company_tickers.json");
    return (await createSecCompanyFactsHttpFetcher({ userAgent })(COMPANY_TICKERS_URL)).json;
  });
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const { values } = parseArgs({ options: { file: { type: "string" } } });
  const ciks = await loadSecTickerCiks(values.file);
  const pool = logPoolErrors(new Pool({ connectionString: databaseUrl }));
  try {
    const report = await fillMissingCiks(pool, ciks);
    const counts = Object.entries(report).map(([outcome, count]) => `${outcome}=${count}`).join(" ");
    console.log(`fill-ciks: ${counts} sec_tickers=${ciks.size}`);
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

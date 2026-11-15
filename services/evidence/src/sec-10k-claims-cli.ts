//   DATABASE_URL=... S3_*=... LLM_*=... SEC_EDGAR_USER_AGENT=... \
//     npm run extract:10k-claims -- --file <10-K.htm> --ticker <TICKER> [--accession <0001045810-26-000021> --filed <2026-02-25>]
//     npm run extract:10k-claims -- --backfill [--ticker <TICKER> ...] [--limit N] [--concurrency N]
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { createLlmRouterFromEnv } from "../../llm/src/settings-loader.ts";
import { createEvidenceCliRuntime } from "./evidence-cli-runtime.ts";
import {
  backfillIssuer10k,
  type CutItem,
  extract10kClaims,
  resolveCompetitorByName,
  storeTenK,
  type Extract10kResult,
  type TenKBackfillDeps,
} from "./sec-10k-claims.ts";
import type { TenKItem } from "./sec-10k-sections.ts";
import type { QueryExecutor } from "./types.ts";

export function resultLine(result: Extract10kResult, ms: number): string {
  return `outcome=${result.outcome} extracted=${result.extracted} dropped_unquoted=${result.droppedUnquoted} ` +
    `competitors=${result.competitors.resolved}/${result.competitors.named} missing=${result.missing.join(",") || "none"} ` +
    `unread=${result.unread.join(",") || "none"} cut=${result.cut.map((cut) => `${cut.item}:${cut.prompts}/${cut.of}`).join(",") || "none"} ` +
    `ms=${ms} llm_calls=${result.llmCalls}`;
}

type Outcome = { outcome: string; missing?: ReadonlyArray<TenKItem>; unread?: ReadonlyArray<TenKItem>; cut?: ReadonlyArray<CutItem> };
export function summaryLine(results: ReadonlyArray<Outcome>): string {
  const totals = new Map<string, number>();
  const count = (key: string) => totals.set(key, (totals.get(key) ?? 0) + 1);
  for (const result of results) {
    count(result.outcome);
    if (result.outcome !== "no_sections" && (result.missing?.length ?? 0) > 0) count("partial");
    if (result.outcome !== "unparseable" && (result.unread?.length ?? 0) > 0) count("unread");
    if ((result.cut?.length ?? 0) > 0) count("cut");
  }
  return `done: ${[...totals].map(([key, n]) => `${key}=${n}`).join(" ") || "no issuers"}`;
}

// The dev stack's .env.dev, which the verify boot recipe passes with
// --env-file, names its Postgres by parts.
function databaseUrlFromDevParts(env: NodeJS.ProcessEnv): string | undefined {
  const { DEV_POSTGRES_USER: user = "postgres", DEV_POSTGRES_PASSWORD: password = "postgres", DEV_POSTGRES_PORT: port, DEV_POSTGRES_DB: database = "market_agent" } = env;
  return port ? `postgresql://${user}:${password}@127.0.0.1:${port}/${database}` : undefined;
}

type Issuer = { issuer_id: string; legal_name: string; cik: string | null; tickers: string[] };

async function issuers(db: QueryExecutor, tickers: string[]): Promise<Issuer[]> {
  const { rows } = await db.query<Issuer>(
    `select iss.issuer_id::text as issuer_id, iss.legal_name, iss.cik,
            coalesce(array_agg(distinct l.ticker) filter (where l.ticker is not null), '{}') as tickers
       from issuers iss
       left join instruments i on i.issuer_id = iss.issuer_id
       left join listings l on l.instrument_id = i.instrument_id and (l.active_to is null or l.active_to > now())
      where ($1::text[] is null and iss.cik is not null) or l.ticker = any($1::text[])
      group by iss.issuer_id`,
    [tickers.length > 0 ? tickers.map((ticker) => ticker.toUpperCase()) : null],
  );
  return rows.sort((a, b) => a.legal_name.localeCompare(b.legal_name));
}

// A 10-K's own filer, from its inline XBRL cover page.
export function filerCik(html: string): number | null {
  const cik = /name="dei:EntityCentralIndexKey"[^>]*>\s*(\d{1,10})\s*</.exec(html);
  return cik === null ? null : Number(cik[1]);
}

// A model reply that left an item unread exits 1, so a scheduler reruns it.
const needsRerun = (result: { outcome: string; unread?: ReadonlyArray<TenKItem> }) =>
  result.outcome === "unparseable" || (result.unread?.length ?? 0) > 0;

type CliArgs = { file?: string; accession: string | null; filed: string | null; backfill: boolean; tickers: string[]; limit: number; concurrency: number };
export function parseCliArgs(args: string[]): CliArgs {
  const { values: flags } = parseArgs({
    args,
    options: {
      file: { type: "string" },
      accession: { type: "string" },
      filed: { type: "string" },
      ticker: { type: "string", multiple: true },
      backfill: { type: "boolean" },
      limit: { type: "string" },
      concurrency: { type: "string" },
    },
  });
  const tickers = flags.ticker ?? [];
  const backfill = flags.backfill === true;
  const limit = flags.limit === undefined ? Infinity : Number(flags.limit);
  const concurrency = flags.concurrency === undefined ? 1 : Number(flags.concurrency);
  if (!(limit === Infinity || (Number.isInteger(limit) && limit > 0))) throw new Error("--limit takes a whole number of issuers");
  if (!(Number.isInteger(concurrency) && concurrency > 0 && concurrency <= 8)) throw new Error("--concurrency takes 1 to 8");
  if (backfill === (flags.file !== undefined)) throw new Error("pass one of --file <path> --ticker <TICKER>, or --backfill");
  if (flags.file !== undefined && tickers.length !== 1) throw new Error("--file needs one --ticker");
  const accession = flags.accession ?? null;
  const filed = flags.filed ?? null;
  if ((accession !== null || filed !== null) && flags.file === undefined) throw new Error("--accession and --filed go with --file");
  if ((accession === null) !== (filed === null)) throw new Error("--accession and --filed go together");
  if (accession !== null && !/^\d{10}-\d{2}-\d{6}$/.test(accession)) throw new Error("--accession takes 0001045810-26-000021");
  const filedDay = new Date(`${filed}T00:00:00Z`);
  if (filed !== null && !(/^\d{4}-\d{2}-\d{2}$/.test(filed) && !Number.isNaN(filedDay.getTime()) && filedDay.toISOString().startsWith(filed))) {
    throw new Error("--filed takes a date, 2026-02-25");
  }
  return { file: flags.file, accession, filed, backfill, tickers, limit, concurrency };
}

async function main(): Promise<void> {
  const { file, accession, filed, tickers, limit, concurrency } = parseCliArgs(process.argv.slice(2));
  const devDatabaseUrl = databaseUrlFromDevParts(process.env);
  if (!process.env.DATABASE_URL && devDatabaseUrl) process.env.DATABASE_URL = devDatabaseUrl;
  const llm = await createLlmRouterFromEnv(process.env, { purpose: "extraction" });
  if (!llm) throw new Error("no LLM deployment configured: set LLM_CHANNELS and LITELLM_MODEL (or LLM_SETTINGS_ENV_FILE)");
  const { db, objectStore, secClient } = createEvidenceCliRuntime();
  const deps: TenKBackfillDeps = { db, llm, objectStore, secClient, resolveCompetitor: (name) => resolveCompetitorByName(db, name) };
  let failed = false;
  try {
    if (file !== undefined) {
      const [issuer, ...others] = await issuers(db, tickers);
      if (issuer === undefined || others.length > 0) throw new Error(`${tickers[0]} must name exactly one stored issuer`);
      const started = Date.now();
      const bytes = readFileSync(file);
      const html = bytes.toString("utf8");
      const filer = filerCik(html);
      if (filer !== null && issuer.cik !== null && filer !== Number(issuer.cik)) {
        throw new Error(`${file} is filed by CIK ${filer}, not ${tickers[0]}'s ${Number(issuer.cik)}`);
      }
      const doc = await storeTenK(deps, { issuerId: issuer.issuer_id, bytes, url: null, accession, filedDate: filed, retrievedAt: new Date().toISOString() });
      const effectiveTime = filed === null ? null : `${filed}T00:00:00Z`;
      const result = await extract10kClaims(deps, { ...doc, issuerId: issuer.issuer_id, html, effectiveTime });
      console.log(resultLine(result, Date.now() - started));
      failed = needsRerun(result);
    } else {
      const stored = await issuers(db, tickers);
      const queue = stored.slice(0, limit);
      const results: Outcome[] = [];
      for (const ticker of tickers.filter((ticker) => !stored.some((issuer) => issuer.tickers.includes(ticker.toUpperCase())))) {
        failed = true;
        console.error(`${ticker}: no stored issuer`);
      }
      const work = async () => {
        for (let issuer = queue.shift(); issuer !== undefined; issuer = queue.shift()) {
          const label = `${issuer.tickers.join("/") || "-"} ${issuer.legal_name}`;
          const started = Date.now();
          if (issuer.cik === null) {
            results.push({ outcome: "no_cik" });
            console.log(`${label}: outcome=no_cik`);
            continue;
          }
          try {
            const result = await backfillIssuer10k(deps, { issuerId: issuer.issuer_id, cik: Number(issuer.cik) });
            results.push(result);
            if (needsRerun(result)) failed = true;
            console.log(`${label}: ${"accession" in result ? `${result.accession} ${resultLine(result, Date.now() - started)}` : "outcome=no_10k"}`);
          } catch (error) {
            failed = true;
            results.push({ outcome: "failed" });
            console.error(`${label}: failed: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      };
      await Promise.all(Array.from({ length: concurrency }, work));
      console.log(summaryLine(results));
    }
  } finally {
    await db.end();
  }
  if (failed) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

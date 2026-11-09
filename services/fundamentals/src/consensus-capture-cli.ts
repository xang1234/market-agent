// Capture Finviz analyst consensus for the day into consensus_captures
// (captureConsensus). Dev only: it reads Finviz through the dev-providers sidecar.
//
//   DATABASE_URL=... DEV_PROVIDERS_BASE_URL=http://127.0.0.1:4336 \
//     npm run capture:consensus [-- --tickers AAPL,MSFT,COST]
//
// With no tickers, captures every issuer with an active US common stock or ADR
// listing. One Finviz request per issuer, in turn, at least FINVIZ_PACE_MS
// apart. A rerun the same UTC day inserts nothing. Exits 2 when Finviz refuses
// a request (403 or 429) and stops there, keeping what it wrote; exits 1 when
// any ticker failed otherwise.

import { parseArgs } from "node:util";
import { Pool } from "pg";
import type { QueryExecutor } from "../../shared/src/http.ts";
import { logPoolErrors } from "../../shared/src/pool-client.ts";
import { FundamentalsDataUnavailableError } from "./availability.ts";
import { consensusFiscalPeriod, type ConsensusPeriod, type ReportedPeriods } from "./consensus-fiscal-period.ts";
import { postSidecar, providerPayloadError, type SidecarEnvelope } from "./dev-provider-sidecar.ts";
import { FINVIZ_DEV_CONSENSUS_SOURCE_ID } from "./provider-sources.ts";
import type { FiscalPeriod } from "./statement.ts";

export const FINVIZ_PACE_MS = 500;
const US_EQUITY_MICS = ["ARCX", "BATS", "IEXG", "XASE", "XNAS", "XNYS"];
const PERIODS: ReadonlyArray<ConsensusPeriod> = ["next_q", "this_y", "next_y"];

export type ConsensusSidecar = (listing: { ticker: string; mic: string }) => Promise<SidecarEnvelope>;

export type CaptureOutcome = { inserted: number; failures: number; blocked: boolean };

type Listing = { issuer_id: string; listing_id: string; ticker: string; mic: string };

type Cell = {
  field_key: string;
  raw_label: string;
  raw_value: string;
  value: string | null;
  unit: string;
  period: ConsensusPeriod | null;
};

export async function captureConsensus(
  db: QueryExecutor,
  sidecar: ConsensusSidecar,
  options: {
    tickers: ReadonlyArray<string> | null;
    now: () => Date;
    sleep: (ms: number) => Promise<void>;
    log: Pick<Console, "log" | "warn" | "error">;
  },
): Promise<CaptureOutcome> {
  const { log } = options;
  const capturedOn = options.now().toISOString().slice(0, 10);
  const listings = await usListings(db, options.tickers);
  const outcome: CaptureOutcome = { inserted: 0, failures: 0, blocked: false };
  for (const ticker of options.tickers ?? []) {
    if (listings.some((listing) => listing.ticker === ticker)) continue;
    outcome.failures += 1;
    log.error(`${ticker}: no active US common stock or ADR listing on file`);
  }

  for (const [index, listing] of listings.entries()) {
    if (index > 0) await options.sleep(FINVIZ_PACE_MS);
    let envelope: SidecarEnvelope;
    try {
      envelope = await sidecar({ ticker: listing.ticker, mic: listing.mic });
    } catch (error) {
      if (error instanceof FundamentalsDataUnavailableError && error.reason === "rate_limited") {
        log.error(`${listing.ticker}: ${error.message}; stopping the run`);
        return { ...outcome, blocked: true };
      }
      outcome.failures += 1;
      log.error(`${listing.ticker}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (envelope.status === "unavailable") {
      if (envelope.reason === "rate_limited") {
        log.error(`${listing.ticker}: Finviz refused the request (${String(envelope.detail)}); stopping the run`);
        return { ...outcome, blocked: true };
      }
      outcome.failures += 1;
      log.error(`${listing.ticker}: ${String(envelope.reason)}: ${String(envelope.detail)}`);
      continue;
    }
    try {
      const inserted = await writeCells(db, listing, parseCells(envelope.data), capturedOn, options.now());
      outcome.inserted += inserted;
      log.log(`${listing.ticker}: ${inserted} new field(s) for ${capturedOn}`);
    } catch (error) {
      outcome.failures += 1;
      log.error(`${listing.ticker}: capture failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return outcome;
}

export function captureExitCode(outcome: CaptureOutcome): number {
  if (outcome.blocked) return 2;
  return outcome.failures > 0 ? 1 : 0;
}

async function usListings(db: QueryExecutor, tickers: ReadonlyArray<string> | null): Promise<Listing[]> {
  // One listing per issuer: the table keys a day's capture by issuer.
  const { rows } = await db.query<Listing>(
    `select distinct on (ins.issuer_id) ins.issuer_id::text as issuer_id, l.listing_id::text as listing_id, l.ticker, l.mic
       from listings l join instruments ins on ins.instrument_id = l.instrument_id
      where l.mic = any($1::text[]) and l.active_to is null and ins.asset_type in ('common_stock', 'adr')
        and ($2::text[] is null or l.ticker = any($2::text[]))
      order by ins.issuer_id, l.ticker`,
    [US_EQUITY_MICS, tickers],
  );
  return rows.sort((a, b) => a.ticker.localeCompare(b.ticker));
}

async function writeCells(db: QueryExecutor, listing: Listing, cells: ReadonlyArray<Cell>, capturedOn: string, retrievedAt: Date): Promise<number> {
  const reported = await reportedPeriods(db, listing.issuer_id);
  const labels = cells.map((cell) => (cell.period ? consensusFiscalPeriod(cell.period, reported, capturedOn) : null));
  const { rows } = await db.query(
    `insert into consensus_captures (issuer_id, listing_id, source_id, captured_on, retrieved_at,
                                     field_key, raw_label, raw_value, value, unit, fiscal_period, fiscal_period_basis)
     select $1::uuid, $2::uuid, $3::uuid, $4::date, $5::timestamptz, c.*
       from unnest($6::text[], $7::text[], $8::text[], $9::numeric[], $10::text[], $11::text[], $12::text[]) as c
     on conflict (issuer_id, source_id, captured_on, field_key) do nothing
     returning capture_id`,
    [
      listing.issuer_id,
      listing.listing_id,
      FINVIZ_DEV_CONSENSUS_SOURCE_ID,
      capturedOn,
      retrievedAt.toISOString(),
      cells.map((cell) => cell.field_key),
      cells.map((cell) => cell.raw_label),
      cells.map((cell) => cell.raw_value),
      cells.map((cell) => cell.value),
      cells.map((cell) => cell.unit),
      labels.map((label) => label?.fiscal_period ?? null),
      labels.map((label) => label?.fiscal_period_basis ?? null),
    ],
  );
  return rows.length;
}

async function reportedPeriods(db: QueryExecutor, issuerId: string): Promise<ReportedPeriods> {
  const { rows } = await db.query<{ period_kind: string; fiscal_year: number; fiscal_period: FiscalPeriod; period_end: string }>(
    `select distinct on (f.period_kind) f.period_kind, f.fiscal_year, f.fiscal_period, f.period_end::text as period_end
       from facts f join sources s on s.source_id = f.source_id
      where f.subject_kind = 'issuer' and f.subject_id = $1 and s.provider = 'sec_edgar'
        and f.period_kind in ('fiscal_y', 'fiscal_q') and f.fiscal_year is not null and f.fiscal_period is not null and f.period_end is not null
        and f.invalidated_at is null and f.superseded_by is null
      order by f.period_kind, f.period_end desc`,
    [issuerId],
  );
  const latest = (kind: string) => {
    const row = rows.find((candidate) => candidate.period_kind === kind);
    return row ? { fiscal_year: row.fiscal_year, fiscal_period: row.fiscal_period, period_end: row.period_end } : null;
  };
  return { annual: latest("fiscal_y"), quarter: latest("fiscal_q") };
}

function parseCells(data: unknown): Cell[] {
  const cells = (data as { cells?: unknown } | null)?.cells;
  if (!Array.isArray(cells) || cells.length === 0) throw providerPayloadError("finviz consensus", "cells");
  return cells.map((cell: Record<string, unknown>) => {
    const text = (key: string) => {
      if (typeof cell[key] !== "string") throw providerPayloadError("finviz consensus", `cell ${key}`);
      return cell[key] as string;
    };
    const period = cell.period ?? null;
    if (period !== null && !PERIODS.includes(period as ConsensusPeriod)) throw providerPayloadError("finviz consensus", "cell period");
    return {
      field_key: text("field_key"),
      raw_label: text("raw_label"),
      raw_value: text("raw_value"),
      value: cell.value === null ? null : text("value"),
      unit: text("unit"),
      period: period as ConsensusPeriod | null,
    };
  });
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const baseUrl = process.env.DEV_PROVIDERS_BASE_URL;
  if (!databaseUrl || !baseUrl) throw new Error("DATABASE_URL and DEV_PROVIDERS_BASE_URL are required");
  const { values } = parseArgs({ options: { tickers: { type: "string" } } });
  const tickers = values.tickers?.split(",").map((ticker) => ticker.trim().toUpperCase()).filter(Boolean) ?? null;
  const pool = logPoolErrors(new Pool({ connectionString: databaseUrl }));
  // The sidecar waits out finvizfinance's own retries (75s) before it answers.
  const sidecar: ConsensusSidecar = (listing) =>
    postSidecar({ baseUrl, path: "/fundamentals/finviz-consensus", body: listing, fetchImpl: fetch, timeoutMs: 90_000 });
  try {
    const outcome = await captureConsensus(pool, sidecar, {
      tickers,
      now: () => new Date(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      log: console,
    });
    console.log(`consensus capture: ${outcome.inserted} row(s) inserted, ${outcome.failures} ticker(s) failed${outcome.blocked ? ", stopped by Finviz" : ""}`);
    process.exitCode = captureExitCode(outcome);
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

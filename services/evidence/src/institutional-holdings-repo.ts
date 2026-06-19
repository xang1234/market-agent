import type { QueryExecutor } from "./types.ts";
import { supersedeFilingArtifacts, type SupersededArtifactCounts } from "./supersede-filing.ts";

// Read model for 13F institutional holdings. One aggregated row per
// (filer, issuer, reporting period) — the handler sums the multiple infoTable
// rows a filer reports per CUSIP and stores only CUSIP-resolvable holdings.

export type InstitutionalHoldingInput = {
  filer_cik: string;
  filer_name: string;
  issuer_id: string;
  cusip: string;
  shares: number;
  value_usd: number;
  filing_period: string; // YYYY-MM-DD (reporting quarter end)
  filing_date: string; // YYYY-MM-DD
  source_id: string;
  accession: string;
};

// Upsert on (filer_cik, issuer_id, filing_period): re-ingesting a period replaces
// the prior row, keeping the read model idempotent for a corrected/restated 13F.
export async function insertHolding(db: QueryExecutor, input: InstitutionalHoldingInput): Promise<void> {
  await db.query(
    `insert into institutional_holdings
       (filer_cik, filer_name, issuer_id, cusip, shares, value_usd, filing_period, filing_date, source_id, accession)
     values ($1, $2, $3, $4, $5, $6, $7::date, $8::date, $9, $10)
     on conflict (filer_cik, issuer_id, filing_period) do update
       set filer_name = excluded.filer_name,
           cusip = excluded.cusip,
           shares = excluded.shares,
           value_usd = excluded.value_usd,
           filing_date = excluded.filing_date,
           source_id = excluded.source_id,
           accession = excluded.accession`,
    [
      input.filer_cik,
      input.filer_name,
      input.issuer_id,
      input.cusip,
      input.shares,
      input.value_usd,
      input.filing_period,
      input.filing_date,
      input.source_id,
      input.accession,
    ],
  );
}

export type Supersede13fFilingKey = {
  filer_cik: string;
  filing_period: string; // YYYY-MM-DD (reporting quarter end)
};

export type Supersede13fFilingResult = { holdings: number } & SupersededArtifactCounts;

// Supersede the prior 13F filing for a (filer, reporting period) so a 13F-HR/A
// RESTATEMENT replaces — rather than double-counts or leaves stale — the original.
// A restatement is a full-portfolio re-file, so deleting the whole period's rows is what
// removes an issuer the amendment dropped (the stale-row bug, fra-kb2p). Deletes the
// read-model rows, then retires the derived claims/events/documents via the shared
// supersedeFilingArtifacts. Call inside the amendment's transaction so a failure leaves
// neither the supersede nor the re-insert applied.
export async function supersede13fFiling(
  db: QueryExecutor,
  key: Supersede13fFilingKey,
): Promise<Supersede13fFilingResult> {
  // Types are erased at runtime; an empty period would compare as `= ''` and supersede
  // nothing silently, so fail loudly instead.
  if (!key.filing_period) {
    throw new Error("supersede13fFiling: filing_period is required");
  }

  // Delete the prior read-model rows for the whole (filer, period) portfolio, capturing
  // the source(s) that produced them. One source per filing, so the per-issuer rows
  // collapse to a single source id.
  const deleted = await db.query<{ source_id: string }>(
    `delete from institutional_holdings
       where filer_cik = $1 and filing_period = $2::date
     returning source_id::text as source_id`,
    [key.filer_cik, key.filing_period],
  );
  const sourceIds = [...new Set(deleted.rows.map((r) => r.source_id))];
  if (sourceIds.length === 0) return { holdings: 0, claims: 0, events: 0, documents: 0 };

  const counts = await supersedeFilingArtifacts(db, {
    sourceIds,
    claimPredicate: { prefix: "position_change" },
    eventType: "position_change",
  });
  return { holdings: deleted.rowCount ?? 0, ...counts };
}

export type IssuerTopHolder = {
  filer_cik: string;
  filer_name: string;
  shares: number;
  value_usd: number;
  filing_period: string;
  filing_date: string;
};

type TopHolderRow = {
  filer_cik: string;
  filer_name: string;
  shares: number | string;
  value_usd: number | string;
  filing_period: string;
  filing_date: string;
};

// Top institutional holders of an issuer, from that issuer's most recent reporting
// period in the read model, largest position first. Backs the Holders tab.
export async function topHoldersByIssuer(
  db: QueryExecutor,
  issuerId: string,
  limit = 50,
): Promise<IssuerTopHolder[]> {
  const { rows } = await db.query<TopHolderRow>(
    `select filer_cik,
            filer_name,
            shares,
            value_usd,
            to_char(filing_period, 'YYYY-MM-DD') as filing_period,
            to_char(filing_date, 'YYYY-MM-DD') as filing_date
       from institutional_holdings
      where issuer_id = $1
        and filing_period = (select max(filing_period) from institutional_holdings where issuer_id = $1)
      order by value_usd desc, filer_name
      limit $2`,
    [issuerId, limit],
  );
  return rows.map((row) => ({
    filer_cik: row.filer_cik,
    filer_name: row.filer_name,
    shares: Number(row.shares),
    value_usd: Number(row.value_usd),
    filing_period: row.filing_period,
    filing_date: row.filing_date,
  }));
}

export type FilerHolding = { issuer_id: string; cusip: string; shares: number; value_usd: number };

// A filer's resolvable portfolio for a given reporting period (the read-model
// view behind a "superinvestor moves" surface and exit detection).
export async function holdingsByFiler(
  db: QueryExecutor,
  filerCik: string,
  period: string,
): Promise<FilerHolding[]> {
  const { rows } = await db.query<{ issuer_id: string; cusip: string; shares: number | string; value_usd: number | string }>(
    `select issuer_id::text as issuer_id, cusip, shares, value_usd
       from institutional_holdings
      where filer_cik = $1 and filing_period = $2::date
      order by value_usd desc`,
    [filerCik, period],
  );
  return rows.map((row) => ({
    issuer_id: row.issuer_id,
    cusip: row.cusip,
    shares: Number(row.shares),
    value_usd: Number(row.value_usd),
  }));
}

// The filer's holding of one issuer in a specific period, or null — the prior-period
// lookup the handler uses for notable-change detection.
export async function findFilerIssuerHolding(
  db: QueryExecutor,
  filerCik: string,
  issuerId: string,
  period: string,
): Promise<{ shares: number; value_usd: number } | null> {
  const { rows } = await db.query<{ shares: number | string; value_usd: number | string }>(
    `select shares, value_usd
       from institutional_holdings
      where filer_cik = $1 and issuer_id = $2 and filing_period = $3::date
      limit 1`,
    [filerCik, issuerId, period],
  );
  const row = rows[0];
  return row ? { shares: Number(row.shares), value_usd: Number(row.value_usd) } : null;
}

// The filer's most recent reporting period strictly before `beforePeriod` (the
// "prior period" for change detection), or null when this is their first.
export async function priorPeriodForFiler(
  db: QueryExecutor,
  filerCik: string,
  beforePeriod: string,
): Promise<string | null> {
  const { rows } = await db.query<{ filing_period: string | null }>(
    `select to_char(max(filing_period), 'YYYY-MM-DD') as filing_period
       from institutional_holdings
      where filer_cik = $1 and filing_period < $2::date`,
    [filerCik, beforePeriod],
  );
  return rows[0]?.filing_period ?? null;
}

// The source any existing holding for this accession already references, or null when
// the accession has no holdings yet. The reprocess pass reuses it instead of minting a
// fresh, document-less source: for a previously-ingested filing this is the original
// source (which carries the archived document); and a source the reprocess itself
// created on an earlier run is reused on later runs, so reruns never leak sources.
export async function sourceIdForAccession(db: QueryExecutor, accession: string): Promise<string | null> {
  const { rows } = await db.query<{ source_id: string }>(
    `select source_id::text as source_id from institutional_holdings where accession = $1 limit 1`,
    [accession],
  );
  return rows[0]?.source_id ?? null;
}

import type { QueryExecutor } from "./types.ts";

// Read model for SEC Form 4 insider transactions. Written by the Form 4 handler
// (every reported transaction) inside its ingest transaction; read by the
// SEC-backed Holders repository and the Screener's computed insider filter.

export type InsiderTransactionInput = {
  issuer_id: string;
  insider_name: string;
  insider_role: string;
  insider_cik: string | null;
  transaction_date: string; // YYYY-MM-DD
  transaction_code: string; // raw Form 4 code (P, S, A, M, G, F, …)
  transaction_type: string; // buy | sell | option_exercise | gift | other
  acquired_disposed: "A" | "D";
  shares: number;
  price: number | null;
  value: number | null;
  source_id: string;
  accession: string;
  period_of_report: string | null; // YYYY-MM-DD — SEC "Date of Earliest Transaction"
  filed_at: string; // ISO 8601
};

export async function insertInsiderTransaction(
  db: QueryExecutor,
  input: InsiderTransactionInput,
): Promise<void> {
  await db.query(
    `insert into insider_transactions
       (issuer_id, insider_name, insider_role, insider_cik, transaction_date, transaction_code,
        transaction_type, acquired_disposed, shares, price, value, source_id, accession, period_of_report, filed_at)
     values ($1, $2, $3, $4, $5::date, $6, $7, $8, $9, $10, $11, $12, $13, $14::date, $15::timestamptz)`,
    [
      input.issuer_id,
      input.insider_name,
      input.insider_role,
      input.insider_cik,
      input.transaction_date,
      input.transaction_code,
      input.transaction_type,
      input.acquired_disposed,
      input.shares,
      input.price,
      input.value,
      input.source_id,
      input.accession,
      input.period_of_report,
      input.filed_at,
    ],
  );
}

export type SupersedeInsiderFilingKey = {
  issuer_id: string;
  insider_cik: string | null;
  insider_name: string;
  period_of_report: string; // YYYY-MM-DD
};

export type SupersedeInsiderFilingResult = { transactions: number; claims: number; events: number; documents: number };

// A Form 4/A restates the full ownership form, so before ingesting it the handler
// supersedes the prior filing for (issuer, reporting owner, period): delete its
// read-model rows + derived material claims/events, and mark its document(s)
// superseded — the amendment's data replaces, rather than double-counts, the original.
// The archived source + document bytes are retained; only documents.parse_status flips,
// so a "parsed document with no derived claims" reads as superseded, not corrupt.
//
// Why three explicit deletes rather than one source cascade: claims cascade only from
// documents (which we retain, not delete), and events have NO foreign key to sources at
// all (source_ids is jsonb) — so neither can be reached by deleting the source. The
// owner is matched by CIK when both filings carry it, falling back to name when either
// omits it (the parser allows a null rptOwnerCik), so an amendment still supersedes
// across a CIK-presence change.
export async function supersedeInsiderFiling(
  db: QueryExecutor,
  key: SupersedeInsiderFilingKey,
): Promise<SupersedeInsiderFilingResult> {
  // Types are erased at runtime; a null period would compare as `= NULL` (never true)
  // and silently supersede nothing, so fail loudly instead.
  if (!key.period_of_report) {
    throw new Error("supersedeInsiderFiling: period_of_report is required");
  }

  // 1. Delete the prior read-model rows, capturing the source(s) that produced them.
  const deleted = await db.query<{ source_id: string }>(
    `delete from insider_transactions
       where issuer_id = $1
         and period_of_report = $2::date
         and (
           ($3::text is not null and (insider_cik = $3 or (insider_cik is null and insider_name = $4)))
           or ($3::text is null and insider_name = $4)
         )
     returning source_id::text as source_id`,
    [key.issuer_id, key.period_of_report, key.insider_cik, key.insider_name],
  );
  const sourceIds = [...new Set(deleted.rows.map((r) => r.source_id))];
  if (sourceIds.length === 0) return { transactions: 0, claims: 0, events: 0, documents: 0 };

  // 2. Delete the material claims those filings produced (claim_arguments cascade).
  const claims = await db.query(
    `delete from claims where predicate = 'insider.transaction' and reported_by_source_id = any($1::uuid[])`,
    [sourceIds],
  );
  // 3. Delete the per-transaction events (event_subjects cascade). source_ids is a
  //    jsonb array of source UUIDs; match events that reference any superseded source.
  //    Each Form 4 filing creates its own source, so this targets exactly its events.
  const events = await db.query(
    `delete from events
      where event_type = 'insider_transaction'
        and exists (
          select 1 from jsonb_array_elements_text(source_ids) sid where sid = any($1::text[])
        )`,
    [sourceIds],
  );
  // 4. Mark the prior filing's document(s) superseded (bytes/source retained), so the
  //    now-claimless document is explained rather than mislabeled 'parsed'.
  const documents = await db.query(
    `update documents set parse_status = 'superseded'
      where source_id = any($1::uuid[]) and parse_status <> 'superseded'`,
    [sourceIds],
  );
  return {
    transactions: deleted.rowCount ?? 0,
    claims: claims.rowCount ?? 0,
    events: events.rowCount ?? 0,
    documents: documents.rowCount ?? 0,
  };
}

export type RecentInsiderTransaction = {
  insider_name: string;
  insider_role: string;
  transaction_date: string; // YYYY-MM-DD
  transaction_type: string;
  shares: number;
  price: number | null;
  value: number | null;
  source_id: string;
  filed_at: string;
};

type RecentRow = {
  insider_name: string;
  insider_role: string;
  transaction_date: string;
  transaction_type: string;
  shares: number | string;
  price: number | string | null;
  value: number | string | null;
  source_id: string;
  filed_at: Date | string;
};

export async function findRecentByIssuer(
  db: QueryExecutor,
  issuerId: string,
  sinceDays: number,
): Promise<RecentInsiderTransaction[]> {
  const { rows } = await db.query<RecentRow>(
    `select insider_name,
            insider_role,
            to_char(transaction_date, 'YYYY-MM-DD') as transaction_date,
            transaction_type,
            shares,
            price,
            value,
            source_id::text as source_id,
            filed_at
       from insider_transactions
      where issuer_id = $1
        and transaction_date >= current_date - $2::int
      order by transaction_date desc, insider_transaction_id desc`,
    [issuerId, sinceDays],
  );
  return rows.map((row) => ({
    insider_name: row.insider_name,
    insider_role: row.insider_role,
    transaction_date: row.transaction_date,
    transaction_type: row.transaction_type,
    shares: Number(row.shares),
    price: row.price === null ? null : Number(row.price),
    value: row.value === null ? null : Number(row.value),
    source_id: row.source_id,
    filed_at: row.filed_at instanceof Date ? row.filed_at.toISOString() : row.filed_at,
  }));
}

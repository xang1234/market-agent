import type { QueryResult } from "pg";
import {
  ambiguous,
  CONFIDENCE_TICKER_AMBIGUOUS,
  CONFIDENCE_TICKER_SINGLE,
  CONFIDENCE_UNIQUE_IDENTIFIER,
  notFound,
  resolved,
  type NotFoundReason,
  type ResolverCandidate,
  type ResolverEnvelope,
} from "./envelope.ts";
import { normalizeCik } from "./normalize.ts";

// Minimal queryable surface — a `pg.Client` or `pg.Pool` both satisfy it,
// and callers can stub it in tests without dragging the full pg type in.
export type QueryExecutor = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
};

type IssuerRow = {
  issuer_id: string;
  legal_name: string;
};

type InstrumentRow = {
  instrument_id: string;
  issuer_id: string;
  asset_type: string;
  share_class: string | null;
  legal_name: string;
};

type ListingRow = {
  listing_id: string;
  instrument_id: string;
  issuer_id: string;
  mic: string;
  ticker: string;
  share_class: string | null;
  legal_name: string;
};

type TickerInput = { kind: "ticker"; value: string; mic?: string };
type CikInput = { kind: "cik"; value: string };
type IsinInput = { kind: "isin"; value: string };
type LeiInput = { kind: "lei"; value: string };
export type ResolverInput = TickerInput | CikInput | IsinInput | LeiInput;

export async function resolveByInput(
  db: QueryExecutor,
  input: ResolverInput,
): Promise<ResolverEnvelope> {
  switch (input.kind) {
    case "ticker":
      return resolveByTicker(db, input.value, { mic: input.mic });
    case "cik":
      return resolveByCik(db, input.value);
    case "isin":
      return resolveByIsin(db, input.value);
    case "lei":
      return resolveByLei(db, input.value);
  }
}

export async function resolveByCik(
  db: QueryExecutor,
  cik: string,
): Promise<ResolverEnvelope> {
  return resolveByIssuerIdentifier(db, {
    normalized: normalizeCik(cik.trim()),
    column: "cik",
    reason: "unknown_cik",
  });
}

export async function resolveByLei(
  db: QueryExecutor,
  lei: string,
): Promise<ResolverEnvelope> {
  return resolveByIssuerIdentifier(db, {
    normalized: lei.trim().toUpperCase(),
    column: "lei",
    reason: "unknown_lei",
  });
}

export async function resolveByIsin(
  db: QueryExecutor,
  isin: string,
): Promise<ResolverEnvelope> {
  const normalized = isin.trim().toUpperCase();
  const result: QueryResult<InstrumentRow> = await db.query(
    `select i.instrument_id, i.issuer_id, i.asset_type, i.share_class, iss.legal_name
       from instruments i
       join issuers iss on iss.issuer_id = i.issuer_id
      where i.isin = $1`,
    [normalized],
  );

  if (result.rows.length === 0) {
    return notFound({ normalized_input: normalized, reason: "unknown_isin" });
  }

  const row = result.rows[0];
  return resolved({
    subject_ref: { kind: "instrument", id: row.instrument_id },
    display_name: instrumentDisplayName(row),
    confidence: CONFIDENCE_UNIQUE_IDENTIFIER,
    canonical_kind: "instrument",
  });
}

export async function resolveByTicker(
  db: QueryExecutor,
  ticker: string,
  opts: { mic?: string } = {},
): Promise<ResolverEnvelope> {
  const normalized = ticker.trim().toUpperCase();

  const base = `select l.listing_id, l.instrument_id, l.mic, l.ticker,
                       i.issuer_id, i.share_class, iss.legal_name
                  from listings l
                  join instruments i on i.instrument_id = l.instrument_id
                  join issuers iss on iss.issuer_id = i.issuer_id
                 where l.ticker = $1`;

  let result: QueryResult<ListingRow>;
  if (opts.mic) {
    result = await db.query(`${base} and l.mic = $2 order by l.mic`, [
      normalized,
      opts.mic.toUpperCase(),
    ]);
  } else {
    result = await db.query(`${base} order by l.mic`, [normalized]);
  }

  if (result.rows.length === 0) {
    return notFound({ normalized_input: normalized, reason: "unknown_ticker" });
  }

  if (result.rows.length === 1) {
    const row = result.rows[0];
    return resolved({
      subject_ref: { kind: "listing", id: row.listing_id },
      display_name: listingDisplayName(row),
      confidence: CONFIDENCE_TICKER_SINGLE,
      canonical_kind: "listing",
    });
  }

  const candidates: ResolverCandidate[] = result.rows.map((row) => ({
    subject_ref: { kind: "listing", id: row.listing_id },
    display_name: listingDisplayName(row),
    confidence: CONFIDENCE_TICKER_AMBIGUOUS,
    match_reason: "exact_ticker_match",
  }));

  const distinctIssuers = new Set(result.rows.map((row) => row.issuer_id));
  const axis = distinctIssuers.size > 1 ? "multiple_issuers" : "multiple_listings";

  return ambiguous({ candidates, ambiguity_axis: axis });
}

async function resolveByIssuerIdentifier(
  db: QueryExecutor,
  args: { normalized: string; column: "cik" | "lei"; reason: NotFoundReason },
): Promise<ResolverEnvelope> {
  // `column` is a typed literal, not user input, so the interpolation is safe.
  const result: QueryResult<IssuerRow> = await db.query(
    `select issuer_id, legal_name from issuers where ${args.column} = $1`,
    [args.normalized],
  );

  if (result.rows.length === 0) {
    return notFound({ normalized_input: args.normalized, reason: args.reason });
  }

  const row = result.rows[0];
  return resolved({
    subject_ref: { kind: "issuer", id: row.issuer_id },
    display_name: row.legal_name,
    confidence: CONFIDENCE_UNIQUE_IDENTIFIER,
    canonical_kind: "issuer",
  });
}

function instrumentDisplayName(row: InstrumentRow): string {
  return row.share_class ? `${row.legal_name} (${row.share_class})` : row.legal_name;
}

function listingDisplayName(row: ListingRow): string {
  const base = row.share_class ? `${row.legal_name} (${row.share_class})` : row.legal_name;
  return `${row.ticker} · ${row.mic} — ${base}`;
}

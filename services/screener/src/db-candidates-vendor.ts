// Vendor-backed screener candidate repository (screener-artifacts feed).
//
// Unlike createPostgresCandidateRepository (which derives margins/PE from six
// reported SEC facts, one per-issuer read per candidate), this repository serves
// the bulk vendor universe ingested by services/screener-artifacts. Two deliberate
// differences:
//   1. Set-based — ONE query pivots the latest method='vendor' point facts for the
//      whole universe, instead of an N+1 per-candidate fundamentals read. Essential
//      at ~9.8k symbols.
//   2. Quote-optional — the market_quote_snapshots join is a LEFT join, so a symbol
//      with no fresh quote still renders (fundamentals-first), with a null price.
//      The vendor weekly bundle carries no price, so requiring a quote would hide
//      the entire universe until the daily-price feed lands (Phase 4).
//
// Fundamentals are the finished vendor ratios as-is (the bundle ships ratios, not
// statement absolutes); margins/PE come through null because that feed is 0%-covered
// for them — they keep coming from the reported path.

import type { ScreenerCandidate, ScreenerCandidateRepository } from "./candidate.ts";
import {
  displayFromRow,
  isoString,
  universeFromRow,
  type ScreenerIdentityRow,
} from "./candidate-row.ts";
import type { ScreenerFundamentalsSummary, ScreenerQuoteSummary } from "./result.ts";

export type VendorCandidateQueryExecutor = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[] }>;
};

// Screener fundamentals field → backing metric_key. forward_pe maps to the
// forward_pe_ratio metric; the rest match. The reported-only fields (pe_ratio,
// margins) are pivoted too — they come through null from this feed.
const FUNDAMENTAL_METRIC_KEYS: ReadonlyArray<string> = [
  "market_cap",
  "pe_ratio",
  "gross_margin",
  "operating_margin",
  "net_margin",
  "revenue_growth_yoy",
  "forward_pe_ratio",
  "roic",
  "perf_quarter",
  "perf_year",
  "rsi_14",
  "week_52_high_distance",
];

// Vendor candidates are scoped to the artifact-ingested universe by requiring an
// issuer_profile_enrichments row from this provider — every seeded universe entry
// gets sector/industry enrichments under it, so it's a precise "came from the
// weekly-reference ingest" marker. Without it, any provider-enriched listing (e.g.
// SEC/Polygon-discovered) with a populated profile but no artifact facts would leak
// into vendor screens with all-null fundamentals.
const ARTIFACT_ENRICHMENT_PROVIDER = "xang1234_stock_screener";

export function createVendorScreenerCandidateRepository(
  db: VendorCandidateQueryExecutor,
  clock: () => Date = () => new Date(),
): ScreenerCandidateRepository {
  return {
    async list() {
      return loadVendorScreenerCandidates(db, clock());
    },
    async findByRef(ref) {
      const candidates = await loadVendorScreenerCandidates(db, clock());
      return (
        candidates.find(
          (candidate) =>
            candidate.subject_ref.kind === ref.kind && candidate.subject_ref.id === ref.id,
        ) ?? null
      );
    },
  };
}

type VendorCandidateRow = ScreenerIdentityRow & {
  price: string | number | null;
  prev_close: string | number | null;
  delay_class: string | null;
  currency: string | null;
  as_of: Date | string | null;
  market_cap: string | number | null;
  pe_ratio: string | number | null;
  gross_margin: string | number | null;
  operating_margin: string | number | null;
  net_margin: string | number | null;
  revenue_growth_yoy: string | number | null;
  forward_pe: string | number | null;
  roic: string | number | null;
  perf_quarter: string | number | null;
  perf_year: string | number | null;
  rsi_14: string | number | null;
  week_52_high_distance: string | number | null;
};

export async function loadVendorScreenerCandidates(
  db: VendorCandidateQueryExecutor,
  now: Date = new Date(),
): Promise<ReadonlyArray<ScreenerCandidate>> {
  const nowIso = now.toISOString();
  const rows = await db.query<VendorCandidateRow>(
    `select l.listing_id::text as listing_id,
            iss.legal_name,
            i.share_class,
            i.asset_type,
            l.mic,
            l.ticker,
            l.trading_currency,
            iss.domicile,
            iss.sector,
            iss.industry,
            q.price, q.prev_close, q.delay_class, q.currency, q.as_of,
            f.market_cap, f.pe_ratio, f.gross_margin, f.operating_margin,
            f.net_margin, f.revenue_growth_yoy, f.forward_pe, f.roic,
            f.perf_quarter, f.perf_year, f.rsi_14, f.week_52_high_distance
       from listings l
       join instruments i on i.instrument_id = l.instrument_id
       join issuers iss on iss.issuer_id = i.issuer_id
       left join lateral (
         select price, prev_close, delay_class, currency, as_of
           from market_quote_snapshots
          where listing_id = l.listing_id and expires_at > $1
          order by as_of desc
          limit 1
       ) q on true
       left join lateral (
         select
           max(value_num) filter (where metric_key = 'market_cap') as market_cap,
           max(value_num) filter (where metric_key = 'pe_ratio') as pe_ratio,
           max(value_num) filter (where metric_key = 'gross_margin') as gross_margin,
           max(value_num) filter (where metric_key = 'operating_margin') as operating_margin,
           max(value_num) filter (where metric_key = 'net_margin') as net_margin,
           max(value_num) filter (where metric_key = 'revenue_growth_yoy') as revenue_growth_yoy,
           max(value_num) filter (where metric_key = 'forward_pe_ratio') as forward_pe,
           max(value_num) filter (where metric_key = 'roic') as roic,
           max(value_num) filter (where metric_key = 'perf_quarter') as perf_quarter,
           max(value_num) filter (where metric_key = 'perf_year') as perf_year,
           max(value_num) filter (where metric_key = 'rsi_14') as rsi_14,
           max(value_num) filter (where metric_key = 'week_52_high_distance') as week_52_high_distance
         from (
           select distinct on (m.metric_key) m.metric_key, fa.value_num
             from facts fa
             join metrics m on m.metric_id = fa.metric_id
            where fa.subject_kind = 'issuer'
              and fa.subject_id = iss.issuer_id
              and fa.method = 'vendor'
              and fa.period_kind = 'point'
              and fa.superseded_by is null
              and fa.invalidated_at is null
              and m.metric_key = any($2::text[])
            order by m.metric_key, fa.as_of desc, fa.observed_at desc
         ) latest
       ) f on true
      where l.active_to is null
        and iss.domicile is not null
        and iss.sector is not null
        and iss.industry is not null
        and exists (
          select 1
            from issuer_profile_enrichments e
           where e.issuer_id = iss.issuer_id and e.provider = $3
        )
      order by l.ticker, l.mic, l.listing_id`,
    [nowIso, [...FUNDAMENTAL_METRIC_KEYS], ARTIFACT_ENRICHMENT_PROVIDER],
  );

  const candidates: ScreenerCandidate[] = [];
  for (const row of rows.rows) {
    const universe = universeFromRow(row);
    if (!universe) continue;
    candidates.push({
      subject_ref: { kind: "listing", id: row.listing_id },
      display: displayFromRow(row),
      universe,
      quote: quoteFromRow(row, nowIso),
      fundamentals: fundamentalsFromRow(row),
    });
  }
  return Object.freeze(candidates);
}

function quoteFromRow(row: VendorCandidateRow, nowIso: string): ScreenerQuoteSummary {
  const price = numOrNull(row.price);
  if (price === null) {
    // No fresh quote — fundamentals-first row. delay_class 'unknown' is the
    // screener's sentinel for an absent quote.
    return {
      last_price: null,
      prev_close: null,
      change_pct: null,
      volume: null,
      delay_class: "unknown",
      currency: row.trading_currency,
      as_of: nowIso,
    };
  }
  const prevClose = numOrNull(row.prev_close);
  return {
    last_price: price,
    prev_close: prevClose,
    change_pct: prevClose === null || prevClose === 0 ? null : (price - prevClose) / prevClose,
    volume: null,
    delay_class: row.delay_class ?? "unknown",
    currency: row.currency ?? row.trading_currency,
    // A quote row with a price always carries an as_of; fall back to nowIso only
    // for the degenerate null case.
    as_of: row.as_of === null ? nowIso : isoString(row.as_of),
  };
}

function fundamentalsFromRow(row: VendorCandidateRow): ScreenerFundamentalsSummary {
  return {
    market_cap: numOrNull(row.market_cap),
    pe_ratio: numOrNull(row.pe_ratio),
    gross_margin: numOrNull(row.gross_margin),
    operating_margin: numOrNull(row.operating_margin),
    net_margin: numOrNull(row.net_margin),
    // The vendor feed stores revenue growth as percent points (its registry unit),
    // but the screener field is fractional — the reported path computes
    // (latest-prior)/prior and the UI labels it fractional. Convert at this boundary
    // so vendor and reported candidates agree. The other percent fields (perf_*,
    // roic) are new fields shown as percent end-to-end and need no conversion.
    revenue_growth_yoy: percentToFraction(numOrNull(row.revenue_growth_yoy)),
    forward_pe: numOrNull(row.forward_pe),
    roic: numOrNull(row.roic),
    perf_quarter: numOrNull(row.perf_quarter),
    perf_year: numOrNull(row.perf_year),
    rsi_14: numOrNull(row.rsi_14),
    week_52_high_distance: numOrNull(row.week_52_high_distance),
  };
}

function numOrNull(value: string | number | null): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function percentToFraction(value: number | null): number | null {
  return value === null ? null : value / 100;
}

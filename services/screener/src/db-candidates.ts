import type {
  ScreenerCandidate,
  ScreenerCandidateUniverse,
} from "./candidate.ts";
import type { AssetType } from "./fields.ts";

export type ScreenerCandidateQueryExecutor = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[] }>;
};

type CandidateRow = {
  issuer_id: string;
  listing_id: string;
  legal_name: string;
  share_class: string | null;
  asset_type: AssetType;
  mic: string;
  ticker: string;
  trading_currency: string;
  domicile: string | null;
  sector: string | null;
  industry: string | null;
  price: string | number;
  prev_close: string | number;
  delay_class: string;
  currency: string;
  as_of: Date | string;
};

type FactRow = {
  metric_key: string;
  fiscal_year: number;
  value_num: string | number | null;
};

export async function loadPostgresScreenerCandidates(
  db: ScreenerCandidateQueryExecutor,
  now: Date = new Date(),
): Promise<ReadonlyArray<ScreenerCandidate>> {
  const rows = await db.query<CandidateRow>(
    `select iss.issuer_id::text as issuer_id,
            l.listing_id::text as listing_id,
            iss.legal_name,
            i.share_class,
            i.asset_type,
            l.mic,
            l.ticker,
            l.trading_currency,
            iss.domicile,
            iss.sector,
            iss.industry,
            q.price,
            q.prev_close,
            q.delay_class,
            q.currency,
            q.as_of
       from listings l
       join instruments i on i.instrument_id = l.instrument_id
       join issuers iss on iss.issuer_id = i.issuer_id
       join lateral (
         select price, prev_close, delay_class, currency, as_of
           from market_quote_snapshots
          where listing_id = l.listing_id
            and expires_at > $1
          order by as_of desc
          limit 1
       ) q on true
      where l.active_to is null
        and iss.domicile is not null
        and iss.sector is not null
        and iss.industry is not null
      order by l.ticker, l.mic, l.listing_id`,
    [now.toISOString()],
  );

  const candidates: ScreenerCandidate[] = [];
  for (const row of rows.rows) {
    const universe = universeFromRow(row);
    if (!universe) continue;
    const price = Number(row.price);
    const prevClose = Number(row.prev_close);
    const facts = await loadLatestFundamentals(db, row.issuer_id);
    const latest = facts.current;
    const prior = facts.prior;
    const revenue = latest.revenue;
    const grossProfit = latest.gross_profit;
    const operatingIncome = latest.operating_income;
    const netIncome = latest.net_income;
    const epsDiluted = latest.eps_diluted;
    const dilutedShares = latest.shares_outstanding_diluted;

    candidates.push({
      subject_ref: { kind: "listing", id: row.listing_id },
      display: {
        primary: `${row.ticker} · ${row.mic} — ${row.legal_name}`,
        ticker: row.ticker,
        mic: row.mic,
        legal_name: row.legal_name,
        ...(row.share_class ? { share_class: row.share_class } : {}),
      },
      universe,
      quote: {
        last_price: price,
        prev_close: prevClose,
        change_pct: prevClose === 0 ? null : (price - prevClose) / prevClose,
        volume: null,
        delay_class: row.delay_class,
        currency: row.currency,
        as_of: isoString(row.as_of),
      },
      fundamentals: {
        market_cap: dilutedShares === null ? null : dilutedShares * price,
        pe_ratio: epsDiluted === null || epsDiluted === 0 ? null : price / epsDiluted,
        gross_margin: ratio(grossProfit, revenue),
        operating_margin: ratio(operatingIncome, revenue),
        net_margin: ratio(netIncome, revenue),
        revenue_growth_yoy: latest.revenue === null || prior.revenue === null || prior.revenue === 0
          ? null
          : (latest.revenue - prior.revenue) / prior.revenue,
      },
    });
  }

  return Object.freeze(candidates);
}

function universeFromRow(row: CandidateRow): ScreenerCandidateUniverse | null {
  if (!row.domicile || !row.sector || !row.industry) return null;
  return {
    asset_type: row.asset_type,
    mic: row.mic,
    trading_currency: row.trading_currency,
    domicile: row.domicile,
    sector: row.sector,
    industry: row.industry,
  };
}

async function loadLatestFundamentals(
  db: ScreenerCandidateQueryExecutor,
  issuerId: string,
): Promise<{
  current: Record<string, number | null>;
  prior: Record<string, number | null>;
}> {
  const result = await db.query<FactRow>(
    `with latest_year as (
       select max(f.fiscal_year)::int as fiscal_year
         from facts f
         join metrics m on m.metric_id = f.metric_id
        where f.subject_kind = 'issuer'
          and f.subject_id = $1
          and f.period_kind = 'fiscal_y'
          and f.fiscal_period = 'FY'
          and f.method = 'reported'
          and f.invalidated_at is null
          and f.superseded_by is null
          and m.metric_key = 'revenue'
     )
     select m.metric_key,
            f.fiscal_year,
            f.value_num
       from facts f
       join metrics m on m.metric_id = f.metric_id
       join latest_year ly on f.fiscal_year in (ly.fiscal_year, ly.fiscal_year - 1)
      where f.subject_kind = 'issuer'
        and f.subject_id = $1
        and f.period_kind = 'fiscal_y'
        and f.fiscal_period = 'FY'
        and f.method = 'reported'
        and f.invalidated_at is null
        and f.superseded_by is null
        and m.metric_key = any($2::text[])
      order by f.fiscal_year desc, m.metric_key, f.as_of desc`,
    [
      issuerId,
      [
        "revenue",
        "gross_profit",
        "operating_income",
        "net_income",
        "eps_diluted",
        "shares_outstanding_diluted",
      ],
    ],
  );

  const latestYear = result.rows[0]?.fiscal_year;
  const current = emptyFacts();
  const prior = emptyFacts();
  if (latestYear === undefined) {
    return { current, prior };
  }

  const seen = new Set<string>();
  for (const row of result.rows) {
    const bucket = row.fiscal_year === latestYear ? current : prior;
    const key = `${row.fiscal_year}:${row.metric_key}`;
    if (seen.has(key)) continue;
    seen.add(key);
    bucket[row.metric_key] = row.value_num === null ? null : Number(row.value_num);
  }

  return { current, prior };
}

function emptyFacts(): Record<string, number | null> {
  return {
    revenue: null,
    gross_profit: null,
    operating_income: null,
    net_income: null,
    eps_diluted: null,
    shares_outstanding_diluted: null,
  };
}

function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator === 0) return null;
  return numerator / denominator;
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

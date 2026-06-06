import type {
  ScreenerCandidate,
  ScreenerCandidateRepository,
  ScreenerCandidateUniverse,
} from "./candidate.ts";
import type { AssetType } from "./fields.ts";
import {
  loadRecentIssuerFundamentals,
  type IssuerFundamentalFact,
} from "../../fundamentals/src/issuer-fundamentals-reader.ts";

// The six annual reported metrics the screener derives ratios from. This is the
// single source of truth: it bounds the reader query and shapes the empty fact
// buckets (see emptyFacts).
const SCREENER_FUNDAMENTAL_METRICS = [
  "revenue",
  "gross_profit",
  "operating_income",
  "net_income",
  "eps_diluted",
  "shares_outstanding_diluted",
] as const;

export type ScreenerCandidateQueryExecutor = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[] }>;
};

export function createPostgresCandidateRepository(
  db: ScreenerCandidateQueryExecutor,
  clock: () => Date = () => new Date(),
): ScreenerCandidateRepository {
  return {
    async list() {
      return loadPostgresScreenerCandidates(db, clock());
    },
    async findByRef(ref) {
      const candidates = await loadPostgresScreenerCandidates(db, clock());
      return candidates.find((candidate) =>
        candidate.subject_ref.kind === ref.kind && candidate.subject_ref.id === ref.id
      ) ?? null;
    },
  };
}

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
    const facts = pickCurrentPriorFundamentals(
      await loadRecentIssuerFundamentals(
        db,
        { kind: "issuer", id: row.issuer_id },
        {
          channel: "app",
          periodKind: "fiscal_y",
          metricKeys: SCREENER_FUNDAMENTAL_METRICS,
        },
      ),
    );
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

function pickCurrentPriorFundamentals(facts: ReadonlyArray<IssuerFundamentalFact>): {
  current: Record<string, number | null>;
  prior: Record<string, number | null>;
} {
  // Revenue-anchored: current = latest fiscal year that has a revenue fact;
  // prior = current - 1. Keeps margins' numerator and denominator in the same
  // year and matches the pre-migration latest_year CTE behavior.
  let currentYear: number | null = null;
  for (const fact of facts) {
    if (fact.metric_key === "revenue" && fact.fiscal_year !== null) {
      if (currentYear === null || fact.fiscal_year > currentYear) {
        currentYear = fact.fiscal_year;
      }
    }
  }

  const current = emptyFacts();
  const prior = emptyFacts();
  if (currentYear === null) return { current, prior };

  const priorYear = currentYear - 1;
  const seen = new Set<string>();
  for (const fact of facts) {
    if (fact.fiscal_year !== currentYear && fact.fiscal_year !== priorYear) continue;
    if (!(fact.metric_key in current)) continue; // ignore metrics outside the set
    const key = `${fact.fiscal_year}:${fact.metric_key}`;
    if (seen.has(key)) continue; // reader orders as_of desc ⇒ first write is newest
    seen.add(key);
    (fact.fiscal_year === currentYear ? current : prior)[fact.metric_key] = fact.value_num;
  }

  return { current, prior };
}

function emptyFacts(): Record<string, number | null> {
  return Object.fromEntries(SCREENER_FUNDAMENTAL_METRICS.map((key) => [key, null]));
}

function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator === 0) return null;
  return numerator / denominator;
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

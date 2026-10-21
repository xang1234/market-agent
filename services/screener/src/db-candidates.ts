import type { ScreenerCandidate, ScreenerCandidateRepository } from "./candidate.ts";
import {
  displayFromRow,
  isoString,
  universeFromRow,
  type ScreenerIdentityRow,
} from "./candidate-row.ts";
import {
  loadRecentIssuerFundamentals,
  type IssuerFundamentalFact,
} from "../../fundamentals/src/issuer-fundamentals-reader.ts";
import { lastRegularSessionDate } from "../../market/src/ytd-window.ts";

// The four annual reported metrics the screener derives margins and growth
// from. This is the single source of truth: it bounds the reader query and
// shapes the empty fact buckets (see emptyFacts). Market cap and P/E are
// certified engine figures instead (loadCertifiedValuations).
const SCREENER_FUNDAMENTAL_METRICS = [
  "revenue",
  "gross_profit",
  "operating_income",
  "net_income",
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

type CandidateRow = ScreenerIdentityRow & {
  issuer_id: string;
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
  const certified = await loadCertifiedValuations(db, rows.rows.map((row) => row.issuer_id), now);

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
          // The screener computes with these; a text-only fact has no value.
          numericOnly: true,
        },
      ),
    );
    const latest = facts.current;
    const prior = facts.prior;
    const revenue = latest.revenue;
    const grossProfit = latest.gross_profit;
    const operatingIncome = latest.operating_income;
    const netIncome = latest.net_income;
    const valuation = certified.get(row.issuer_id);
    const insiderNetShares90d = await loadInsiderNetShares90d(db, row.issuer_id, now);

    candidates.push({
      subject_ref: { kind: "listing", id: row.listing_id },
      display: displayFromRow(row),
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
        // The issuer's certified figures, so every listing of it shows the same ones (#444).
        market_cap: valuation?.market_cap ?? null,
        market_cap_currency: valuation?.market_cap_currency ?? null,
        pe_ratio: valuation?.pe_ratio ?? null,
        gross_margin: ratio(grossProfit, revenue),
        operating_margin: ratio(operatingIncome, revenue),
        net_margin: ratio(netIncome, revenue),
        revenue_growth_yoy: latest.revenue === null || prior.revenue === null || prior.revenue === 0
          ? null
          : (latest.revenue - prior.revenue) / prior.revenue,
        insider_net_shares_90d: insiderNetShares90d,
        // Technical/momentum fields are vendor-sourced (screener-artifacts); the
        // reported SEC path has no data for them.
        forward_pe: null,
        roic: null,
        perf_quarter: null,
        perf_year: null,
        rsi_14: null,
        week_52_high_distance: null,
      },
    });
  }

  return Object.freeze(candidates);
}

type CertifiedValuation = { market_cap: number | null; market_cap_currency: string | null; pe_ratio: number | null };

/**
 * Each issuer's certified market cap and P/E, as the certification batch wrote
 * them (services/dev-api/src/screener-certification.ts), in one query. A figure
 * counts while it certifies the last regular session closed by `now`, in the
 * zone of the listing it was priced on. An older one reads as absent, so the
 * screener shows no value rather than a stale one until the batch runs again.
 */
async function loadCertifiedValuations(
  db: ScreenerCandidateQueryExecutor,
  issuerIds: ReadonlyArray<string>,
  now: Date,
): Promise<Map<string, CertifiedValuation>> {
  const { rows } = await db.query<{
    issuer_id: string;
    valuation: "market_cap" | "pe_ratio";
    value: string;
    currency: string | null;
    session_date: string;
    timezone: string;
  }>(
    `select v.issuer_id::text as issuer_id, v.valuation, v.value::text as value, v.currency,
            v.session_date::text as session_date, l.timezone
       from screener_certified_valuations v
       join listings l on l.listing_id = v.listing_id
      where v.issuer_id = any($1::uuid[]) and v.value is not null`,
    [issuerIds],
  );
  const floors = new Map<string, string>();
  const floor = (timezone: string) => {
    if (!floors.has(timezone)) floors.set(timezone, lastRegularSessionDate(now.toISOString(), timezone));
    return floors.get(timezone)!;
  };
  const valuations = new Map<string, CertifiedValuation>();
  for (const row of rows) {
    if (row.session_date < floor(row.timezone)) continue;
    const valuation = valuations.get(row.issuer_id) ?? { market_cap: null, market_cap_currency: null, pe_ratio: null };
    if (row.valuation === "market_cap") {
      valuation.market_cap = Number(row.value);
      valuation.market_cap_currency = row.currency;
    } else {
      valuation.pe_ratio = Number(row.value);
    }
    valuations.set(row.issuer_id, valuation);
  }
  return valuations;
}

// Net shares acquired by insiders over the trailing 90 days (acquired minus
// disposed), computed at query time from the Form 4 read model — not a stored
// fact (the screener gates facts on method='reported'; this is derived). The
// window is by transaction_date (when the trade occurred), matching the Holders
// reader (findRecentByIssuer) so both views of this table agree.
async function loadInsiderNetShares90d(
  db: ScreenerCandidateQueryExecutor,
  issuerId: string,
  now: Date,
): Promise<number | null> {
  const cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { rows } = await db.query<{ net_shares: string | null }>(
    `select sum(case when acquired_disposed = 'A' then shares else -shares end) as net_shares
       from insider_transactions
      where issuer_id = $1 and transaction_date >= $2::date`,
    [issuerId, cutoff],
  );
  const raw = rows[0]?.net_shares;
  return raw === null || raw === undefined ? null : Number(raw);
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

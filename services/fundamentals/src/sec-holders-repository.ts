import type { UUID } from "./subject-ref.ts";
import type { HoldersRepository } from "./holders-repository.ts";
import {
  freezeInsiderHoldersEnvelope,
  freezeInstitutionalHoldersEnvelope,
  type HolderKind,
  type HoldersEnvelope,
  type InsiderTransaction,
  type InsiderTransactionType,
  type InstitutionalHolder,
} from "./holders.ts";

// Minimal query surface. The fundamentals repos each declare their own executor
// type (FundamentalsQueryExecutor, IssuerProfileQueryExecutor — there is no
// shared types module); a pg Pool/Client satisfies this.
export type HoldersQueryExecutor = {
  query<R extends Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<{ rows: R[] }>;
};

type InsiderRow = {
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

type InstitutionalRow = {
  filer_name: string;
  shares: number | string;
  value_usd: number | string;
  shares_change: number | string;
  filing_period: string;
  filing_date: string;
  source_id: string;
};

// SEC-backed insider holders, reading the Form 4 read model (insider_transactions,
// owned by the evidence plane — same Postgres, shared-schema convention). Returns
// null for "institutional" and when there is no insider coverage, so the caller
// falls through to the (yfinance) dev provider.
export function createSecHoldersRepository(db: HoldersQueryExecutor): HoldersRepository {
  return {
    async find(issuer_id: UUID, kind: HolderKind): Promise<HoldersEnvelope | null> {
      if (kind === "institutional") return findInstitutional(db, issuer_id);
      if (kind !== "insider") return null;
      const { rows } = await db.query<InsiderRow>(
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
          order by transaction_date desc, insider_transaction_id desc
          limit 50`,
        [issuer_id],
      );
      if (rows.length === 0) return null;
      const holders: InsiderTransaction[] = rows.map((row) => ({
        insider_name: row.insider_name,
        insider_role: row.insider_role,
        transaction_date: row.transaction_date,
        transaction_type: row.transaction_type as InsiderTransactionType,
        shares: Number(row.shares),
        price: row.price === null ? null : Number(row.price),
        value: row.value === null ? null : Number(row.value),
      }));
      // as_of/source reflect the most recently FILED row, not the latest
      // transaction_date: a later filing can restate an older trade
      // (amendment/correction), and "as of" should track when we last learned.
      const toMs = (v: Date | string): number => new Date(v).getTime();
      const newestFiled = rows.reduce((a, b) => (toMs(b.filed_at) > toMs(a.filed_at) ? b : a));
      return freezeInsiderHoldersEnvelope({
        subject: { kind: "issuer", id: issuer_id },
        currency: "USD",
        holders,
        as_of: new Date(newestFiled.filed_at).toISOString(),
        source_id: newestFiled.source_id as UUID,
      });
    },
  };
}

// SEC-backed institutional holders, reading the 13F read model (institutional_holdings).
// Returns the issuer's most recent reporting period's top holders by position value,
// with each holder's share change vs their own prior period. Null when there is no
// coverage, so the caller falls through to the dev provider.
async function findInstitutional(db: HoldersQueryExecutor, issuer_id: UUID): Promise<HoldersEnvelope | null> {
  const { rows } = await db.query<InstitutionalRow>(
    `with latest as (
       select max(filing_period) as p from institutional_holdings where issuer_id = $1
     )
     select ih.filer_name,
            ih.shares,
            ih.value_usd,
            ih.shares - coalesce((
              select pr.shares
                from institutional_holdings pr
               where pr.issuer_id = ih.issuer_id
                 and pr.filer_cik = ih.filer_cik
                 and pr.filing_period < ih.filing_period
               order by pr.filing_period desc
               limit 1
            ), 0) as shares_change,
            to_char(ih.filing_period, 'YYYY-MM-DD') as filing_period,
            to_char(ih.filing_date, 'YYYY-MM-DD') as filing_date,
            ih.source_id::text as source_id
       from institutional_holdings ih, latest
      where ih.issuer_id = $1 and ih.filing_period = latest.p
      order by ih.value_usd desc, ih.filer_name
      limit 50`,
    [issuer_id],
  );
  if (rows.length === 0) return null;
  const holders: InstitutionalHolder[] = rows.map((row) => ({
    holder_name: row.filer_name,
    shares_held: Number(row.shares),
    market_value: Number(row.value_usd),
    // 13F carries no ownership percentage; deriving it needs a shares_outstanding
    // fact (deferred). null is honest — the Holders UI renders it as "—".
    percent_of_shares_outstanding: null,
    shares_change: Number(row.shares_change),
    filing_date: row.filing_date,
  }));
  // as_of is the reporting period end (quarter close), NOT now: 13F lands ~45 days
  // after period end, so the snapshot disclosure compiler surfaces the staleness.
  const latest = rows[0]!;
  return freezeInstitutionalHoldersEnvelope({
    subject: { kind: "issuer", id: issuer_id },
    currency: "USD",
    holders,
    as_of: `${latest.filing_period}T00:00:00.000Z`,
    source_id: latest.source_id as UUID,
  });
}

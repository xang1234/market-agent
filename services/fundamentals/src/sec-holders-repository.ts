import type { UUID } from "./subject-ref.ts";
import type { HoldersRepository } from "./holders-repository.ts";
import {
  freezeInsiderHoldersEnvelope,
  type HolderKind,
  type HoldersEnvelope,
  type InsiderTransaction,
  type InsiderTransactionType,
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

// SEC-backed insider holders, reading the Form 4 read model (insider_transactions,
// owned by the evidence plane — same Postgres, shared-schema convention). Returns
// null for "institutional" and when there is no insider coverage, so the caller
// falls through to the (yfinance) dev provider.
export function createSecHoldersRepository(db: HoldersQueryExecutor): HoldersRepository {
  return {
    async find(issuer_id: UUID, kind: HolderKind): Promise<HoldersEnvelope | null> {
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
      const latest = rows[0]!;
      return freezeInsiderHoldersEnvelope({
        subject: { kind: "issuer", id: issuer_id },
        currency: "USD",
        holders,
        as_of: latest.filed_at instanceof Date ? latest.filed_at.toISOString() : new Date(latest.filed_at).toISOString(),
        source_id: latest.source_id as UUID,
      });
    },
  };
}

import {
  freezeIssuerProfileRecord,
  type IssuerProfileExchange,
  type IssuerProfileRecord,
  type IssuerProfileRecordInput,
} from "./profile.ts";
import type { UUID } from "./subject-ref.ts";

export type { IssuerProfileRecord };

export type IssuerProfileRepository = {
  find(issuer_id: UUID): Promise<IssuerProfileRecord | null>;
};

export type IssuerProfileQueryExecutor = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[] }>;
};

export function createInMemoryIssuerProfileRepository(
  records: ReadonlyArray<IssuerProfileRecordInput>,
): IssuerProfileRepository {
  // Validate + freeze each record once so the per-request hot path can spread
  // them into envelopes without re-running asserts or rebuilding nested arrays.
  const byId = new Map<UUID, IssuerProfileRecord>();
  for (const input of records) {
    const frozen = freezeIssuerProfileRecord(input);
    byId.set(frozen.subject.id, frozen);
  }
  return {
    async find(issuer_id: UUID): Promise<IssuerProfileRecord | null> {
      return byId.get(issuer_id) ?? null;
    },
  };
}

type IssuerRow = {
  issuer_id: string;
  legal_name: string;
  former_names: unknown;
  cik: string | null;
  lei: string | null;
  domicile: string | null;
  sector: string | null;
  industry: string | null;
};

type ListingRow = {
  listing_id: string;
  mic: string;
  ticker: string;
  trading_currency: string;
  timezone: string;
};

export function createPostgresIssuerProfileRepository(
  db: IssuerProfileQueryExecutor,
): IssuerProfileRepository {
  return {
    async find(issuer_id: UUID): Promise<IssuerProfileRecord | null> {
      const issuer = await db.query<IssuerRow>(
        `select issuer_id::text as issuer_id,
                legal_name,
                former_names,
                cik,
                lei,
                domicile,
                sector,
                industry
           from issuers
          where issuer_id = $1`,
        [issuer_id],
      );
      const row = issuer.rows[0];
      if (!row) return null;

      const listings = await db.query<ListingRow>(
        `select l.listing_id::text as listing_id,
                l.mic,
                l.ticker,
                l.trading_currency,
                l.timezone
           from listings l
           join instruments i on i.instrument_id = l.instrument_id
          where i.issuer_id = $1
            and l.active_to is null
          order by l.active_from nulls first, l.mic, l.ticker, l.listing_id`,
        [issuer_id],
      );

      return freezeIssuerProfileRecord({
        subject: { kind: "issuer", id: row.issuer_id },
        legal_name: row.legal_name,
        former_names: formerNames(row.former_names),
        ...optionalStringFields(row),
        exchanges: listings.rows.map(exchangeFromRow),
      });
    },
  };
}

function exchangeFromRow(row: ListingRow): IssuerProfileExchange {
  return {
    listing: { kind: "listing", id: row.listing_id },
    mic: row.mic,
    ticker: row.ticker,
    trading_currency: row.trading_currency,
    timezone: row.timezone,
  };
}

function formerNames(value: unknown): ReadonlyArray<string> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function optionalStringFields(row: IssuerRow): Partial<IssuerProfileRecordInput> {
  const out: Partial<IssuerProfileRecordInput> = {};
  for (const field of ["cik", "lei", "domicile", "sector", "industry"] as const) {
    const value = row[field];
    if (typeof value === "string" && value.length > 0) {
      out[field] = value;
    }
  }
  return out;
}

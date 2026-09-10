import type { TickerDiscoveryProvider } from "../../../resolver/src/discovery.ts";
import { upsertDiscoveredListing } from "../../../resolver/src/discovery.ts";
import type { IdentityProvider, OperationRunner } from "../ports.ts";
import type { CompanyIdentity } from "../types.ts";

export const SUPPORTED_LISTING_POLICY_VERSION = "us-listed-v1";
export const SUPPORTED_US_MICS = Object.freeze(["XNYS", "XNAS", "XASE", "ARCX", "BATS", "IEXG"] as const);

export type CanonicalIdentityRecord = Omit<CompanyIdentity, "asset_type"> & {
  asset_type: "common_stock" | "adr" | "etf";
  active: boolean;
  domicile?: string | null;
};
type EligibleIdentityRecord = Omit<CanonicalIdentityRecord, "asset_type"> & { asset_type: CompanyIdentity["asset_type"] };

export type CanonicalIdentityLookup = {
  findCached(input: { query: string; hit_ids: readonly string[] }): Promise<readonly CanonicalIdentityRecord[]>;
  discover(input: { query: string; hit_ids: readonly string[] }): Promise<readonly CanonicalIdentityRecord[]>;
};

export type CanonicalIdentityProviderOptions = { lookup: CanonicalIdentityLookup };

type QueryExecutor = Parameters<typeof upsertDiscoveredListing>[0];

type IdentityRow = {
  issuer_id: string; listing_id: string; legal_name: string; ticker: string; mic: string; currency: string;
  asset_type: "common_stock" | "adr" | "etf"; domicile: string | null; source_ids: string[] | null;
};

export function createCanonicalIdentityProvider(options: CanonicalIdentityProviderOptions): IdentityProvider {
  return Object.freeze({
    async resolve(input, operations) {
      const cached = eligible(await options.lookup.findCached(input));
      if (cached.length > 0) return resolution(cached);
      if (!tickerHint(input.query)) return { status: "unresolved" as const, reason: "no eligible active US listing" };
      const discovered = await operations.run({
        key: input.operation_key,
        request_hash: input.request_hash,
        resource: "identity",
        phase: input.phase,
        candidate_id: input.candidate_id,
        execute: () => options.lookup.discover(input),
      });
      return resolution(eligible(discovered));
    },
  });
}

export function createResolverIdentityLookup(options: {
  db: QueryExecutor;
  tickerProvider: TickerDiscoveryProvider;
}): CanonicalIdentityLookup {
  return Object.freeze({
    async findCached(input) {
      return loadCanonicalRecords(options.db, input.query);
    },
    async discover(input) {
      const ticker = tickerHint(input.query);
      if (!ticker) return [];
      const listings = await options.tickerProvider.discoverTicker(ticker);
      const records: CanonicalIdentityRecord[] = [];
      for (const listing of listings) {
        const ref = await upsertDiscoveredListing(options.db, listing);
        const canonical = await loadCanonicalRecords(options.db, ref.id);
        const sourceIds = listing.source_provenance?.map((source) => source.source_id) ?? [];
        records.push(...canonical.map((record) => Object.freeze({ ...record, identity_source_ids: sourceIds })));
      }
      return Object.freeze(records);
    },
  });
}

async function loadCanonicalRecords(db: QueryExecutor, query: string): Promise<readonly CanonicalIdentityRecord[]> {
  const { rows } = await db.query<IdentityRow>(
    `select i.issuer_id::text as issuer_id,
            l.listing_id::text as listing_id,
            i.legal_name,
            l.ticker,
            l.mic,
            l.trading_currency as currency,
            n.asset_type,
            i.domicile,
            array[]::text[] as source_ids
       from listings l
       join instruments n on n.instrument_id = l.instrument_id
       join issuers i on i.issuer_id = n.issuer_id
      where l.active_to is null
        and (l.listing_id::text = $1 or upper(l.ticker) = upper($1) or lower(i.legal_name) = lower($1))
      order by l.mic, l.ticker, l.listing_id`,
    [query],
  );
  return Object.freeze(rows.map((row) => Object.freeze({
    issuer_id: row.issuer_id,
    listing_id: row.listing_id,
    legal_name: row.legal_name,
    ticker: row.ticker,
    mic: row.mic,
    currency: row.currency,
    asset_type: row.asset_type,
    identity_source_ids: row.source_ids ?? [],
    active: true,
    domicile: row.domicile,
  })));
}

function eligible(records: readonly CanonicalIdentityRecord[]): EligibleIdentityRecord[] {
  const seen = new Set<string>();
  return records.filter((record): record is EligibleIdentityRecord => {
    const key = `${record.issuer_id}/${record.listing_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return record.active && SUPPORTED_US_MICS.includes(record.mic as typeof SUPPORTED_US_MICS[number]) &&
      (record.asset_type === "common_stock" || record.asset_type === "adr");
  });
}

function resolution(records: readonly EligibleIdentityRecord[]) {
  if (records.length === 1) {
    const { active: _active, domicile: _domicile, ...identity } = records[0]!;
    return { status: "resolved" as const, identity: Object.freeze(identity) };
  }
  if (records.length > 1) return { status: "unresolved" as const, reason: "ambiguous eligible listing" };
  return { status: "unresolved" as const, reason: "no eligible active US listing" };
}

function tickerHint(query: string): string | null {
  const normalized = query.trim().toUpperCase();
  return /^[A-Z]{1,10}$/u.test(normalized) ? normalized : null;
}

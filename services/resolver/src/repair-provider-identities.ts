import { Pool } from "pg";
import {
  createPolygonTickerDiscoveryProvider,
  upsertDiscoveredListing,
  type DiscoveredListing,
} from "./discovery.ts";

type LegacyIdentity = {
  ticker: string;
  mic: string;
  issuerId: string;
  instrumentId: string;
  listingId: string;
};

const LEGACY_IDENTITIES: ReadonlyArray<LegacyIdentity> = Object.freeze([
  {
    ticker: "AAPL",
    mic: "XNAS",
    issuerId: "11111111-1111-4111-9111-111111111111",
    instrumentId: "11111111-1111-4111-b111-111111111111",
    listingId: "11111111-1111-4111-a111-111111111111",
  },
  {
    ticker: "MSFT",
    mic: "XNAS",
    issuerId: "22222222-2222-4222-9222-222222222222",
    instrumentId: "22222222-2222-4222-b222-222222222222",
    listingId: "22222222-2222-4222-a222-222222222222",
  },
  {
    ticker: "GOOGL",
    mic: "XNAS",
    issuerId: "33333333-3333-4333-9333-333333333333",
    instrumentId: "33333333-3333-4333-b333-333333333333",
    listingId: "33333333-3333-4333-a333-333333333333",
  },
  {
    ticker: "TSLA",
    mic: "XNAS",
    issuerId: "44444444-4444-4444-9444-444444444444",
    instrumentId: "44444444-4444-4444-b444-444444444444",
    listingId: "44444444-4444-4444-a444-444444444444",
  },
  {
    ticker: "NVDA",
    mic: "XNAS",
    issuerId: "55555555-5555-4555-9555-555555555555",
    instrumentId: "55555555-5555-4555-b555-555555555555",
    listingId: "55555555-5555-4555-a555-555555555555",
  },
]);

type QueryExecutor = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[]; rowCount?: number | null }>;
};

type TransactionClient = QueryExecutor & {
  release(): void;
};

type TransactionalExecutor = QueryExecutor & {
  connect(): Promise<TransactionClient>;
};

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for provider identity repair");
}

const discovery = createPolygonTickerDiscoveryProvider({
  apiKey: process.env.POLYGON_API_KEY,
  baseUrl: process.env.RESOLVER_POLYGON_REFERENCE_BASE_URL,
});
const hasPolygonKey = (process.env.POLYGON_API_KEY ?? "").trim().length > 0;
const pool = new Pool({ connectionString: databaseUrl });

try {
  await repairLegacyIdentities(pool);
  await hydrateConfiguredTickers(pool);
} finally {
  await pool.end();
}

async function repairLegacyIdentities(db: TransactionalExecutor): Promise<void> {
  for (const legacy of LEGACY_IDENTITIES) {
    const exists = await legacyExists(db, legacy);
    if (!exists) continue;

    const referenceCount = await countLegacyReferences(db, legacy);
    if (!hasPolygonKey) {
      if (referenceCount > 0) {
        throw new Error(
          `Legacy seeded identity ${legacy.ticker} (${legacy.listingId}) is still referenced. Set POLYGON_API_KEY so startup can rediscover and remap it, or remove those references before starting dev.`,
        );
      }
      await withTransaction(db, async (tx) => {
        if (!(await legacyExists(tx, legacy))) return;
        const txReferenceCount = await countLegacyReferences(tx, legacy);
        if (txReferenceCount > 0) {
          throw new Error(
            `Legacy seeded identity ${legacy.ticker} (${legacy.listingId}) became referenced during repair. Set POLYGON_API_KEY and restart dev.`,
          );
        }
        await deleteLegacyIdentity(tx, legacy);
      });
      console.log(`removed unreferenced legacy seeded identity ${legacy.ticker}`);
      continue;
    }

    const listing = await discoverPreferredListing(legacy.ticker, legacy.mic);
    if (!listing) {
      throw new Error(
        `Polygon did not return a supported active ${legacy.ticker} ${legacy.mic} listing; cannot safely replace legacy seeded identity ${legacy.listingId}.`,
      );
    }

    const replacement = await withTransaction(db, async (tx) => {
      if (!(await legacyExists(tx, legacy))) return null;
      await retireLegacyListing(tx, legacy);
      const newRef = await upsertDiscoveredListing(tx, listing);
      const loaded = await loadListingChain(tx, newRef.id);
      if (!loaded) {
        throw new Error(`provider repair inserted ${legacy.ticker} but could not reload listing ${newRef.id}`);
      }

      await remapSubjectReferences(tx, "issuer", legacy.issuerId, loaded.issuerId);
      await remapSubjectReferences(tx, "instrument", legacy.instrumentId, loaded.instrumentId);
      await remapSubjectReferences(tx, "listing", legacy.listingId, loaded.listingId);
      await deleteLegacyIdentity(tx, legacy);
      return loaded;
    });
    if (replacement) {
      console.log(`replaced legacy seeded identity ${legacy.ticker} with provider listing ${replacement.listingId}`);
    }
  }
}

async function withTransaction<T>(
  db: TransactionalExecutor,
  fn: (tx: QueryExecutor) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function hydrateConfiguredTickers(db: QueryExecutor): Promise<void> {
  if (!hasPolygonKey) return;

  const tickers = configuredTickers();
  for (const ticker of tickers) {
    try {
      const rows = await discovery.discoverTicker(ticker);
      for (const row of rows) {
        await upsertDiscoveredListing(db, row);
      }
      if (rows.length > 0) {
        console.log(`hydrated ${ticker} provider identity (${rows.length} listing row(s))`);
      }
    } catch (error) {
      console.warn(`could not hydrate configured ticker ${ticker}: ${errorMessage(error)}`);
    }
  }
}

function configuredTickers(): ReadonlyArray<string> {
  const raw = process.env.HOME_PULSE_TICKERS ?? "AAPL,MSFT,GOOGL";
  return Object.freeze(
    Array.from(new Set(
      raw
        .split(",")
        .map((ticker) => ticker.trim().toUpperCase())
        .filter(Boolean),
    )),
  );
}

async function legacyExists(db: QueryExecutor, legacy: LegacyIdentity): Promise<boolean> {
  const result = await db.query<{ exists: boolean }>(
    `select exists (
       select 1
         from listings l
         join instruments i on i.instrument_id = l.instrument_id
         join issuers iss on iss.issuer_id = i.issuer_id
        where l.listing_id = $1
          and i.instrument_id = $2
          and iss.issuer_id = $3
     ) as exists`,
    [legacy.listingId, legacy.instrumentId, legacy.issuerId],
  );
  return result.rows[0]?.exists === true;
}

async function countLegacyReferences(db: QueryExecutor, legacy: LegacyIdentity): Promise<number> {
  const refs = await Promise.all([
    countSubjectReferences(db, "issuer", legacy.issuerId),
    countSubjectReferences(db, "instrument", legacy.instrumentId),
    countSubjectReferences(db, "listing", legacy.listingId),
  ]);
  return refs.reduce((sum, value) => sum + value, 0);
}

async function countSubjectReferences(
  db: QueryExecutor,
  kind: "issuer" | "instrument" | "listing",
  id: string,
): Promise<number> {
  const result = await db.query<{ count: string }>(
    `select (
       (select count(*) from watchlist_members where subject_kind = $1::subject_kind and subject_id = $2::uuid) +
       (select count(*) from portfolio_holdings where subject_kind = $1::subject_kind and subject_id = $2::uuid) +
       (select count(*) from theme_memberships where subject_kind = $1::subject_kind and subject_id = $2::uuid) +
       (select count(*) from mentions where subject_kind = $1::subject_kind and subject_id = $2::uuid) +
       (select count(*) from claim_arguments where subject_kind = $1::subject_kind and subject_id = $2::uuid) +
       (select count(*) from entity_impacts where subject_kind = $1::subject_kind and subject_id = $2::uuid) +
       (select count(*) from event_subjects where subject_kind = $1::subject_kind and subject_id = $2::uuid) +
       (select count(*) from facts where subject_kind = $1::subject_kind and subject_id = $2::uuid) +
       (select count(*) from chat_threads where primary_subject_kind = $1::subject_kind and primary_subject_id = $2::uuid)
     )::text as count`,
    [kind, id],
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function retireLegacyListing(db: QueryExecutor, legacy: LegacyIdentity): Promise<void> {
  await db.query(
    `update listings
        set active_from = coalesce(active_from, '1900-01-01T00:00:00Z'::timestamptz),
            active_to = coalesce(active_to, now()),
            updated_at = now()
      where listing_id = $1`,
    [legacy.listingId],
  );
}

async function discoverPreferredListing(
  ticker: string,
  mic: string,
): Promise<DiscoveredListing | null> {
  const rows = await discovery.discoverTicker(ticker);
  return rows.find((row) => row.mic === mic) ?? rows[0] ?? null;
}

async function loadListingChain(
  db: QueryExecutor,
  listingId: string,
): Promise<{ issuerId: string; instrumentId: string; listingId: string } | null> {
  const result = await db.query<{ issuer_id: string; instrument_id: string; listing_id: string }>(
    `select iss.issuer_id::text as issuer_id,
            i.instrument_id::text as instrument_id,
            l.listing_id::text as listing_id
       from listings l
       join instruments i on i.instrument_id = l.instrument_id
       join issuers iss on iss.issuer_id = i.issuer_id
      where l.listing_id = $1`,
    [listingId],
  );
  const row = result.rows[0];
  return row ? { issuerId: row.issuer_id, instrumentId: row.instrument_id, listingId: row.listing_id } : null;
}

async function remapSubjectReferences(
  db: QueryExecutor,
  kind: "issuer" | "instrument" | "listing",
  oldId: string,
  newId: string,
): Promise<void> {
  if (oldId === newId) return;

  await deleteDuplicateSubjectRows(db, kind, oldId, newId);
  await db.query(`update watchlist_members set subject_id = $3 where subject_kind = $1::subject_kind and subject_id = $2`, [kind, oldId, newId]);
  await db.query(`update portfolio_holdings set subject_id = $3 where subject_kind = $1::subject_kind and subject_id = $2`, [kind, oldId, newId]);
  await db.query(`update theme_memberships set subject_id = $3 where subject_kind = $1::subject_kind and subject_id = $2`, [kind, oldId, newId]);
  await db.query(`update mentions set subject_id = $3 where subject_kind = $1::subject_kind and subject_id = $2`, [kind, oldId, newId]);
  await db.query(`update claim_arguments set subject_id = $3 where subject_kind = $1::subject_kind and subject_id = $2`, [kind, oldId, newId]);
  await db.query(`update entity_impacts set subject_id = $3 where subject_kind = $1::subject_kind and subject_id = $2`, [kind, oldId, newId]);
  await db.query(`update event_subjects set subject_id = $3 where subject_kind = $1::subject_kind and subject_id = $2`, [kind, oldId, newId]);
  await db.query(`update facts set subject_id = $3, updated_at = now() where subject_kind = $1::subject_kind and subject_id = $2`, [kind, oldId, newId]);
  await db.query(
    `update chat_threads
        set primary_subject_id = $3,
            updated_at = now()
      where primary_subject_kind = $1::subject_kind
        and primary_subject_id = $2`,
    [kind, oldId, newId],
  );
}

async function deleteDuplicateSubjectRows(
  db: QueryExecutor,
  kind: "issuer" | "instrument" | "listing",
  oldId: string,
  newId: string,
): Promise<void> {
  await db.query(
    `delete from watchlist_members old
      using watchlist_members existing
      where old.subject_kind = $1::subject_kind
        and old.subject_id = $2
        and existing.watchlist_id = old.watchlist_id
        and existing.subject_kind = $1::subject_kind
        and existing.subject_id = $3`,
    [kind, oldId, newId],
  );
  await db.query(
    `delete from theme_memberships old
      using theme_memberships existing
      where old.subject_kind = $1::subject_kind
        and old.subject_id = $2
        and existing.theme_id = old.theme_id
        and existing.subject_kind = $1::subject_kind
        and existing.subject_id = $3`,
    [kind, oldId, newId],
  );
  await db.query(
    `delete from mentions old
      using mentions existing
      where old.subject_kind = $1::subject_kind
        and old.subject_id = $2
        and existing.document_id = old.document_id
        and existing.prominence = old.prominence
        and existing.subject_kind = $1::subject_kind
        and existing.subject_id = $3`,
    [kind, oldId, newId],
  );
}

async function deleteLegacyIdentity(db: QueryExecutor, legacy: LegacyIdentity): Promise<void> {
  await db.query(`delete from listings where listing_id = $1`, [legacy.listingId]);
  await db.query(
    `delete from instruments i
      where i.instrument_id = $1
        and not exists (select 1 from listings l where l.instrument_id = i.instrument_id)`,
    [legacy.instrumentId],
  );
  await db.query(
    `delete from issuers iss
      where iss.issuer_id = $1
        and not exists (select 1 from instruments i where i.issuer_id = iss.issuer_id)`,
    [legacy.issuerId],
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

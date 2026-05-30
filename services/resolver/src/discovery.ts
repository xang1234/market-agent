import type { QueryResult } from "pg";
import type { SubjectRef } from "./subject-ref.ts";
import type { UUID } from "./subject-ref.ts";
import { normalizeCik } from "./normalize.ts";

export type DiscoveryAssetType = "common_stock" | "adr" | "etf";

export type DiscoverySourceProvenance = {
  provider: string;
  source_id: UUID;
  fields: string[];
};

export type DiscoveredListing = {
  ticker: string;
  legal_name: string;
  market: "stocks";
  active: true;
  mic: string;
  trading_currency: string;
  timezone: string;
  asset_type: DiscoveryAssetType;
  share_class?: string;
  cik?: string;
  lei?: string;
  domicile?: string;
  isin?: string;
  figi_composite?: string;
  source_provenance?: DiscoverySourceProvenance[];
};

export type TickerDiscoveryProvider = {
  discoverTicker(ticker: string): Promise<DiscoveredListing[]>;
};

export type PolygonReferenceFetcher = (path: string) => Promise<unknown>;

export type PolygonTickerDiscoveryProviderOptions = {
  apiKey?: string | null;
  baseUrl?: string;
  fetcher?: PolygonReferenceFetcher;
};

type QueryExecutor = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
};

type PolygonTickerPayload = {
  results?: unknown[];
};

type PolygonTickerRow = {
  ticker?: unknown;
  name?: unknown;
  market?: unknown;
  active?: unknown;
  primary_exchange?: unknown;
  currency_symbol?: unknown;
  currency_name?: unknown;
  type?: unknown;
  cik?: unknown;
  composite_figi?: unknown;
  share_class_figi?: unknown;
};

const DEFAULT_POLYGON_REFERENCE_BASE_URL = "https://api.polygon.io";

const MIC_TIMEZONES: Record<string, string> = {
  ARCX: "America/New_York",
  BATS: "America/New_York",
  IEXG: "America/New_York",
  OTCM: "America/New_York",
  XASE: "America/New_York",
  XNAS: "America/New_York",
  XNYS: "America/New_York",
  XTSX: "America/Toronto",
  XTSE: "America/Toronto",
  XLON: "Europe/London",
  XFRA: "Europe/Berlin",
  XETR: "Europe/Berlin",
  XAMS: "Europe/Amsterdam",
  XPAR: "Europe/Paris",
  XMIL: "Europe/Rome",
  XSWX: "Europe/Zurich",
  XHKG: "Asia/Hong_Kong",
  XTKS: "Asia/Tokyo",
  XASX: "Australia/Sydney",
};

const CURRENCY_NAMES: Record<string, string> = {
  usd: "USD",
  "us dollar": "USD",
  "united states dollar": "USD",
  cad: "CAD",
  "canadian dollar": "CAD",
  gbp: "GBP",
  "pound sterling": "GBP",
  eur: "EUR",
  euro: "EUR",
  hkd: "HKD",
  "hong kong dollar": "HKD",
  jpy: "JPY",
  "japanese yen": "JPY",
  aud: "AUD",
  "australian dollar": "AUD",
  chf: "CHF",
  "swiss franc": "CHF",
};

const TYPE_TO_ASSET: Record<string, DiscoveryAssetType | undefined> = {
  CS: "common_stock",
  ADRC: "adr",
  ADRP: "adr",
  ADRR: "adr",
  ETF: "etf",
};

export function createPolygonTickerDiscoveryProvider(
  options: PolygonTickerDiscoveryProviderOptions,
): TickerDiscoveryProvider {
  const apiKey = options.apiKey?.trim();
  const baseUrl = options.baseUrl ?? DEFAULT_POLYGON_REFERENCE_BASE_URL;
  const fetcher = options.fetcher ?? createHttpReferenceFetcher(baseUrl);

  return {
    async discoverTicker(ticker: string): Promise<DiscoveredListing[]> {
      if (!apiKey) return [];
      const normalizedTicker = ticker.trim().toUpperCase();
      if (!normalizedTicker) return [];

      const params = new URLSearchParams();
      params.set("ticker", normalizedTicker);
      params.set("market", "stocks");
      params.set("active", "true");
      params.set("limit", "1000");
      params.set("apiKey", apiKey);

      const payload = (await fetcher(`/v3/reference/tickers?${params.toString()}`)) as PolygonTickerPayload;
      const rows = Array.isArray(payload.results) ? payload.results : [];
      return rows.flatMap((row) => {
        const discovered = discoveredListingFromPolygonRow(row, normalizedTicker);
        return discovered ? [discovered] : [];
      });
    },
  };
}

export async function upsertDiscoveredListing(
  db: QueryExecutor,
  listing: DiscoveredListing,
): Promise<SubjectRef & { kind: "listing" }> {
  const instrumentIdentity = instrumentIdentityFromListing(listing);
  const matchedInstrument = await findInstrumentByIdentity(db, instrumentIdentity);
  if (matchedInstrument) {
    await fillIssuerIdentityFields(db, matchedInstrument.issuer_id, issuerIdentityFromListing(listing));
    await fillInstrumentIdentityFields(db, matchedInstrument.instrument_id, instrumentIdentity);
    const listingId = await upsertListing(db, matchedInstrument.instrument_id, listing);
    return { kind: "listing", id: listingId };
  }

  const issuerId = await upsertIssuer(db, listing);
  const instrumentId = await upsertInstrument(db, issuerId, listing, instrumentIdentity);
  const listingId = await upsertListing(db, instrumentId, listing);
  return { kind: "listing", id: listingId };
}

function discoveredListingFromPolygonRow(
  value: unknown,
  requestedTicker: string,
): DiscoveredListing | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as PolygonTickerRow;

  const ticker = stringValue(row.ticker)?.toUpperCase();
  const legalName = stringValue(row.name);
  const market = stringValue(row.market)?.toLowerCase();
  const active = row.active;
  const mic = stringValue(row.primary_exchange)?.toUpperCase();
  const timezone = mic ? MIC_TIMEZONES[mic] : undefined;
  const tradingCurrency = normalizeCurrency(row.currency_symbol) ?? normalizeCurrency(row.currency_name);
  const assetType = mapPolygonTickerType(row.type);
  const cik = stringValue(row.cik);

  if (!ticker || ticker !== requestedTicker) return null;
  if (!legalName || market !== "stocks" || active !== true) return null;
  if (!mic || !timezone || !tradingCurrency || !assetType) return null;

  return {
    ticker,
    legal_name: legalName,
    market: "stocks",
    active: true,
    mic,
    trading_currency: tradingCurrency,
    timezone,
    asset_type: assetType,
    ...(cik ? { cik: normalizeCik(cik) } : {}),
    ...(stringValue(row.composite_figi) ? { figi_composite: stringValue(row.composite_figi)! } : {}),
  };
}

type IssuerIdentityFields = { cik?: string; lei?: string; domicile?: string };
type InstrumentIdentityFields = { isin?: string; figiComposite?: string };
type InstrumentIdentityMatch = { instrument_id: string; issuer_id: string };

function issuerIdentityFromListing(listing: DiscoveredListing): IssuerIdentityFields {
  return {
    cik: listing.cik ? normalizeCik(listing.cik) : undefined,
    lei: listing.lei ? normalizeLei(listing.lei) : undefined,
    domicile: listing.domicile ? listing.domicile.trim().toUpperCase() : undefined,
  };
}

function instrumentIdentityFromListing(listing: DiscoveredListing): InstrumentIdentityFields {
  return {
    isin: listing.isin ? normalizeIsin(listing.isin) : undefined,
    figiComposite: listing.figi_composite?.trim() || undefined,
  };
}

async function upsertIssuer(db: QueryExecutor, listing: DiscoveredListing): Promise<string> {
  const { cik, lei, domicile } = issuerIdentityFromListing(listing);
  const byCik = cik
    ? await db.query<{ issuer_id: string }>("select issuer_id from issuers where cik = $1", [cik])
    : { rows: [] };
  if (byCik.rows[0]) {
    await fillIssuerIdentityFields(db, byCik.rows[0].issuer_id, { cik, lei, domicile });
    return byCik.rows[0].issuer_id;
  }

  const byLei = lei
    ? await db.query<{ issuer_id: string }>("select issuer_id from issuers where upper(lei) = $1", [lei])
    : { rows: [] };
  if (byLei.rows[0]) {
    await fillIssuerIdentityFields(db, byLei.rows[0].issuer_id, { cik, lei, domicile });
    return byLei.rows[0].issuer_id;
  }

  const byExactName = await findUniqueIssuerByLegalName(db, listing.legal_name);
  if (byExactName) {
    await fillIssuerIdentityFields(db, byExactName, { cik, lei, domicile });
    return byExactName;
  }

  const inserted = await db.query<{ issuer_id: string }>(
    `insert into issuers (legal_name, cik, lei, domicile)
     values ($1, $2, $3, $4)
     returning issuer_id`,
    [listing.legal_name, cik ?? null, lei ?? null, domicile ?? null],
  );
  return inserted.rows[0].issuer_id;
}

async function findUniqueIssuerByLegalName(db: QueryExecutor, legalName: string): Promise<string | null> {
  const byName = await db.query<{ issuer_id: string }>(
    "select issuer_id from issuers where legal_name = $1 order by created_at asc, issuer_id asc limit 2",
    [legalName],
  );
  return byName.rows.length === 1 ? byName.rows[0].issuer_id : null;
}

async function fillIssuerIdentityFields(
  db: QueryExecutor,
  issuerId: string,
  values: IssuerIdentityFields,
): Promise<void> {
  if (!values.cik && !values.lei && !values.domicile) return;
  await db.query(
    `update issuers
        set cik = coalesce(cik, $2),
            lei = coalesce(lei, $3),
            domicile = coalesce(domicile, $4),
            updated_at = now()
      where issuer_id = $1`,
    [issuerId, values.cik ?? null, values.lei ?? null, values.domicile ?? null],
  );
}

async function findInstrumentByIdentity(
  db: QueryExecutor,
  values: InstrumentIdentityFields,
): Promise<InstrumentIdentityMatch | null> {
  if (values.isin) {
    const byIsin = await db.query<InstrumentIdentityMatch>(
      "select instrument_id, issuer_id from instruments where isin = $1",
      [values.isin],
    );
    if (byIsin.rows[0]) return byIsin.rows[0];
  }

  if (values.figiComposite) {
    const byFigi = await db.query<InstrumentIdentityMatch>(
      "select instrument_id, issuer_id from instruments where figi_composite = $1",
      [values.figiComposite],
    );
    if (byFigi.rows[0]) return byFigi.rows[0];
  }

  return null;
}

async function upsertInstrument(
  db: QueryExecutor,
  issuerId: string,
  listing: DiscoveredListing,
  values: InstrumentIdentityFields = instrumentIdentityFromListing(listing),
): Promise<string> {
  const byShape = await db.query<{ instrument_id: string }>(
    `select instrument_id
       from instruments
      where issuer_id = $1
        and asset_type = $2::asset_type
        and share_class is not distinct from $3::text
      order by created_at asc, instrument_id asc
      limit 1`,
    [issuerId, listing.asset_type, listing.share_class ?? null],
  );
  if (byShape.rows[0]) {
    await fillInstrumentIdentityFields(db, byShape.rows[0].instrument_id, values);
    return byShape.rows[0].instrument_id;
  }

  const inserted = await db.query<{ instrument_id: string }>(
    `insert into instruments (issuer_id, asset_type, share_class, isin, figi_composite)
     values ($1, $2::asset_type, $3, $4, $5)
     returning instrument_id`,
    [issuerId, listing.asset_type, listing.share_class ?? null, values.isin ?? null, values.figiComposite ?? null],
  );
  return inserted.rows[0].instrument_id;
}

async function fillInstrumentIdentityFields(
  db: QueryExecutor,
  instrumentId: string,
  values: InstrumentIdentityFields,
): Promise<void> {
  if (!values.isin && !values.figiComposite) return;
  await db.query(
    `update instruments
        set isin = case
              when isin is null
               and $2::text is not null
               and not exists (
                 select 1 from instruments other
                  where other.isin = $2 and other.instrument_id <> instruments.instrument_id
               )
              then $2
              else isin
            end,
            figi_composite = case
              when figi_composite is null
               and $3::text is not null
               and not exists (
                 select 1 from instruments other
                  where other.figi_composite = $3
                    and other.instrument_id <> instruments.instrument_id
               )
              then $3
              else figi_composite
            end,
            updated_at = now()
      where instrument_id = $1`,
    [instrumentId, values.isin ?? null, values.figiComposite ?? null],
  );
}

async function upsertListing(
  db: QueryExecutor,
  instrumentId: string,
  listing: DiscoveredListing,
): Promise<string> {
  const existing = await db.query<{ listing_id: string }>(
    `select listing_id
       from listings
      where mic = $1 and ticker = $2 and active_from is null
      limit 1`,
    [listing.mic, listing.ticker],
  );

  if (existing.rows[0]) {
    await db.query(
      `update listings
          set instrument_id = $2,
              trading_currency = $3,
              timezone = $4,
              updated_at = now()
        where listing_id = $1`,
      [existing.rows[0].listing_id, instrumentId, listing.trading_currency, listing.timezone],
    );
    return existing.rows[0].listing_id;
  }

  const inserted = await db.query<{ listing_id: string }>(
    `insert into listings (instrument_id, mic, ticker, trading_currency, timezone, active_from)
     values ($1, $2, $3, $4, $5, null)
     returning listing_id`,
    [instrumentId, listing.mic, listing.ticker, listing.trading_currency, listing.timezone],
  );
  return inserted.rows[0].listing_id;
}

function mapPolygonTickerType(value: unknown): DiscoveryAssetType | null {
  const type = stringValue(value)?.toUpperCase();
  return type ? TYPE_TO_ASSET[type] ?? null : null;
}

function normalizeCurrency(value: unknown): string | null {
  const raw = stringValue(value);
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^[A-Za-z]{3}$/.test(trimmed)) return trimmed.toUpperCase();
  return CURRENCY_NAMES[trimmed.toLowerCase()] ?? null;
}

function normalizeIsin(value: string): string {
  return value.trim().toUpperCase();
}

function normalizeLei(value: string): string {
  return value.trim().toUpperCase();
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function createHttpReferenceFetcher(baseUrl: string): PolygonReferenceFetcher {
  return async (path: string) => {
    const url = new URL(path, baseUrl);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`polygon reference HTTP ${response.status}`);
    }
    return response.json();
  };
}

import type {
  DiscoveredListing,
  DiscoveryAssetType,
  DiscoverySourceProvenance,
  TickerDiscoveryProvider,
} from "./discovery.ts";
import {
  GLEIF_REFERENCE_PROVIDER,
  GLEIF_REFERENCE_SOURCE_ID,
  NASDAQ_TRADER_REFERENCE_PROVIDER,
  NASDAQ_TRADER_REFERENCE_SOURCE_ID,
  OPENFIGI_REFERENCE_PROVIDER,
  OPENFIGI_REFERENCE_SOURCE_ID,
  type OpenReferenceProviderConfig,
} from "./provider-sources.ts";

type FetchImpl = typeof fetch;

export type OpenReferenceTickerDiscoveryProviderOptions = OpenReferenceProviderConfig & {
  fetchImpl?: FetchImpl;
  timeoutMs?: number;
};

type NasdaqSecurityDirectoryRow = {
  "Symbol"?: string;
  "Security Name"?: string;
  "Test Issue"?: string;
  "ETF"?: string;
};

type NasdaqOtherListedRow = {
  "ACT Symbol"?: string;
  "Security Name"?: string;
  "Exchange"?: string;
  "Test Issue"?: string;
  "ETF"?: string;
};

type OpenFigiMappingResponse = Array<{
  data?: unknown[];
  error?: unknown;
  warning?: unknown;
}>;

type OpenFigiInstrument = {
  ticker?: unknown;
  micCode?: unknown;
  exchCode?: unknown;
  marketSector?: unknown;
  securityType?: unknown;
  securityType2?: unknown;
  compositeFIGI?: unknown;
  isin?: unknown;
  idValue?: unknown;
};

type GleifLeiRecordsResponse = {
  data?: unknown[];
  links?: unknown;
  meta?: unknown;
};

type GleifLeiRecord = {
  id?: unknown;
  attributes?: {
    lei?: unknown;
    entity?: {
      legalName?: { name?: unknown } | unknown;
      legalAddress?: { country?: unknown } | unknown;
    };
    registration?: {
      status?: unknown;
    };
  };
};

type FigiEnrichment = {
  figi_composite?: string;
  isin?: string;
};

type LeiEnrichment = {
  lei: string;
  domicile?: string;
};

const DEFAULT_TIMEOUT_MS = 5_000;
const GLEIF_PAGE_SIZE = 5;
const NASDAQ_US_TIMEZONE = "America/New_York";
const NASDAQ_US_CURRENCY = "USD";
const OPENFIGI_US_EXCH_CODE = "US";

const NASDAQ_LISTED_PATH = "/dynamic/symdir/nasdaqlisted.txt";
const NASDAQ_OTHER_LISTED_PATH = "/dynamic/symdir/otherlisted.txt";

const OTHER_LISTED_EXCHANGE_TO_MIC: Record<string, string | undefined> = {
  A: "XASE",
  N: "XNYS",
  P: "ARCX",
  V: "IEXG",
  Z: "BATS",
};

const NASDAQ_BASE_PROVENANCE: DiscoverySourceProvenance = Object.freeze({
  provider: NASDAQ_TRADER_REFERENCE_PROVIDER,
  source_id: NASDAQ_TRADER_REFERENCE_SOURCE_ID,
  fields: ["ticker", "legal_name", "mic", "trading_currency", "timezone", "asset_type"],
});

export function createOpenReferenceTickerDiscoveryProvider(
  options: OpenReferenceTickerDiscoveryProviderOptions,
): TickerDiscoveryProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async discoverTicker(ticker: string): Promise<DiscoveredListing[]> {
      if (!options.nasdaqTrader.enabled) return [];
      const normalizedTicker = ticker.trim().toUpperCase();
      if (!normalizedTicker) return [];

      const listings = await fetchNasdaqListings(
        options.nasdaqTrader.baseUrl,
        normalizedTicker,
        fetchImpl,
        timeoutMs,
      );
      return Promise.all(listings.map(async (listing) => {
        const [figi, lei] = await Promise.all([
          options.openfigi.enabled
            ? fetchOpenFigiEnrichment(options.openfigi, listing, fetchImpl, timeoutMs)
            : Promise.resolve(null),
          options.gleif.enabled
            ? fetchGleifEnrichment(options.gleif.baseUrl, listing.legal_name, fetchImpl, timeoutMs)
            : Promise.resolve(null),
        ]);
        return listingWithEnrichment(listing, figi, lei);
      }));
    },
  };
}

async function fetchNasdaqListings(
  baseUrl: string,
  requestedTicker: string,
  fetchImpl: FetchImpl,
  timeoutMs: number,
): Promise<DiscoveredListing[]> {
  const [listed, otherListed] = await Promise.allSettled([
    fetchText(joinUrlPath(baseUrl, NASDAQ_LISTED_PATH), fetchImpl, timeoutMs),
    fetchText(joinUrlPath(baseUrl, NASDAQ_OTHER_LISTED_PATH), fetchImpl, timeoutMs),
  ]);
  return [
    ...(listed.status === "fulfilled" ? parseNasdaqListed(listed.value, requestedTicker) : []),
    ...(otherListed.status === "fulfilled" ? parseNasdaqOtherListed(otherListed.value, requestedTicker) : []),
  ];
}

function parseNasdaqListed(text: string, requestedTicker: string): DiscoveredListing[] {
  return parsePipeRows<NasdaqSecurityDirectoryRow>(text).flatMap((row) => {
    const ticker = stringValue(row.Symbol)?.toUpperCase();
    if (ticker !== requestedTicker || stringValue(row["Test Issue"])?.toUpperCase() === "Y") {
      return [];
    }
    const securityName = stringValue(row["Security Name"]);
    if (!securityName) return [];
    return [baseListing({
      ticker,
      legalName: cleanSecurityName(securityName),
      mic: "XNAS",
      assetType: assetTypeForSecurity(securityName, row.ETF),
    })];
  });
}

function parseNasdaqOtherListed(text: string, requestedTicker: string): DiscoveredListing[] {
  return parsePipeRows<NasdaqOtherListedRow>(text).flatMap((row) => {
    const ticker = stringValue(row["ACT Symbol"])?.toUpperCase();
    const mic = OTHER_LISTED_EXCHANGE_TO_MIC[stringValue(row.Exchange)?.toUpperCase() ?? ""];
    if (ticker !== requestedTicker || stringValue(row["Test Issue"])?.toUpperCase() === "Y" || !mic) {
      return [];
    }
    const securityName = stringValue(row["Security Name"]);
    if (!securityName) return [];
    return [baseListing({
      ticker,
      legalName: cleanSecurityName(securityName),
      mic,
      assetType: assetTypeForSecurity(securityName, row.ETF),
    })];
  });
}

function baseListing(args: {
  ticker: string;
  legalName: string;
  mic: string;
  assetType: DiscoveryAssetType;
}): DiscoveredListing {
  return {
    ticker: args.ticker,
    legal_name: args.legalName,
    market: "stocks",
    active: true,
    mic: args.mic,
    trading_currency: NASDAQ_US_CURRENCY,
    timezone: NASDAQ_US_TIMEZONE,
    asset_type: args.assetType,
    source_provenance: [cloneProvenance(NASDAQ_BASE_PROVENANCE)],
  };
}

async function fetchOpenFigiEnrichment(
  config: OpenReferenceProviderConfig["openfigi"],
  listing: DiscoveredListing,
  fetchImpl: FetchImpl,
  timeoutMs: number,
): Promise<FigiEnrichment | null> {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config.apiKey) headers["X-OPENFIGI-APIKEY"] = config.apiKey;
    const response = await fetchJson(
      joinUrlPath(config.baseUrl, "/v3/mapping"),
      fetchImpl,
      timeoutMs,
      {
        method: "POST",
        headers,
        body: JSON.stringify([{ idType: "TICKER", idValue: listing.ticker, micCode: listing.mic }]),
      },
    );
    if (!response) return null;
    if (!isOpenFigiMappingResponse(response)) return null;
    return uniqueOpenFigiEnrichment(response, listing);
  } catch {
    return null;
  }
}

function uniqueOpenFigiEnrichment(
  response: OpenFigiMappingResponse,
  listing: DiscoveredListing,
): FigiEnrichment | null {
  const candidates = response.flatMap((entry) => Array.isArray(entry.data) ? entry.data : [])
    .flatMap((entry) => openFigiCandidate(entry, listing) ?? []);
  const uniqueFigi = uniqueDefined(candidates.map((candidate) => candidate.figi_composite));
  if (uniqueFigi.length !== 1) return null;
  const uniqueIsin = uniqueDefined(candidates.map((candidate) => candidate.isin));
  return stripUndefined({
    figi_composite: uniqueFigi[0],
    isin: uniqueIsin.length === 1 ? uniqueIsin[0] : undefined,
  });
}

function openFigiCandidate(value: unknown, listing: DiscoveredListing): FigiEnrichment | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as OpenFigiInstrument;
  const ticker = stringValue(row.ticker)?.toUpperCase();
  const micCode = stringValue(row.micCode)?.toUpperCase();
  const exchCode = stringValue(row.exchCode)?.toUpperCase();
  const marketSector = stringValue(row.marketSector)?.toLowerCase();
  const securityType = `${stringValue(row.securityType) ?? ""} ${stringValue(row.securityType2) ?? ""}`;
  const figiComposite = stringValue(row.compositeFIGI);
  const isin = isinValue(row.isin) ?? isinValue(row.idValue);

  if (ticker !== listing.ticker) return null;
  if (micCode && micCode !== listing.mic) return null;
  if (!micCode && exchCode && exchCode !== OPENFIGI_US_EXCH_CODE) return null;
  if (marketSector && marketSector !== "equity") return null;
  if (!figiComposite || !openFigiSecurityMatchesAssetType(securityType, listing.asset_type)) return null;
  return stripUndefined({ figi_composite: figiComposite, isin: isin ?? undefined });
}

async function fetchGleifEnrichment(
  baseUrl: string,
  legalName: string,
  fetchImpl: FetchImpl,
  timeoutMs: number,
): Promise<LeiEnrichment | null> {
  try {
    const url = new URL(joinUrlPath(baseUrl, "/lei-records"));
    url.searchParams.set("filter[entity.legalName]", legalName);
    url.searchParams.set("filter[registration.status]", "ISSUED");
    url.searchParams.set("page[size]", String(GLEIF_PAGE_SIZE));
    const response = await fetchJson(url, fetchImpl, timeoutMs);
    if (!response) return null;
    if (!isGleifLeiRecordsResponse(response)) return null;
    if (gleifResponseMayBeTruncated(response, GLEIF_PAGE_SIZE)) return null;
    return uniqueGleifEnrichment(response, legalName);
  } catch {
    return null;
  }
}

function uniqueGleifEnrichment(
  response: GleifLeiRecordsResponse,
  legalName: string,
): LeiEnrichment | null {
  const matches = (Array.isArray(response.data) ? response.data : [])
    .flatMap((entry) => gleifCandidate(entry, legalName) ?? []);
  const uniqueLei = uniqueDefined(matches.map((match) => match.lei));
  if (uniqueLei.length !== 1) return null;
  const match = matches.find((candidate) => candidate.lei === uniqueLei[0]);
  return match ?? null;
}

function gleifCandidate(value: unknown, legalName: string): LeiEnrichment | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as GleifLeiRecord;
  const lei = stringValue(row.attributes?.lei)?.toUpperCase() ?? stringValue(row.id)?.toUpperCase();
  const status = stringValue(row.attributes?.registration?.status)?.toUpperCase();
  const recordName = legalNameFromGleif(row.attributes?.entity?.legalName);
  const country = countryFromGleif(row.attributes?.entity?.legalAddress);
  if (!lei || status !== "ISSUED" || normalizeName(recordName) !== normalizeName(legalName)) return null;
  return stripUndefined({
    lei,
    domicile: country?.toUpperCase() ?? undefined,
  });
}

function listingWithEnrichment(
  listing: DiscoveredListing,
  figi: FigiEnrichment | null,
  lei: LeiEnrichment | null,
): DiscoveredListing {
  const provenance = [...(listing.source_provenance ?? []).map(cloneProvenance)];
  if (figi?.figi_composite || figi?.isin) {
    provenance.push({
      provider: OPENFIGI_REFERENCE_PROVIDER,
      source_id: OPENFIGI_REFERENCE_SOURCE_ID,
      fields: [
        ...(figi.figi_composite ? ["figi_composite"] : []),
        ...(figi.isin ? ["isin"] : []),
      ],
    });
  }
  if (lei?.lei || lei?.domicile) {
    provenance.push({
      provider: GLEIF_REFERENCE_PROVIDER,
      source_id: GLEIF_REFERENCE_SOURCE_ID,
      fields: [
        ...(lei.lei ? ["lei"] : []),
        ...(lei.domicile ? ["domicile"] : []),
      ],
    });
  }

  return stripUndefined({
    ...listing,
    ...(figi?.figi_composite ? { figi_composite: figi.figi_composite } : {}),
    ...(figi?.isin ? { isin: figi.isin } : {}),
    ...(lei?.lei ? { lei: lei.lei } : {}),
    ...(lei?.domicile ? { domicile: lei.domicile } : {}),
    source_provenance: provenance,
  });
}

async function fetchText(
  url: string | URL,
  fetchImpl: FetchImpl,
  timeoutMs: number,
): Promise<string> {
  const response = await fetchWithTimeout(url, fetchImpl, timeoutMs);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function fetchJson(
  url: string | URL,
  fetchImpl: FetchImpl,
  timeoutMs: number,
  init?: RequestInit,
): Promise<unknown | null> {
  const response = await fetchWithTimeout(url, fetchImpl, timeoutMs, init);
  if (!response.ok) return null;
  return response.json();
}

async function fetchWithTimeout(
  url: string | URL,
  fetchImpl: FetchImpl,
  timeoutMs: number,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function parsePipeRows<T extends Record<string, string | undefined>>(text: string): T[] {
  const [headerLine, ...bodyLines] = text.split(/\r?\n/);
  const headers = headerLine?.split("|") ?? [];
  return bodyLines.flatMap((line) => {
    if (!line.trim() || line.startsWith("File Creation Time:")) return [];
    const cells = line.split("|");
    const row: Record<string, string | undefined> = {};
    headers.forEach((header, index) => {
      row[header] = cells[index]?.trim();
    });
    return [row as T];
  });
}

function isOpenFigiMappingResponse(value: unknown): value is OpenFigiMappingResponse {
  return Array.isArray(value);
}

function isGleifLeiRecordsResponse(value: unknown): value is GleifLeiRecordsResponse {
  return typeof value === "object" && value !== null;
}

function gleifResponseMayBeTruncated(response: GleifLeiRecordsResponse, pageSize: number): boolean {
  const dataLength = Array.isArray(response.data) ? response.data.length : 0;
  const pagination = objectValue(objectValue(response.meta)?.pagination);
  const total = numberProperty(pagination, "total");
  const lastPage = numberProperty(pagination, "lastPage");
  const currentPage = numberProperty(pagination, "currentPage") ?? 1;

  if (hasNextLink(response.links)) return true;
  if (total !== null && total > dataLength) return true;
  if (total !== null && total > pageSize) return true;
  if (lastPage !== null && lastPage > currentPage) return true;
  return dataLength >= pageSize && total === null && lastPage === null;
}

function hasNextLink(value: unknown): boolean {
  const links = objectValue(value);
  if (!links || !("next" in links)) return false;
  return links.next !== null && links.next !== undefined && String(links.next).trim().length > 0;
}

function cleanSecurityName(value: string): string {
  return value
    .replace(/\s+-\s+.+$/, "")
    .replace(/\s+(Class\s+[A-Z]\s+)?Common Stock$/i, "")
    .replace(/\s+Ordinary Shares$/i, "")
    .replace(/\s+American Depositary Shares$/i, "")
    .replace(/\s+ADS$/i, "")
    .trim();
}

function assetTypeForSecurity(securityName: string, etfFlag: unknown): DiscoveryAssetType {
  if (stringValue(etfFlag)?.toUpperCase() === "Y") return "etf";
  return /\b(ADR|ADS|American Depositary)\b/i.test(securityName) ? "adr" : "common_stock";
}

function openFigiSecurityMatchesAssetType(securityType: string, assetType: DiscoveryAssetType): boolean {
  if (assetType === "etf") return /\betf\b|exchange traded fund/i.test(securityType);
  if (assetType === "adr") return /\badr\b|depositary/i.test(securityType);
  return /common stock|equity|ordinary shares/i.test(securityType);
}

function legalNameFromGleif(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "object" && value !== null) {
    return stringValue((value as { name?: unknown }).name);
  }
  return null;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function numberProperty(value: Record<string, unknown> | null, key: string): number | null {
  if (!value) return null;
  const raw = value[key];
  const parsed = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function countryFromGleif(value: unknown): string | null {
  if (typeof value === "object" && value !== null) {
    return stringValue((value as { country?: unknown }).country);
  }
  return null;
}

function joinUrlPath(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function isinValue(value: unknown): string | null {
  const raw = stringValue(value)?.toUpperCase();
  return raw && /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(raw) ? raw : null;
}

function uniqueDefined(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function cloneProvenance(provenance: DiscoverySourceProvenance): DiscoverySourceProvenance {
  return {
    provider: provenance.provider,
    source_id: provenance.source_id,
    fields: [...provenance.fields],
  };
}

function normalizeName(value: string | null): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) delete value[key];
  }
  return value;
}

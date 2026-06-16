// Map a CUSIP to a security via OpenFIGI's /v3/mapping (idType ID_CUSIP) — the
// reverse of the ticker-keyed enrichment in open-reference-providers.ts. Returns
// a single unique equity match (ticker/name/MIC/FIGI/ISIN) the CUSIP→issuer
// enrichment turns into a DiscoveredListing, or null on no/ambiguous/non-equity.
import type { OpenReferenceProviderConfig } from "./provider-sources.ts";
import type { DiscoveryAssetType } from "./discovery.ts";
import {
  fetchJson,
  joinUrlPath,
  stringValue,
  isinValue,
  isOpenFigiMappingResponse,
  type FetchImpl,
  type OpenFigiMappingResponse,
} from "./open-reference-providers.ts";

export type OpenFigiCusipMatch = {
  ticker: string;
  mic: string;
  legalName: string;
  assetType: DiscoveryAssetType;
  isin?: string;
  figiComposite: string;
};

// An ID_CUSIP mapping resolves to the COMPOSITE security, whose row often carries
// only exchCode "US" rather than a venue MIC. The listing MIC is a refinable
// detail (later Polygon discovery merges the precise venue by FIGI identity), so
// default to the primary US equity market.
const DEFAULT_US_MIC = "XNAS";

export async function mapCusipViaOpenFigi(
  config: OpenReferenceProviderConfig["openfigi"],
  cusip: string,
  fetchImpl: FetchImpl = fetch,
  timeoutMs = 5000,
): Promise<OpenFigiCusipMatch | null> {
  if (!config.enabled) return null;
  const normalized = cusip.trim().toUpperCase();
  if (normalized.length !== 9) return null;
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config.apiKey) headers["X-OPENFIGI-APIKEY"] = config.apiKey;
    const response = await fetchJson(joinUrlPath(config.baseUrl, "/v3/mapping"), fetchImpl, timeoutMs, {
      method: "POST",
      headers,
      body: JSON.stringify([{ idType: "ID_CUSIP", idValue: normalized }]),
    });
    if (!response || !isOpenFigiMappingResponse(response)) return null;
    return uniqueCusipMatch(response);
  } catch {
    return null;
  }
}

// Require exactly one distinct equity security (by composite FIGI) — ambiguity or
// none means we don't guess (the enrichment skips + logs).
function uniqueCusipMatch(response: OpenFigiMappingResponse): OpenFigiCusipMatch | null {
  const candidates = response
    .flatMap((entry) => (Array.isArray(entry.data) ? entry.data : []))
    .flatMap((row) => cusipCandidate(row) ?? []);
  const uniqueFigi = [...new Set(candidates.map((c) => c.figiComposite))];
  if (uniqueFigi.length !== 1) return null;
  return candidates.find((c) => c.figiComposite === uniqueFigi[0]) ?? null;
}

function cusipCandidate(value: unknown): OpenFigiCusipMatch | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  const ticker = stringValue(row.ticker)?.toUpperCase();
  const legalName = stringValue(row.name);
  const figiComposite = stringValue(row.compositeFIGI);
  const marketSector = stringValue(row.marketSector)?.toLowerCase();
  const securityType = `${stringValue(row.securityType) ?? ""} ${stringValue(row.securityType2) ?? ""}`;
  const assetType = assetTypeFromSecurityType(securityType);

  if (!ticker || !legalName || !figiComposite || assetType === null) return null;
  if (marketSector && marketSector !== "equity") return null;

  const mic = stringValue(row.micCode)?.toUpperCase() || DEFAULT_US_MIC;
  const isin = isinValue(row.isin) ?? isinValue(row.idValue) ?? undefined;
  return { ticker, mic, legalName, assetType, isin, figiComposite };
}

// Mirror the asset-type categories in open-reference-providers' matcher; a
// non-equity security type yields null (not a holding kind we model).
function assetTypeFromSecurityType(securityType: string): DiscoveryAssetType | null {
  if (/\betf\b|exchange traded fund/i.test(securityType)) return "etf";
  if (/\badr\b|depositary/i.test(securityType)) return "adr";
  if (/common stock|equity|ordinary shares/i.test(securityType)) return "common_stock";
  return null;
}

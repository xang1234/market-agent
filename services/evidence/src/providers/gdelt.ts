import { createHash } from "node:crypto";

import { GDELT_DOC_API_CANONICAL_URL } from "../gdelt-source.ts";
import { canonicalizeNewsUrl } from "../news-url.ts";
import {
  assertIso8601WithOffset,
  assertNonEmptyString,
  assertOneOf,
  assertPositiveInteger,
} from "../validators.ts";

type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<Response>;

export const GDELT_ARTICLE_DISCOVERY_SORTS = Object.freeze([
  "relevance",
  "datedesc",
  "dateasc",
] as const);
export const GDELT_ARTICLE_DISCOVERY_MODES = Object.freeze(["artlist"] as const);
export const GDELT_MAX_ARTICLE_RECORDS = 250;
export const GDELT_DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export type GdeltArticleDiscoverySort = (typeof GDELT_ARTICLE_DISCOVERY_SORTS)[number];
export type GdeltArticleDiscoveryMode = (typeof GDELT_ARTICLE_DISCOVERY_MODES)[number];

export type GdeltArticleDiscoveryRequest = {
  query: string;
  mode?: GdeltArticleDiscoveryMode;
  maxRecords?: number;
  sort?: GdeltArticleDiscoverySort;
  timespan?: string;
  startDateTime?: string;
  endDateTime?: string;
  searchLanguage?: string;
  domains?: ReadonlyArray<string>;
};

export type GdeltArticleDiscovery = Readonly<{
  url: string;
  title: string;
  seenAt: string;
  domain: string | null;
  language: string | null;
  sourceCountry: string | null;
  snippet: string | null;
  imageUrl: string | null;
  dedupeKey: string;
  providerMetadataHash: string;
  providerMetadata: Readonly<Record<string, string>>;
}>;

export type GdeltArticleDiscoveryResult = Readonly<{
  articles: ReadonlyArray<GdeltArticleDiscovery>;
  requestUrl: string;
  retrievedAt: string;
}>;

export type GdeltDocClientConfig = {
  baseUrl?: string;
  fetch?: FetchLike;
  now?: () => number;
  requestTimeoutMs?: number;
};

export class GdeltDocFetchError extends Error {
  readonly status: number;
  readonly url: string;

  constructor(status: number, url: string, message: string) {
    super(message);
    this.name = "GdeltDocFetchError";
    this.status = status;
    this.url = url;
  }
}

export class GdeltDocRateLimitError extends GdeltDocFetchError {
  constructor(url: string) {
    super(429, url, `GDELT DOC API rate-limited request: ${url}`);
    this.name = "GdeltDocRateLimitError";
  }
}

export class GdeltDocTimeoutError extends GdeltDocFetchError {
  constructor(url: string, timeoutMs: number) {
    super(0, url, `GDELT DOC API request timed out after ${timeoutMs}ms: ${url}`);
    this.name = "GdeltDocTimeoutError";
  }
}

export class GdeltDocPayloadError extends Error {
  readonly url: string;

  constructor(url: string, message: string) {
    super(message);
    this.name = "GdeltDocPayloadError";
    this.url = url;
  }
}

export class GdeltDocClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly requestTimeoutMs: number;

  constructor(config: GdeltDocClientConfig = {}) {
    const baseUrl = config.baseUrl ?? GDELT_DOC_API_CANONICAL_URL;
    assertHttpUrl(baseUrl, "GdeltDocClient.baseUrl");
    if (
      config.requestTimeoutMs !== undefined &&
      (!Number.isFinite(config.requestTimeoutMs) || config.requestTimeoutMs <= 0)
    ) {
      throw new Error("GdeltDocClient: requestTimeoutMs must be a positive number");
    }

    this.baseUrl = baseUrl;
    this.fetchImpl = config.fetch ?? (globalThis.fetch.bind(globalThis) as FetchLike);
    this.now = config.now ?? Date.now;
    this.requestTimeoutMs = config.requestTimeoutMs ?? GDELT_DEFAULT_REQUEST_TIMEOUT_MS;
  }

  async searchArticles(request: GdeltArticleDiscoveryRequest): Promise<GdeltArticleDiscoveryResult> {
    const requestUrl = buildGdeltArticleSearchUrl(this.baseUrl, request);
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    let response: Response;
    let payload: unknown;
    try {
      response = await this.fetchImpl(requestUrl, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (response.status === 429) {
        throw new GdeltDocRateLimitError(requestUrl);
      }
      if (!response.ok) {
        throw new GdeltDocFetchError(
          response.status,
          requestUrl,
          `GDELT DOC API request failed (${response.status}): ${requestUrl}`,
        );
      }
      try {
        payload = await response.json();
      } catch (err) {
        if (controller.signal.aborted) {
          throw err;
        }
        throw new GdeltDocPayloadError(
          requestUrl,
          `GDELT DOC API returned invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } catch (err) {
      if (controller.signal.aborted) {
        throw new GdeltDocTimeoutError(requestUrl, this.requestTimeoutMs);
      }
      if (err instanceof GdeltDocFetchError || err instanceof GdeltDocPayloadError) {
        throw err;
      }
      throw new GdeltDocFetchError(
        0,
        requestUrl,
        `GDELT DOC API request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timeoutHandle);
    }

    return Object.freeze({
      articles: normalizeArticlePayload(payload, requestUrl),
      requestUrl,
      retrievedAt: new Date(this.now()).toISOString(),
    });
  }
}

export function buildGdeltArticleSearchUrl(
  baseUrl: string,
  request: GdeltArticleDiscoveryRequest,
): string {
  validateRequest(request);

  const url = new URL(baseUrl);
  url.searchParams.set("format", "json");
  url.searchParams.set("mode", request.mode ?? "artlist");
  url.searchParams.set("query", composeQuery(request));

  if (request.maxRecords !== undefined) {
    url.searchParams.set("maxrecords", String(request.maxRecords));
  }
  if (request.sort !== undefined && request.sort !== "relevance") {
    url.searchParams.set("sort", request.sort);
  }
  if (request.searchLanguage !== undefined) {
    url.searchParams.set("searchlang", normalizeToken(request.searchLanguage, "searchLanguage"));
  }
  if (request.timespan !== undefined) {
    url.searchParams.set("timespan", request.timespan.trim());
  }
  if (request.startDateTime !== undefined) {
    url.searchParams.set("startdatetime", toGdeltDateTime(request.startDateTime, "startDateTime"));
  }
  if (request.endDateTime !== undefined) {
    url.searchParams.set("enddatetime", toGdeltDateTime(request.endDateTime, "endDateTime"));
  }

  return url.toString();
}

function validateRequest(request: GdeltArticleDiscoveryRequest): void {
  assertNonEmptyString(request.query, "query");
  if (request.mode !== undefined) {
    assertOneOf(request.mode, GDELT_ARTICLE_DISCOVERY_MODES, "mode");
  }
  if (request.sort !== undefined) {
    assertOneOf(request.sort, GDELT_ARTICLE_DISCOVERY_SORTS, "sort");
  }
  if (request.maxRecords !== undefined) {
    assertPositiveInteger(request.maxRecords, "maxRecords");
    if (request.maxRecords > GDELT_MAX_ARTICLE_RECORDS) {
      throw new Error(`maxRecords: must be <= ${GDELT_MAX_ARTICLE_RECORDS}`);
    }
  }
  if (request.timespan !== undefined) {
    assertTimespan(request.timespan);
    if (request.startDateTime !== undefined || request.endDateTime !== undefined) {
      throw new Error("timespan cannot be combined with startDateTime or endDateTime");
    }
  }
  if (request.startDateTime !== undefined) {
    assertIso8601WithOffset(request.startDateTime, "startDateTime");
  }
  if (request.endDateTime !== undefined) {
    assertIso8601WithOffset(request.endDateTime, "endDateTime");
  }
  if (
    request.startDateTime !== undefined &&
    request.endDateTime !== undefined &&
    Date.parse(request.startDateTime) > Date.parse(request.endDateTime)
  ) {
    throw new Error("startDateTime must be <= endDateTime");
  }
}

function composeQuery(request: GdeltArticleDiscoveryRequest): string {
  const parts = [request.query.trim()];
  const domains = request.domains?.map((domain) => normalizeDomain(domain)) ?? [];
  if (domains.length > 0) {
    parts.push(`(${domains.map((domain) => `domain:${domain}`).join(" OR ")})`);
  }
  return parts.join(" ");
}

function normalizeArticlePayload(payload: unknown, requestUrl: string): ReadonlyArray<GdeltArticleDiscovery> {
  if (!isRecord(payload) || !Array.isArray(payload.articles)) {
    throw new GdeltDocPayloadError(requestUrl, "GDELT DOC API payload must contain an articles array");
  }

  const seen = new Set<string>();
  const articles: GdeltArticleDiscovery[] = [];
  for (const raw of payload.articles) {
    const normalized = normalizeArticle(raw, requestUrl);
    if (seen.has(normalized.dedupeKey)) continue;
    seen.add(normalized.dedupeKey);
    articles.push(normalized);
  }
  return Object.freeze(articles);
}

function normalizeArticle(raw: unknown, requestUrl: string): GdeltArticleDiscovery {
  if (!isRecord(raw)) {
    throw new GdeltDocPayloadError(requestUrl, "GDELT article item must be an object");
  }

  const rawUrl = requiredString(raw.url, "article.url", requestUrl);
  const title = requiredString(raw.title, "article.title", requestUrl);
  const seendate = requiredString(raw.seendate, "article.seendate", requestUrl);
  let canonicalUrl: string;
  try {
    canonicalUrl = canonicalizeNewsUrl(rawUrl);
  } catch (err) {
    throw new GdeltDocPayloadError(
      requestUrl,
      `GDELT article url is invalid: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const snippet = optionalString(raw.snippet) ?? optionalString(raw.summary);
  const providerMetadata = metadataFromArticle({
    url: rawUrl,
    seendate,
    domain: optionalString(raw.domain),
    language: optionalString(raw.language),
    sourcecountry: optionalString(raw.sourcecountry),
    socialimage: optionalString(raw.socialimage),
    snippet,
  });

  return Object.freeze({
    url: canonicalUrl,
    title,
    seenAt: parseGdeltSeenDate(seendate, requestUrl),
    domain: optionalString(raw.domain),
    language: optionalString(raw.language),
    sourceCountry: optionalString(raw.sourcecountry),
    snippet,
    imageUrl: optionalString(raw.socialimage),
    dedupeKey: canonicalUrl,
    providerMetadataHash: sha256StableJson(providerMetadata),
    providerMetadata,
  });
}

function metadataFromArticle(metadata: Record<string, string | null>): Readonly<Record<string, string>> {
  const whitelisted = Object.entries(metadata).filter((entry): entry is [string, string] => entry[1] !== null);
  return Object.freeze(Object.fromEntries(whitelisted));
}

function parseGdeltSeenDate(value: string, requestUrl: string): string {
  const compact = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(value);
  if (compact) {
    return isoFromGdeltParts(compact, requestUrl);
  }

  const compactUtc = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if (compactUtc) {
    return isoFromGdeltParts(compactUtc, requestUrl);
  }

  try {
    assertIso8601WithOffset(value, "article.seendate");
  } catch (err) {
    throw new GdeltDocPayloadError(
      requestUrl,
      `GDELT article seendate is invalid: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return new Date(value).toISOString();
}

function isoFromGdeltParts(match: RegExpExecArray, requestUrl: string): string {
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) {
    throw new GdeltDocPayloadError(requestUrl, "GDELT article seendate is invalid");
  }

  return date.toISOString();
}

function toGdeltDateTime(value: string, label: string): string {
  assertIso8601WithOffset(value, label);
  const date = new Date(value);
  return [
    date.getUTCFullYear(),
    pad2(date.getUTCMonth() + 1),
    pad2(date.getUTCDate()),
    pad2(date.getUTCHours()),
    pad2(date.getUTCMinutes()),
    pad2(date.getUTCSeconds()),
  ].join("");
}

function requiredString(value: unknown, label: string, requestUrl: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new GdeltDocPayloadError(requestUrl, `${label}: must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function normalizeDomain(value: string): string {
  const domain = normalizeToken(value, "domains");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
    throw new Error(`domains: invalid domain "${value}"`);
  }
  return domain.toLowerCase();
}

function normalizeToken(value: string, label: string): string {
  assertNonEmptyString(value, label);
  return value.trim().toLowerCase();
}

function assertTimespan(value: string): void {
  assertNonEmptyString(value, "timespan");
  if (!/^\d+(min|h|hours?|d|days?|w|weeks?|m|months?)$/i.test(value.trim())) {
    throw new Error("timespan: must use GDELT units like 15min, 1h, 1d, 1week, or 1month");
  }
}

function assertHttpUrl(value: string, label: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label}: must be a valid URL`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${label}: must use http or https`);
  }
}

function sha256StableJson(value: Readonly<Record<string, string>>): string {
  const stable = Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, value[key]]),
  );
  return `sha256:${createHash("sha256").update(JSON.stringify(stable)).digest("hex")}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

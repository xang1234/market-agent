import { canonicalizeNewsUrl } from "../news-url.ts";
import type {
  IrAssetKind,
  IrSourceRegistryRow,
} from "../issuer-ir-registry.ts";

type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<Response>;

export const ISSUER_IR_DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const ISSUER_IR_DEFAULT_MAX_CANDIDATES = 50;

export type IssuerIrCandidate = Readonly<{
  canonicalUrl: string;
  title: string;
  publishedAt: string | null;
  assetKind: IrAssetKind;
  hostedProvider: string;
  contentType: string | null;
  sourceUrl: string;
}>;

export type DiscoverIssuerIrCandidatesConfig = {
  fetch?: FetchLike;
  now?: () => number;
  requestTimeoutMs?: number;
  maxCandidates?: number;
};

type RawCandidate = {
  url: string;
  title: string;
  publishedAt?: string | null;
  contentType?: string | null;
};

export class IssuerIrFetchError extends Error {
  readonly status: number;
  readonly url: string;

  constructor(status: number, url: string, message: string) {
    super(message);
    this.name = "IssuerIrFetchError";
    this.status = status;
    this.url = url;
  }
}

export async function discoverIssuerIrCandidates(
  entry: IrSourceRegistryRow,
  config: DiscoverIssuerIrCandidatesConfig = {},
): Promise<readonly IssuerIrCandidate[]> {
  const response = await fetchText(entry.url, {
    fetch: config.fetch,
    requestTimeoutMs: config.requestTimeoutMs,
    headers: conditionalHeaders(entry),
  });
  if (response.notModified) return Object.freeze([]);
  const contentType = response.contentType;
  const raw = rawCandidatesFromSource(entry, response.text, contentType);
  const candidates: IssuerIrCandidate[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    let canonicalUrl: string;
    try {
      canonicalUrl = canonicalizeNewsUrl(resolveUrl(item.url, entry.url));
    } catch {
      continue;
    }
    if (!canonicalUrl.startsWith("https://") || seen.has(canonicalUrl)) continue;
    const assetKind = classifyIssuerIrAssetKind({
      url: canonicalUrl,
      title: item.title,
      contentType: item.contentType ?? null,
    });
    if (!assetKind) continue;
    seen.add(canonicalUrl);
    candidates.push(Object.freeze({
      canonicalUrl,
      title: normalizeSpace(item.title) || canonicalUrl,
      publishedAt: normalizePublishedAt(item.publishedAt ?? null),
      assetKind,
      hostedProvider: hostedProviderFromUrl(canonicalUrl),
      contentType: item.contentType ?? null,
      sourceUrl: entry.url,
    }));
    if (candidates.length >= (config.maxCandidates ?? ISSUER_IR_DEFAULT_MAX_CANDIDATES)) break;
  }
  return Object.freeze(candidates);
}

export async function fetchIssuerIrDocumentBytes(
  url: string,
  config: DiscoverIssuerIrCandidatesConfig = {},
): Promise<Readonly<{ bytes: Uint8Array; contentType: string | null; retrievedAt: string }>> {
  const response = await fetchBytes(url, {
    fetch: config.fetch,
    requestTimeoutMs: config.requestTimeoutMs,
  });
  return Object.freeze({
    bytes: response.bytes,
    contentType: response.contentType,
    retrievedAt: new Date(config.now?.() ?? Date.now()).toISOString(),
  });
}

export function classifyIssuerIrAssetKind(input: {
  url: string;
  title?: string | null;
  contentType?: string | null;
}): IrAssetKind | null {
  const text = `${input.title ?? ""} ${input.url}`.toLowerCase();
  const contentType = (input.contentType ?? "").toLowerCase();
  if (contentType.includes("pdf") || /\.pdf(?:$|[?#])/i.test(input.url) || /\b(presentation|investor day|slides?|deck)\b/i.test(text)) {
    return "presentation";
  }
  if (/\b(transcript|prepared remarks|earnings call)\b/i.test(text)) {
    return "transcript";
  }
  if (/\b(press release|news release|earnings release|results|reports|announces|guidance|quarter|fiscal)\b/i.test(text)) {
    return "press_release";
  }
  return null;
}

export function hostedProviderFromUrl(value: string): string {
  let host = "";
  try {
    host = new URL(value).hostname.toLowerCase();
  } catch {
    return "issuer_ir";
  }
  if (host.includes("businesswire.com")) return "business_wire";
  if (host.includes("globenewswire.com")) return "globe_news_wire";
  if (host.includes("q4cdn.com")) return "q4cdn";
  if (host.includes("gcs-web.com") || host.includes("investorroom.com") || host.includes("notified.com")) {
    return "notified";
  }
  return "issuer_ir";
}

function rawCandidatesFromSource(
  entry: IrSourceRegistryRow,
  text: string,
  contentType: string | null,
): readonly RawCandidate[] {
  if (entry.source_type === "manual_url") {
    return [{ url: entry.url, title: entry.url, contentType }];
  }
  if (entry.source_type === "sitemap") return parseSitemap(text);
  if (entry.source_type === "rss" || entry.source_type === "atom") return parseFeed(text);
  return parseHtmlLinks(text, entry.url);
}

function parseFeed(xml: string): readonly RawCandidate[] {
  const out: RawCandidate[] = [];
  for (const block of blocks(xml, "item")) {
    const title = textTag(block, "title") ?? "";
    const link = textTag(block, "link");
    if (link) out.push({ url: link, title, publishedAt: textTag(block, "pubDate") ?? textTag(block, "published") ?? textTag(block, "updated") });
  }
  for (const block of blocks(xml, "entry")) {
    const title = textTag(block, "title") ?? "";
    const link = hrefLink(block) ?? textTag(block, "link");
    if (link) out.push({ url: link, title, publishedAt: textTag(block, "published") ?? textTag(block, "updated") });
  }
  return out;
}

function parseSitemap(xml: string): readonly RawCandidate[] {
  return blocks(xml, "url").flatMap((block) => {
    const loc = textTag(block, "loc");
    if (!loc) return [];
    return [{ url: loc, title: loc, publishedAt: textTag(block, "lastmod") }];
  });
}

function parseHtmlLinks(html: string, baseUrl: string): readonly RawCandidate[] {
  const out: RawCandidate[] = [];
  const anchorRe = /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorRe.exec(html)) !== null) {
    const url = resolveUrl(decodeHtml(match[2] ?? ""), baseUrl);
    const title = normalizeSpace(stripTags(decodeHtml(match[3] ?? ""))) || url;
    if (classifyIssuerIrAssetKind({ url, title })) out.push({ url, title });
  }
  return out;
}

async function fetchText(
  url: string,
  config: { fetch?: FetchLike; requestTimeoutMs?: number; headers?: Record<string, string> },
): Promise<{ text: string; contentType: string | null; notModified: boolean }> {
  const fetched = await fetchBytes(url, config);
  if (fetched.status === 304) {
    return {
      text: "",
      contentType: fetched.contentType,
      notModified: true,
    };
  }
  return {
    text: new TextDecoder().decode(fetched.bytes),
    contentType: fetched.contentType,
    notModified: false,
  };
}

async function fetchBytes(
  url: string,
  config: { fetch?: FetchLike; requestTimeoutMs?: number; headers?: Record<string, string> },
): Promise<{ bytes: Uint8Array; contentType: string | null; status: number }> {
  const fetchImpl = config.fetch ?? (globalThis.fetch.bind(globalThis) as FetchLike);
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), config.requestTimeoutMs ?? ISSUER_IR_DEFAULT_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: config.headers,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new IssuerIrFetchError(0, url, `issuer IR request timed out: ${url}`);
    }
    throw new IssuerIrFetchError(0, url, `issuer IR request failed: ${errorMessage(error)}`);
  } finally {
    clearTimeout(timeoutHandle);
  }
  if (response.status === 304) {
    return {
      bytes: new Uint8Array(),
      contentType: response.headers.get("content-type"),
      status: response.status,
    };
  }
  if (!response.ok) {
    throw new IssuerIrFetchError(response.status, url, `issuer IR request failed (${response.status}): ${url}`);
  }
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get("content-type"),
    status: response.status,
  };
}

function conditionalHeaders(entry: IrSourceRegistryRow): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.5" };
  if (entry.etag) headers["If-None-Match"] = entry.etag;
  if (entry.last_modified) headers["If-Modified-Since"] = entry.last_modified;
  return headers;
}

function blocks(xml: string, name: string): string[] {
  const re = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "gi");
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) out.push(match[1] ?? "");
  return out;
}

function textTag(xml: string, name: string): string | null {
  const match = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i").exec(xml);
  return match ? normalizeSpace(decodeHtml(stripTags(match[1] ?? ""))) : null;
}

function hrefLink(xml: string): string | null {
  const match = /<link\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*\/?>/i.exec(xml);
  return match ? decodeHtml(match[2] ?? "") : null;
}

function normalizePublishedAt(value: string | null): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function resolveUrl(value: string, baseUrl: string): string {
  return new URL(value, baseUrl).toString();
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

function normalizeSpace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

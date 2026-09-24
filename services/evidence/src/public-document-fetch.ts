import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const SUPPORTED_CONTENT_TYPES = new Set(["text/html", "text/plain", "application/xhtml+xml"]);

export type PublicDocumentFetchErrorCode =
  | "invalid_url"
  | "blocked_destination"
  | "redirect_limit"
  | "http_status"
  | "unsupported_content"
  | "response_too_large"
  | "timeout";

export class PublicDocumentFetchError extends Error {
  readonly code: PublicDocumentFetchErrorCode;

  constructor(code: PublicDocumentFetchErrorCode, message: string) {
    super(message);
    this.name = "PublicDocumentFetchError";
    this.code = code;
  }
}

export type PublicAddress = { address: string; family: 4 | 6 };
export type PublicDocumentDns = { lookup(hostname: string): Promise<readonly PublicAddress[]> };
export type PublicDocumentTransportRequest = {
  hostname: string;
  family: 4 | 6;
  servername: string;
  port: number;
  path: string;
  headers: Readonly<Record<string, string>>;
  signal: AbortSignal;
};
export type PublicDocumentTransportResponse = {
  status: number;
  headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  body: Uint8Array;
};
export type PublicDocumentTransport = {
  request(input: PublicDocumentTransportRequest): Promise<PublicDocumentTransportResponse>;
};
export type PublicDocumentFetchResult = Readonly<{
  url: string;
  content_type: string;
  bytes: Uint8Array;
}>;

export function createPublicDocumentFetcher(options: {
  dns?: PublicDocumentDns;
  transport?: PublicDocumentTransport;
  max_bytes?: number;
  max_redirects?: number;
} = {}) {
  const dns = options.dns ?? nativeDns();
  const transport = options.transport ?? nativeHttpsTransport();
  const maxBytes = boundedPositiveLimit(options.max_bytes, MAX_BYTES, "max_bytes");
  const maxRedirects = boundedPositiveLimit(options.max_redirects, MAX_REDIRECTS, "max_redirects");

  return Object.freeze({
    async fetch(value: string, signal: AbortSignal = new AbortController().signal): Promise<PublicDocumentFetchResult> {
      let url = parsePublicUrl(value);
      for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
        throwIfAborted(signal);
        const destination = await publicDestination(url, dns);
        let response: PublicDocumentTransportResponse;
        try {
          response = await transport.request({
            hostname: destination.address,
            family: destination.family,
            servername: url.hostname,
            port: url.port ? Number(url.port) : 443,
            path: `${url.pathname}${url.search}`,
            headers: { host: url.host, accept: "text/html, text/plain, application/xhtml+xml" },
            signal,
          });
        } catch (error) {
          if (signal.aborted) throw new PublicDocumentFetchError("timeout", "Public document request timed out");
          throw error;
        }
        if (REDIRECT_STATUSES.has(response.status)) {
          const location = header(response.headers, "location");
          if (!location) throw new PublicDocumentFetchError("invalid_url", "Public document redirect omitted Location");
          if (redirectCount === maxRedirects) throw new PublicDocumentFetchError("redirect_limit", "Public document exceeded redirect limit");
          url = parsePublicUrl(new URL(location, url).toString());
          continue;
        }
        if (response.status < 200 || response.status >= 300) {
          throw new PublicDocumentFetchError("http_status", `Public document returned HTTP ${response.status}`);
        }
        const contentLength = header(response.headers, "content-length");
        if (contentLength && Number(contentLength) > maxBytes) {
          throw new PublicDocumentFetchError("response_too_large", "Public document exceeds the 5 MB limit");
        }
        if (response.body.byteLength > maxBytes) {
          throw new PublicDocumentFetchError("response_too_large", "Public document exceeds the 5 MB limit");
        }
        const contentType = normalizeContentType(header(response.headers, "content-type"));
        if (!contentType || !SUPPORTED_CONTENT_TYPES.has(contentType)) {
          throw new PublicDocumentFetchError("unsupported_content", "Public document content type is not supported");
        }
        return Object.freeze({ url: url.toString(), content_type: contentType, bytes: new Uint8Array(response.body) });
      }
      throw new PublicDocumentFetchError("redirect_limit", "Public document exceeded redirect limit");
    },
  });
}

// A narrow FetchLike adapter for SEC's existing client. It deliberately keeps
// SEC's URL construction, response parsing, Fair Access headers and rate
// limiter in that client while replacing only its connection transport.
export function createPinnedHttpsFetch(options: {
  dns?: PublicDocumentDns;
  transport?: PublicDocumentTransport;
  max_bytes?: number;
} = {}): typeof fetch {
  const dns = options.dns ?? nativeDns();
  const transport = options.transport ?? nativeHttpsTransport();
  const maxBytes = boundedPositiveLimit(options.max_bytes, MAX_BYTES, "max_bytes");
  return (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const initial = input instanceof Request ? input.url : String(input);
    const signal = init?.signal ?? new AbortController().signal;
    const callerHeaders = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    let url = parsePublicUrl(initial);
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      throwIfAborted(signal);
      const destination = await publicDestination(url, dns);
      const headers = Object.fromEntries(callerHeaders.entries());
      headers.host = url.host;
      if (!headers.accept) headers.accept = "application/json, text/html, text/plain, application/xhtml+xml";
      let response: PublicDocumentTransportResponse;
      try {
        response = await transport.request({
          hostname: destination.address,
          family: destination.family,
          servername: url.hostname,
          port: url.port ? Number(url.port) : 443,
          path: `${url.pathname}${url.search}`,
          headers,
          signal,
        });
      } catch (error) {
        if (signal.aborted) throw new PublicDocumentFetchError("timeout", "Pinned HTTPS request timed out");
        throw error;
      }
      if (REDIRECT_STATUSES.has(response.status)) {
        const location = header(response.headers, "location");
        if (!location) throw new PublicDocumentFetchError("invalid_url", "Pinned HTTPS redirect omitted Location");
        if (redirectCount === MAX_REDIRECTS) throw new PublicDocumentFetchError("redirect_limit", "Pinned HTTPS request exceeded redirect limit");
        url = parsePublicUrl(new URL(location, url).toString());
        continue;
      }
      if (response.body.byteLength > maxBytes || Number(header(response.headers, "content-length")) > maxBytes) {
        throw new PublicDocumentFetchError("response_too_large", "Pinned HTTPS response exceeds the 5 MB limit");
      }
      return new Response(new Uint8Array(response.body), { status: response.status, headers: responseHeaders(response.headers) });
    }
    throw new PublicDocumentFetchError("redirect_limit", "Pinned HTTPS request exceeded redirect limit");
  }) as typeof fetch;
}

export function isPublicAddress(value: string): boolean {
  const address = value.toLowerCase().replace(/^\[|\]$/gu, "");
  if (address.includes(":")) return isPublicIpv6(address);
  return isPublicIpv4(address);
}

function nativeDns(): PublicDocumentDns {
  return {
    async lookup(hostname) {
      const rows = await dnsLookup(hostname, { all: true, verbatim: true });
      return rows.flatMap((row) => row.family === 4 || row.family === 6
        ? [{ address: row.address, family: row.family }]
        : []);
    },
  };
}

function nativeHttpsTransport(): PublicDocumentTransport {
  return {
    request(input) {
      return new Promise((resolve, reject) => {
        const request = httpsRequest({
          protocol: "https:",
          hostname: input.hostname,
          family: input.family,
          port: input.port,
          path: input.path,
          method: "GET",
          headers: input.headers,
          servername: input.servername,
          rejectUnauthorized: true,
        }, (response) => {
          const chunks: Uint8Array[] = [];
          let size = 0;
          response.on("data", (chunk: Buffer) => {
            size += chunk.byteLength;
            if (size > MAX_BYTES) {
              response.destroy(new PublicDocumentFetchError("response_too_large", "Public document exceeds the 5 MB limit"));
              return;
            }
            chunks.push(new Uint8Array(chunk));
          });
          response.on("error", reject);
          response.on("end", () => resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: concatenate(chunks, size),
          }));
        });
        const abort = () => request.destroy(new DOMException("Public document request aborted", "AbortError"));
        input.signal.addEventListener("abort", abort, { once: true });
        request.on("error", reject);
        request.on("close", () => input.signal.removeEventListener("abort", abort));
        if (input.signal.aborted) abort();
        else request.end();
      });
    },
  };
}

function parsePublicUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PublicDocumentFetchError("invalid_url", "Public document URL is invalid");
  }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname) {
    throw new PublicDocumentFetchError("invalid_url", "Public document URL must be credential-free HTTPS");
  }
  return url;
}

async function publicDestination(url: URL, dns: PublicDocumentDns): Promise<PublicAddress> {
  const hostname = url.hostname.replace(/^\[|\]$/gu, "");
  let addresses: readonly PublicAddress[];
  try {
    addresses = await dns.lookup(hostname);
  } catch {
    throw new PublicDocumentFetchError("blocked_destination", "Public document host could not be resolved to a public address");
  }
  const address = addresses.find((entry) => isPublicAddress(entry.address));
  if (!address) throw new PublicDocumentFetchError("blocked_destination", "Public document destination is not public");
  return address;
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 || b === 168)) return false;
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return false;
  if (a === 203 && b === 0) return false;
  return true;
}

function isPublicIpv6(address: string): boolean {
  const dottedMapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/u.exec(address);
  if (dottedMapped) return isPublicIpv4(dottedMapped[1]!);
  const groups = expandIpv6(address);
  if (!groups) return false;
  if (groups.slice(0, 6).every((group, index) => group === (index === 5 ? 0xffff : 0))) {
    return isPublicIpv4(`${groups[6]! >> 8}.${groups[6]! & 0xff}.${groups[7]! >> 8}.${groups[7]! & 0xff}`);
  }
  if (groups.every((group, index) => group === (index === 7 ? 1 : 0))) return false;
  if (groups.every((group) => group === 0)) return false;
  if ((groups[0]! & 0xffc0) === 0xfe80) return false;
  if ((groups[0]! & 0xfe00) === 0xfc00) return false;
  if ((groups[0]! & 0xff00) === 0xff00) return false;
  return true;
}

function expandIpv6(address: string): readonly number[] | null {
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string): number[] | null => {
    if (part === "") return [];
    const groups = part.split(":");
    if (groups.some((group) => !/^[0-9a-f]{1,4}$/u.test(group))) return null;
    return groups.map((group) => Number.parseInt(group, 16));
  };
  const left = parse(halves[0]!);
  const right = parse(halves[1] ?? "");
  if (!left || !right) return null;
  if (halves.length === 1) return left.length === 8 ? left : null;
  const zeros = 8 - left.length - right.length;
  return zeros < 1 ? null : [...left, ...new Array<number>(zeros).fill(0), ...right];
}

function header(headers: PublicDocumentTransportResponse["headers"], name: string): string | null {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "string" ? value : null;
}

function responseHeaders(input: PublicDocumentTransportResponse["headers"]): Headers {
  const output = new Headers();
  for (const [name, value] of Object.entries(input)) {
    if (typeof value === "string") output.set(name, value);
    else if (Array.isArray(value)) for (const item of value) output.append(name, item);
  }
  return output;
}

function normalizeContentType(value: string | null): string | null {
  if (!value) return null;
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? null;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new PublicDocumentFetchError("timeout", "Public document request timed out");
}

function boundedPositiveLimit(value: number | undefined, maximum: number, label: string): number {
  if (value === undefined) return maximum;
  if (!Number.isInteger(value) || value <= 0) throw new PublicDocumentFetchError("invalid_url", `${label} must be a positive integer`);
  return Math.min(value, maximum);
}

function concatenate(chunks: readonly Uint8Array[], size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

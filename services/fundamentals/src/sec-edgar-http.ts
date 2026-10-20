import { createHash } from "node:crypto";
import { parseFinancialJson } from "./lossless-financial-json.ts";
import {
  SecEdgarFetchError,
  type SecEdgarFetcher,
  type SecFetchResult,
} from "./sec-edgar.ts";

export type SecCompanyFactsHttpOptions = {
  userAgent: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  clock?: () => Date;
  // Aborts a request, body included, that takes longer.
  timeoutMs?: number;
};

const SEC_FETCH_TIMEOUT_MS = 30_000;

export function createSecCompanyFactsHttpFetcher(
  options: SecCompanyFactsHttpOptions,
): SecEdgarFetcher {
  const baseUrl = options.baseUrl ?? "https://data.sec.gov";
  const fetchImpl = options.fetchImpl ?? fetch;
  const userAgent = options.userAgent.trim();
  const clock = options.clock ?? (() => new Date());

  if (userAgent.length === 0) {
    throw new Error("SEC_EDGAR_USER_AGENT must be non-empty when SEC EDGAR fetching is enabled");
  }

  return async (path: string): Promise<SecFetchResult> => {
    const url = new URL(path, baseUrl);
    const response = await fetchImpl(url, {
      headers: {
        "accept": "application/json",
        "user-agent": userAgent,
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? SEC_FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new SecEdgarFetchError(response.status, `sec_edgar: HTTP ${response.status}`);
    }

    const body = new Uint8Array(await response.arrayBuffer());
    // Taken after the whole body has arrived: the fetch proves its content
    // was public by this instant, never by an earlier one.
    const completed_at = clock().toISOString();
    return {
      url: url.toString(),
      body_sha256: createHash("sha256").update(body).digest("hex"),
      completed_at,
      // Parse the raw text losslessly: response.json() would already have
      // rounded financial values through JavaScript numbers.
      json: parseFinancialJson(new TextDecoder().decode(body)),
    };
  };
}

export type SecFairAccessOptions = {
  // Minimum time between request starts. SEC allows 10 requests a second.
  minIntervalMs?: number;
  // Retries of an HTTP 429, waiting backoffMs, then twice that, and so on.
  retries?: number;
  backoffMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

// For bulk callers (backfills): spaces requests to stay under SEC's
// fair-access rate and backs off on a 429. Any other failure is thrown as is.
// ponytail: one limiter per wrapper, not shared across processes; run one
// backfill at a time.
export function withSecFairAccess(fetcher: SecEdgarFetcher, options: SecFairAccessOptions = {}): SecEdgarFetcher {
  const minIntervalMs = options.minIntervalMs ?? 150;
  const retries = options.retries ?? 3;
  const backoffMs = options.backoffMs ?? 1_000;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let nextStart = -Infinity;
  const paced = async (path: string): Promise<SecFetchResult> => {
    // Reserve this request's slot before waiting, so concurrent callers queue
    // behind it instead of starting together.
    const start = Math.max(now(), nextStart);
    nextStart = start + minIntervalMs;
    const wait = start - now();
    if (wait > 0) await sleep(wait);
    return fetcher(path);
  };
  return async (path: string): Promise<SecFetchResult> => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await paced(path);
      } catch (error) {
        if (!(error instanceof SecEdgarFetchError) || error.status !== 429 || attempt >= retries) throw error;
        await sleep(backoffMs * 2 ** attempt);
      }
    }
  };
}

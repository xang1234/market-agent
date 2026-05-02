// SEC EDGAR ingestion adapter.
//
// Fetches raw filing bytes from the SEC's archive, threads them through
// the license-aware ingest orchestrator, and lands a (sources,documents)
// pair pointing at the retrieved blob. SEC's Fair Access policy requires
// (a) <= 10 req/sec and (b) an identifying User-Agent on every request;
// both are enforced here at construction time so a misconfigured deploy
// fails at boot rather than after the first inbound trigger.

import { ingestDocument, type IngestDocumentResult } from "./ingest.ts";
import type { ObjectStore } from "./object-store.ts";
import { createSource, type SourceRow } from "./source-repo.ts";
import type { QueryExecutor } from "./types.ts";

// SEC Fair Access ceiling: 10 requests/second per IP.
const SEC_RATE_LIMIT_CEILING = 10;

// Conservative default — sub-ceiling to absorb clock-skew and burstiness
// on shared IPs without ever brushing the limit.
export const SEC_EDGAR_DEFAULT_RATE_LIMIT = Object.freeze({
  capacity: 8,
  refillPerSecond: 8,
});

export const SEC_EDGAR_DEFAULT_USER_AGENT_ENV = "SEC_EDGAR_USER_AGENT";

// ---- Errors ---------------------------------------------------------------

export class SecEdgarFetchError extends Error {
  readonly status: number;
  readonly url: string;
  constructor(status: number, url: string, message: string) {
    super(message);
    this.name = "SecEdgarFetchError";
    this.status = status;
    this.url = url;
  }
}

export class SecEdgarRateLimitError extends SecEdgarFetchError {
  constructor(url: string, message: string) {
    super(429, url, message);
    this.name = "SecEdgarRateLimitError";
  }
}

// ---- Token-bucket rate limiter --------------------------------------------

export type TokenBucketRateLimiterConfig = {
  capacity: number;
  refillPerSecond: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export interface RateLimiter {
  acquire(): Promise<number>;
}

export class TokenBucketRateLimiter implements RateLimiter {
  private tokens: number;
  private lastRefillMs: number;
  private readonly capacity: number;
  private readonly refillPerSecond: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(config: TokenBucketRateLimiterConfig) {
    if (!Number.isInteger(config.capacity) || config.capacity <= 0) {
      throw new Error("TokenBucketRateLimiter: capacity must be a positive integer");
    }
    if (config.capacity > SEC_RATE_LIMIT_CEILING) {
      throw new Error(
        `TokenBucketRateLimiter: capacity must be <= ${SEC_RATE_LIMIT_CEILING} (SEC Fair Access ceiling)`,
      );
    }
    if (typeof config.refillPerSecond !== "number" || config.refillPerSecond <= 0) {
      throw new Error("TokenBucketRateLimiter: refillPerSecond must be > 0");
    }
    this.capacity = config.capacity;
    this.refillPerSecond = config.refillPerSecond;
    this.now = config.now ?? Date.now;
    this.sleep = config.sleep ?? defaultSleep;
    this.tokens = config.capacity;
    this.lastRefillMs = this.now();
  }

  async acquire(): Promise<number> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return 0;
    }
    const msPerToken = 1000 / this.refillPerSecond;
    const tokensNeeded = 1 - this.tokens;
    const waitMs = Math.ceil(tokensNeeded * msPerToken);
    await this.sleep(waitMs);
    this.refill();
    this.tokens -= 1;
    return waitMs;
  }

  private refill(): void {
    const now = this.now();
    const elapsedMs = now - this.lastRefillMs;
    if (elapsedMs <= 0) return;
    const newTokens = (elapsedMs / 1000) * this.refillPerSecond;
    this.tokens = Math.min(this.capacity, this.tokens + newTokens);
    this.lastRefillMs = now;
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// ---- URL builders ---------------------------------------------------------

const ACCESSION_PATTERN = /^\d{10}-\d{2}-\d{6}$/;
// Filename whitelist guards against path traversal ("../") and any
// caller-supplied subpaths that could redirect the fetch elsewhere on
// sec.gov. The URL builder is the one chokepoint both the client and
// any future helpers go through, so refusing here is sufficient.
const SAFE_DOC_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

export function filingArchiveUrl(input: {
  cik: number;
  accession_number: string;
  document: string;
}): string {
  assertCik(input.cik, "filingArchiveUrl.cik");
  assertAccession(input.accession_number, "filingArchiveUrl.accession_number");
  assertSafeDocumentName(input.document, "filingArchiveUrl.document");
  const accnNoDashes = input.accession_number.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${input.cik}/${accnNoDashes}/${input.document}`;
}

export function filingIndexUrl(input: {
  cik: number;
  accession_number: string;
}): string {
  assertCik(input.cik, "filingIndexUrl.cik");
  assertAccession(input.accession_number, "filingIndexUrl.accession_number");
  const accnNoDashes = input.accession_number.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${input.cik}/${accnNoDashes}/${input.accession_number}-index.htm`;
}

function assertCik(value: unknown, label: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new Error(`${label}: must be a positive integer; received ${String(value)}`);
  }
}

function assertAccession(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !ACCESSION_PATTERN.test(value)) {
    throw new Error(`${label}: must match NNNNNNNNNN-NN-NNNNNN; received "${String(value)}"`);
  }
}

function assertSafeDocumentName(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || !SAFE_DOC_NAME_PATTERN.test(value)) {
    throw new Error(`${label}: must match [A-Za-z0-9._-]+ (no slashes, no traversal); received "${String(value)}"`);
  }
}

// ---- HTTP client ----------------------------------------------------------

type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<Response>;

export type SecEdgarClientConfig = {
  userAgent: string;
  fetch?: FetchLike;
  rateLimiter?: RateLimiter;
  now?: () => number;
};

export type FetchFilingInput = {
  cik: number;
  accession_number: string;
  document: string;
};

export type FetchFilingResult = {
  bytes: Uint8Array;
  contentType: string | null;
  retrievedAt: string;
  url: string;
};

export class SecEdgarClient {
  private readonly userAgent: string;
  private readonly fetchImpl: FetchLike;
  private readonly rateLimiter: RateLimiter;
  private readonly now: () => number;

  constructor(config: SecEdgarClientConfig) {
    if (typeof config.userAgent !== "string" || config.userAgent.trim().length === 0) {
      throw new Error(
        'SecEdgarClient: userAgent must be a non-empty string (SEC Fair Access requires identifying contact info, e.g. "Market-Agent/0.1 (ops@example.com)")',
      );
    }
    this.userAgent = config.userAgent;
    this.fetchImpl = config.fetch ?? (globalThis.fetch.bind(globalThis) as FetchLike);
    this.rateLimiter =
      config.rateLimiter ??
      new TokenBucketRateLimiter({
        capacity: SEC_EDGAR_DEFAULT_RATE_LIMIT.capacity,
        refillPerSecond: SEC_EDGAR_DEFAULT_RATE_LIMIT.refillPerSecond,
      });
    this.now = config.now ?? Date.now;
  }

  static fromEnv(envName: string = SEC_EDGAR_DEFAULT_USER_AGENT_ENV): SecEdgarClient {
    const userAgent = process.env[envName];
    if (!userAgent || userAgent.trim().length === 0) {
      throw new Error(
        `SecEdgarClient.fromEnv: ${envName} must be set with a non-empty User-Agent (e.g., "Market-Agent/0.1 (ops@example.com)")`,
      );
    }
    return new SecEdgarClient({ userAgent });
  }

  async fetchFiling(input: FetchFilingInput): Promise<FetchFilingResult> {
    const url = filingArchiveUrl(input);
    await this.rateLimiter.acquire();
    const response = await this.fetchImpl(url, {
      headers: {
        "User-Agent": this.userAgent,
        Accept: "*/*",
      },
    });
    if (response.status === 429) {
      throw new SecEdgarRateLimitError(url, `SEC EDGAR rate-limited request: ${url}`);
    }
    if (!response.ok) {
      throw new SecEdgarFetchError(
        response.status,
        url,
        `SEC EDGAR fetch failed (${response.status}): ${url}`,
      );
    }
    const buffer = new Uint8Array(await response.arrayBuffer());
    return {
      bytes: buffer,
      contentType: response.headers.get("content-type"),
      retrievedAt: new Date(this.now()).toISOString(),
      url,
    };
  }
}

// ---- Orchestrator ---------------------------------------------------------

export type IngestSecFilingDeps = {
  db: QueryExecutor;
  objectStore: ObjectStore;
  secClient: SecEdgarClient;
};

export type IngestSecFilingInput = {
  cik: number;
  accession_number: string;
  document: string;
  // SEC form code, e.g. "10-K", "10-Q", "8-K". Stored as the document
  // title so downstream tooling can route on form-kind without a
  // round-trip to EDGAR's filing index.
  form: string;
};

export type IngestSecFilingResult = {
  source: SourceRow;
  ingest: IngestDocumentResult;
};

export async function ingestSecFiling(
  deps: IngestSecFilingDeps,
  input: IngestSecFilingInput,
): Promise<IngestSecFilingResult> {
  // Fetch first — fail-closed semantics: a 404/5xx must not leave a
  // half-attributed source row pointing at content we never retrieved.
  const fetched = await deps.secClient.fetchFiling({
    cik: input.cik,
    accession_number: input.accession_number,
    document: input.document,
  });

  const source = await createSource(deps.db, {
    provider: "sec_edgar",
    kind: "filing",
    canonical_url: fetched.url,
    trust_tier: "primary",
    license_class: "public",
    retrieved_at: fetched.retrievedAt,
  });

  const ingest = await ingestDocument(
    { db: deps.db, objectStore: deps.objectStore },
    {
      source: { source_id: source.source_id, license_class: source.license_class },
      bytes: fetched.bytes,
      document: {
        kind: "filing",
        provider_doc_id: input.accession_number,
        title: input.form,
      },
    },
  );

  return Object.freeze({ source, ingest });
}

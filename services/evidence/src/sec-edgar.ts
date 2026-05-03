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
import { createSource, deleteSource, type SourceRow } from "./source-repo.ts";
import type { QueryExecutor } from "./types.ts";
import { assertOneOf, assertPositiveInteger } from "./validators.ts";

// SEC Fair Access ceiling: 10 requests/second per IP.
const SEC_RATE_LIMIT_CEILING = 10;

// Conservative default — sub-ceiling to absorb clock-skew and burstiness
// on shared IPs without ever brushing the limit.
export const SEC_EDGAR_DEFAULT_RATE_LIMIT = Object.freeze({
  capacity: 8,
  refillPerSecond: 8,
});

export const SEC_EDGAR_DEFAULT_USER_AGENT_ENV = "SEC_EDGAR_USER_AGENT";

// Default 30s wall-clock cap on a single SEC fetch. Without it, a slow or
// stalled connection would hang the whole ingest orchestrator.
export const SEC_EDGAR_DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

// SEC form codes this adapter accepts. The closed set acts as a typo
// guard at the API boundary; new forms require an explicit add here so
// downstream tooling that branches on form-kind keeps a complete map.
export const SEC_FORM_CODES = Object.freeze([
  "10-K",
  "10-Q",
  "8-K",
  "20-F",
  "6-K",
  "40-F",
] as const);
export type SecFormCode = (typeof SEC_FORM_CODES)[number];

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

export class SecEdgarTimeoutError extends SecEdgarFetchError {
  constructor(url: string, timeoutMs: number) {
    super(0, url, `SEC EDGAR fetch timed out after ${timeoutMs}ms: ${url}`);
    this.name = "SecEdgarTimeoutError";
  }
}

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
  // Tail-promise queue: every acquire chains onto the prior one so two
  // concurrent callers can't both observe an empty bucket, both sleep,
  // and both decrement past zero. Without serialization the limiter
  // would silently allow bursts of N when only 1 token is available —
  // exactly the behavior the SEC ceiling forbids.
  private chain: Promise<unknown> = Promise.resolve();
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
    if (
      typeof config.refillPerSecond !== "number" ||
      config.refillPerSecond <= 0 ||
      config.refillPerSecond > SEC_RATE_LIMIT_CEILING
    ) {
      throw new Error(
        `TokenBucketRateLimiter: refillPerSecond must be > 0 and <= ${SEC_RATE_LIMIT_CEILING} (SEC Fair Access ceiling)`,
      );
    }
    this.capacity = config.capacity;
    this.refillPerSecond = config.refillPerSecond;
    this.now = config.now ?? Date.now;
    this.sleep = config.sleep ?? defaultSleep;
    this.tokens = config.capacity;
    this.lastRefillMs = this.now();
  }

  acquire(): Promise<number> {
    const next = this.chain.then(() => this.acquireOne());
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async acquireOne(): Promise<number> {
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

// Mirrors the regex in services/fundamentals/src/sec-edgar.ts; intentionally
// duplicated to keep evidence and fundamentals decoupled.
const ACCESSION_PATTERN = /^\d{10}-\d{2}-\d{6}$/;
// Filename whitelist guards against path traversal ("../") and any
// caller-supplied subpaths that could redirect the fetch elsewhere on
// sec.gov. The URL builder is the one chokepoint both the client and
// any future helpers go through, so refusing here is sufficient.
const SAFE_DOC_NAME_PATTERN = /^(?!\.{1,2}$)[A-Za-z0-9._-]+$/;

export function filingArchiveUrl(input: {
  cik: number;
  accession_number: string;
  document: string;
}): string {
  assertSafeDocumentName(input.document, "filingArchiveUrl.document");
  return `${archiveBasePath(input.cik, input.accession_number, "filingArchiveUrl")}/${input.document}`;
}

export function filingIndexUrl(input: {
  cik: number;
  accession_number: string;
}): string {
  return `${archiveBasePath(input.cik, input.accession_number, "filingIndexUrl")}/${input.accession_number}-index.htm`;
}

function archiveBasePath(cik: number, accession_number: string, label: string): string {
  assertPositiveInteger(cik, `${label}.cik`);
  assertAccession(accession_number, `${label}.accession_number`);
  const accnNoDashes = accession_number.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${accnNoDashes}`;
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

type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<Response>;

export type SecEdgarClientConfig = {
  userAgent: string;
  fetch?: FetchLike;
  rateLimiter?: RateLimiter;
  now?: () => number;
  requestTimeoutMs?: number;
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
  private readonly requestTimeoutMs: number;

  constructor(config: SecEdgarClientConfig) {
    if (typeof config.userAgent !== "string" || config.userAgent.trim().length === 0) {
      throw new Error(
        'SecEdgarClient: userAgent must be a non-empty string (SEC Fair Access requires identifying contact info, e.g. "Market-Agent/0.1 (ops@example.com)")',
      );
    }
    if (
      config.requestTimeoutMs !== undefined &&
      (!Number.isFinite(config.requestTimeoutMs) || config.requestTimeoutMs <= 0)
    ) {
      throw new Error("SecEdgarClient: requestTimeoutMs must be a positive number");
    }
    this.userAgent = config.userAgent;
    this.fetchImpl = config.fetch ?? (globalThis.fetch.bind(globalThis) as FetchLike);
    this.rateLimiter =
      config.rateLimiter ?? new TokenBucketRateLimiter({ ...SEC_EDGAR_DEFAULT_RATE_LIMIT });
    this.now = config.now ?? Date.now;
    this.requestTimeoutMs = config.requestTimeoutMs ?? SEC_EDGAR_DEFAULT_REQUEST_TIMEOUT_MS;
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
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    let response: Response;
    let buffer: Uint8Array;
    try {
      response = await this.fetchImpl(url, {
        headers: {
          "User-Agent": this.userAgent,
          Accept: "*/*",
        },
        signal: controller.signal,
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
      buffer = new Uint8Array(await response.arrayBuffer());
    } catch (err) {
      if (controller.signal.aborted) {
        throw new SecEdgarTimeoutError(url, this.requestTimeoutMs);
      }
      throw err;
    } finally {
      clearTimeout(timeoutHandle);
    }
    return {
      bytes: buffer,
      contentType: response.headers.get("content-type"),
      retrievedAt: new Date(this.now()).toISOString(),
      url,
    };
  }
}

export type IngestSecFilingDeps = {
  db: QueryExecutor;
  objectStore: ObjectStore;
  secClient: SecEdgarClient;
};

export type IngestSecFilingInput = {
  cik: number;
  accession_number: string;
  document: string;
  // Stored as the document title so downstream tooling can route on
  // form-kind without a round-trip to EDGAR's filing index.
  form: SecFormCode;
};

export type IngestSecFilingResult = {
  source: SourceRow;
  ingest: IngestDocumentResult;
};

export async function ingestSecFiling(
  deps: IngestSecFilingDeps,
  input: IngestSecFilingInput,
): Promise<IngestSecFilingResult> {
  assertOneOf(input.form, SEC_FORM_CODES, "ingestSecFiling.form");
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

  let ingest: IngestDocumentResult;
  try {
    ingest = await ingestDocument(
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
  } catch (err) {
    await cleanupSourceAfterFailedIngest(deps.db, source.source_id, err);
  }

  return Object.freeze({ source, ingest });
}

async function cleanupSourceAfterFailedIngest(
  db: QueryExecutor,
  sourceId: string,
  ingestError: unknown,
): Promise<never> {
  try {
    await deleteSource(db, sourceId);
  } catch (cleanupError) {
    throw new AggregateError(
      [ingestError, cleanupError],
      `ingest failed and source cleanup failed for ${sourceId}`,
    );
  }
  throw ingestError;
}

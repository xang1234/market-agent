import { createHash } from "node:crypto";

import type { OperationRunner, SearchProvider, SearchResult } from "../ports.ts";
import type { SearchHit } from "../types.ts";
import { ProviderRequestError } from "./errors.ts";

const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const BRAVE_RESULT_COUNT = 10;
const MAX_DESCRIPTION_LENGTH = 1_000;

export { ProviderRequestError } from "./errors.ts";

export type BraveSearchProviderOptions = {
  apiKey: string;
  fetch: typeof fetch;
  now?: () => Date;
};

type BraveResult = { title?: unknown; url?: unknown; description?: unknown };
type BravePayload = { web?: { results?: unknown; total?: unknown } };

export function createBraveSearchProvider(options: BraveSearchProviderOptions): SearchProvider {
  const apiKey = options.apiKey.trim();
  const now = options.now ?? (() => new Date());

  return Object.freeze({
    async search(input, operations): Promise<SearchResult> {
      validateQuery(input.query);
      if (!apiKey) {
        throw new ProviderRequestError("missing_configuration", "Brave search is not configured");
      }
      return operations.run({
        key: input.operation_key,
        request_hash: input.request_hash,
        resource: "search",
        phase: input.phase,
        candidate_id: input.candidate_id,
        execute: async ({ signal }) => {
          const url = new URL(BRAVE_SEARCH_URL);
          url.searchParams.set("q", input.query);
          url.searchParams.set("count", String(BRAVE_RESULT_COUNT));
          url.searchParams.set("country", "US");
          url.searchParams.set("search_lang", "en");

          let response: Response;
          try {
            response = await options.fetch(url, {
              headers: {
                Accept: "application/json",
                "X-Subscription-Token": apiKey,
              },
              signal,
            });
          } catch (error) {
            if (signal.aborted) throw new ProviderRequestError("timeout", "Brave search request timed out");
            throw error;
          }
          throwForStatus(response.status);
          const payload = await parsePayload(response);
          const hits = decodeHits(payload, input.query_index, now());
          if (hits.length === 0) {
            throw new ProviderRequestError("invalid_response", "Brave search returned no valid HTTPS lead results");
          }
          return {
            hits,
            hits_truncated: truncationCount(payload, hits.length),
          };
        },
      });
    },
  });
}

function validateQuery(query: string): void {
  if (typeof query !== "string" || query.length === 0 || query.length > 600 || query.split(/\s+/u).length > 75) {
    throw new ProviderRequestError("invalid_response", "Search query must contain at most 600 characters and 75 words");
  }
}

function throwForStatus(status: number): void {
  if (status === 401 || status === 403) throw new ProviderRequestError("unauthorized", "Brave search authorization failed");
  if (status === 429) throw new ProviderRequestError("rate_limited", "Brave search rate limit reached");
  if (status >= 500) throw new ProviderRequestError("unavailable", "Brave search is temporarily unavailable");
  if (status < 200 || status >= 300) throw new ProviderRequestError("invalid_response", `Brave search returned HTTP ${status}`);
}

async function parsePayload(response: Response): Promise<BravePayload> {
  try {
    const value = await response.json();
    if (!isRecord(value)) throw new Error("not an object");
    return value as BravePayload;
  } catch {
    throw new ProviderRequestError("invalid_response", "Brave search returned invalid JSON");
  }
}

function decodeHits(payload: BravePayload, queryIndex: number, retrievedAt: Date): SearchHit[] {
  if (!Array.isArray(payload.web?.results)) {
    throw new ProviderRequestError("invalid_response", "Brave search response did not include web results");
  }
  const hits: SearchHit[] = [];
  for (const [result_index, raw] of payload.web.results.entries()) {
    const result = raw as BraveResult;
    if (!isNonEmptyString(result.title) || !isNonEmptyString(result.url) || typeof result.description !== "string") continue;
    const url = httpsUrl(result.url);
    if (!url) continue;
    hits.push(Object.freeze({
      hit_id: stableUuid(`${queryIndex}\u0000${result_index}\u0000${url}`),
      query_index: queryIndex,
      result_index,
      title: result.title.trim(),
      url,
      description: result.description.slice(0, MAX_DESCRIPTION_LENGTH),
      retrieved_at: retrievedAt.toISOString(),
    }));
  }
  return hits;
}

function truncationCount(payload: BravePayload, retained: number): number | null {
  const total = payload.web?.total;
  if (typeof total === "number" && Number.isInteger(total) && total >= retained) return total - retained;
  // A short page proves there were fewer results than the requested bound. A full
  // page has no documented total in the Brave response, so never invent one.
  return retained < BRAVE_RESULT_COUNT ? 0 : null;
}

function stableUuid(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex").split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const raw = hex.join("");
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20, 32)}`;
}

function httpsUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

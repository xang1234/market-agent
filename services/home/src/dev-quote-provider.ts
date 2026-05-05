import type { ListingSubjectRef } from "../../market/src/subject-ref.ts";

import type { HomeQuoteProvider, HomeQuoteResult } from "./secondary-types.ts";

export const DEFAULT_MARKET_QUOTE_TIMEOUT_MS = 5_000;

export function createLiveQuoteProvider(
  marketOrigin: string,
  options: { timeoutMs?: number } = {},
): HomeQuoteProvider {
  const timeoutMs = options.timeoutMs ?? DEFAULT_MARKET_QUOTE_TIMEOUT_MS;
  return async (refs: ReadonlyArray<ListingSubjectRef>): Promise<ReadonlyArray<HomeQuoteResult>> => {
    if (refs.length === 0) return [];
    const settled = await Promise.allSettled(refs.map((ref) => fetchQuote(marketOrigin, ref, timeoutMs)));
    const results: HomeQuoteResult[] = [];
    for (const entry of settled) {
      if (entry.status === "fulfilled" && entry.value !== null) results.push(entry.value);
    }
    return results;
  };
}

async function fetchQuote(
  marketOrigin: string,
  ref: ListingSubjectRef,
  timeoutMs: number,
): Promise<HomeQuoteResult | null> {
  const url = new URL("/v1/market/quote", marketOrigin);
  url.searchParams.set("subject_kind", "listing");
  url.searchParams.set("subject_id", ref.id);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    void response.body?.cancel();
    return null;
  }

  try {
    const body = (await response.json()) as Partial<HomeQuoteResult> & {
      unavailable?: unknown;
    };
    if (body.unavailable !== undefined || !body.quote || !body.listing_context) {
      return null;
    }
    return { quote: body.quote, listing_context: body.listing_context } as HomeQuoteResult;
  } catch {
    void response.body?.cancel();
    return null;
  }
}

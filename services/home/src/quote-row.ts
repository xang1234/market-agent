import type { ListingSubjectRef } from "../../market/src/subject-ref.ts";

import { HomeFindingFeedError } from "./finding-feed-repo.ts";
import type { HomeQuoteResult, HomeQuoteRow } from "./secondary-types.ts";

export function quoteRow(
  listing: ListingSubjectRef,
  result: HomeQuoteResult,
): HomeQuoteRow {
  const quote = result.quote;
  const context = result.listing_context;
  if (typeof context?.ticker !== "string" || context.ticker.trim() === "") {
    throw new HomeFindingFeedError("listing_context.ticker must be a non-empty string");
  }
  if (typeof context.mic !== "string" || context.mic.trim() === "") {
    throw new HomeFindingFeedError("listing_context.mic must be a non-empty string");
  }
  return Object.freeze({
    listing: Object.freeze({ kind: "listing", id: listing.id }),
    ticker: context.ticker,
    mic: context.mic,
    price: quote.price,
    prev_close: quote.prev_close,
    change_abs: quote.change_abs,
    change_pct: quote.change_pct,
    session_state: quote.session_state,
    delay_class: quote.delay_class,
    as_of: quote.as_of,
    currency: quote.currency,
  });
}

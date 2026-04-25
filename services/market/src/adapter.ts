import type { ListingSubjectRef, UUID } from "./subject-ref.ts";

// Provider-neutral market records. Per spec §6.2.1, every quote and bar carries
// `as_of`, `delay_class`, `currency`, and `source_id`; bars also carry
// `adjustment_basis` whenever the response has crossed an adjustment boundary.

// Quote contract lives in ./quote.ts (fra-cw0.1.2 owns the smart constructor +
// schema assertion). Re-exported here so adapter implementers and consumers
// have a single import surface.
export {
  assertQuoteContract,
  DELAY_CLASSES,
  normalizedQuote,
  SESSION_STATES,
  type DelayClass,
  type NormalizedQuote,
  type NormalizedQuoteInput,
  type SessionState,
} from "./quote.ts";

import type { DelayClass } from "./quote.ts";

// Bar contract is intentionally still thin — fra-cw0.1.3 will tighten it the
// same way ./quote.ts does for quotes (smart constructor, schema assertion).

export type AdjustmentBasis =
  | "unadjusted"
  | "split_adjusted"
  | "split_and_div_adjusted";

export type BarInterval =
  | "1m"
  | "5m"
  | "15m"
  | "1h"
  | "1d";

export type NormalizedBar = {
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type BarRange = {
  // Half-open [start, end). `end` is exclusive so callers can request the
  // current session without ambiguity about whether the latest forming bar is
  // included.
  start: string;
  end: string;
};

export type NormalizedBars = {
  listing: ListingSubjectRef;
  interval: BarInterval;
  range: BarRange;
  bars: NormalizedBar[];
  as_of: string;
  delay_class: DelayClass;
  currency: string;
  source_id: UUID;
  adjustment_basis: AdjustmentBasis;
};

import type { NormalizedQuote } from "./quote.ts";

export type QuoteRequest = {
  listing: ListingSubjectRef;
};

export type BarsRequest = {
  listing: ListingSubjectRef;
  interval: BarInterval;
  range: BarRange;
};

// Provider seam. Concrete adapters translate vendor payloads into the
// normalized shapes above and must not surface vendor-typed fields, error
// strings, or rate-limit envelopes to consumers.
//
// Availability outcomes (provider failure, missing coverage, stale data) will
// be wrapped at the service layer in fra-cw0.1.4. Until that lands, adapters
// throw on hard failures and consumers treat thrown errors as "adapter failed";
// no caller should branch on vendor error codes.
export type MarketDataAdapter = {
  readonly providerName: string;
  readonly sourceId: UUID;
  getQuote(request: QuoteRequest): Promise<NormalizedQuote>;
  getBars(request: BarsRequest): Promise<NormalizedBars>;
};

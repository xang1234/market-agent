import type { ListingSubjectRef, UUID } from "./subject-ref.ts";
import type { NormalizedQuote } from "./quote.ts";
import type { BarInterval, BarRange, NormalizedBars } from "./bar.ts";

export {
  assertQuoteContract,
  DELAY_CLASSES,
  normalizedQuote,
  quoteMove,
  SESSION_STATES,
  type DelayClass,
  type NormalizedQuote,
  type NormalizedQuoteInput,
  type SessionState,
} from "./quote.ts";

export {
  ADJUSTMENT_BASES,
  assertBarsContract,
  BAR_INTERVALS,
  normalizedBars,
  type AdjustmentBasis,
  type BarInterval,
  type BarRange,
  type NormalizedBar,
  type NormalizedBars,
} from "./bar.ts";

export {
  applyCorporateActions,
  corporateAction,
  CORPORATE_ACTION_KINDS,
  type CashDividend,
  type CorporateAction,
  type CorporateActionKind,
  type SpinOff,
  type Split,
  type StockDividend,
} from "./corporate-actions.ts";

export type QuoteRequest = {
  listing: ListingSubjectRef;
};

export type BarsRequest = {
  listing: ListingSubjectRef;
  interval: BarInterval;
  range: BarRange;
};

export type MarketDataAdapter = {
  readonly providerName: string;
  readonly sourceId: UUID;
  getQuote(request: QuoteRequest): Promise<NormalizedQuote>;
  getBars(request: BarsRequest): Promise<NormalizedBars>;
};

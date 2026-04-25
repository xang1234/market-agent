import type { ListingSubjectRef, UUID } from "./subject-ref.ts";
import {
  assertCurrency,
  assertFinitePositive,
  assertIso8601Utc,
  assertOneOf,
  assertUuid,
} from "./validators.ts";

export type DelayClass =
  | "real_time"
  | "delayed_15m"
  | "eod"
  | "unknown";

export const DELAY_CLASSES: ReadonlyArray<DelayClass> = [
  "real_time",
  "delayed_15m",
  "eod",
  "unknown",
];

export type SessionState =
  | "pre_market"
  | "regular"
  | "post_market"
  | "closed";

export const SESSION_STATES: ReadonlyArray<SessionState> = [
  "pre_market",
  "regular",
  "post_market",
  "closed",
];

export type NormalizedQuote = {
  listing: ListingSubjectRef;
  price: number;
  prev_close: number;
  change_abs: number;
  change_pct: number;
  session_state: SessionState;
  as_of: string;
  delay_class: DelayClass;
  currency: string;
  source_id: UUID;
};

export type NormalizedQuoteInput = Omit<NormalizedQuote, "change_abs" | "change_pct">;

export function normalizedQuote(input: NormalizedQuoteInput): NormalizedQuote {
  if (input.listing?.kind !== "listing") {
    throw new Error("normalizedQuote: listing must be a listing SubjectRef");
  }
  assertFinitePositive(input.price, "normalizedQuote.price");
  assertFinitePositive(input.prev_close, "normalizedQuote.prev_close");
  assertOneOf(input.session_state, SESSION_STATES, "normalizedQuote.session_state");
  assertIso8601Utc(input.as_of, "normalizedQuote.as_of");
  assertOneOf(input.delay_class, DELAY_CLASSES, "normalizedQuote.delay_class");
  assertCurrency(input.currency, "normalizedQuote.currency");
  assertUuid(input.source_id, "normalizedQuote.source_id");

  const change_abs = input.price - input.prev_close;
  const change_pct = change_abs / input.prev_close;

  return Object.freeze({
    listing: Object.freeze({
      kind: input.listing.kind,
      id: input.listing.id,
    }),
    price: input.price,
    prev_close: input.prev_close,
    change_abs,
    change_pct,
    session_state: input.session_state,
    as_of: input.as_of,
    delay_class: input.delay_class,
    currency: input.currency,
    source_id: input.source_id,
  });
}

export function quoteMove(q: NormalizedQuote): Pick<NormalizedQuote, "change_abs" | "change_pct"> {
  return { change_abs: q.change_abs, change_pct: q.change_pct };
}

export function assertQuoteContract(value: unknown): asserts value is NormalizedQuote {
  if (value === null || typeof value !== "object") {
    throw new Error("quote: must be an object");
  }
  const q = value as Record<string, unknown>;

  if (
    !q.listing ||
    typeof q.listing !== "object" ||
    (q.listing as { kind?: unknown }).kind !== "listing" ||
    typeof (q.listing as { id?: unknown }).id !== "string"
  ) {
    throw new Error("quote.listing: must be a listing SubjectRef with string id");
  }

  assertFinitePositive(q.price, "quote.price");
  assertFinitePositive(q.prev_close, "quote.prev_close");
  assertFiniteNumber(q.change_abs, "quote.change_abs");
  assertFiniteNumber(q.change_pct, "quote.change_pct");
  const expectedAbs = q.price - q.prev_close;
  const expectedPct = expectedAbs / q.prev_close;
  if (!nearlyEqual(q.change_abs, expectedAbs)) {
    throw new Error(`quote.change_abs: ${q.change_abs} disagrees with price - prev_close (${expectedAbs})`);
  }
  if (!nearlyEqual(q.change_pct, expectedPct)) {
    throw new Error(`quote.change_pct: ${q.change_pct} disagrees with change_abs / prev_close (${expectedPct})`);
  }
  assertOneOf(q.session_state, SESSION_STATES, "quote.session_state");
  assertIso8601Utc(q.as_of, "quote.as_of");
  assertOneOf(q.delay_class, DELAY_CLASSES, "quote.delay_class");
  assertCurrency(q.currency, "quote.currency");
  assertUuid(q.source_id, "quote.source_id");
}

function assertFiniteNumber(n: unknown, label: string): asserts n is number {
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new Error(`${label}: must be a finite number; received ${String(n)}`);
  }
}

function nearlyEqual(a: number, b: number): boolean {
  if (a === b) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) / scale < 1e-9;
}

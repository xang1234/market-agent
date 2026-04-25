import type { ListingSubjectRef, UUID } from "./subject-ref.ts";

// Quote contract (fra-cw0.1.2). Spec §6.2.1: every normalized quote carries
// `as_of`, `delay_class`, `currency`, `source_id`, plus latest price, absolute
// move, percentage move, and a freshness / session-state signal.
//
// This module is the only legitimate way to construct a `NormalizedQuote`.
// Adapters call `normalizedQuote(...)` so a quote that violates the contract
// throws at the boundary instead of leaking malformed data downstream. The
// public `assertQuoteContract` helper lets contract tests re-assert the same
// invariants for any adapter, which is the bead's verification clause.

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
  as_of: string; // ISO-8601 UTC (must end in 'Z' or have an explicit offset)
  delay_class: DelayClass;
  currency: string; // ISO 4217 (3 uppercase letters)
  source_id: UUID;
};

export type NormalizedQuoteInput = {
  listing: ListingSubjectRef;
  price: number;
  prev_close: number;
  session_state: SessionState;
  as_of: string;
  delay_class: DelayClass;
  currency: string;
  source_id: UUID;
};

const ISO_8601_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
const CURRENCY_4217 = /^[A-Z]{3}$/;
const UUID_V4 =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

export function normalizedQuote(input: NormalizedQuoteInput): NormalizedQuote {
  if (input.listing?.kind !== "listing") {
    throw new Error("normalizedQuote: listing must be a listing SubjectRef");
  }
  assertFinitePositive(input.price, "price");
  assertFinitePositive(input.prev_close, "prev_close");
  assertSessionState(input.session_state);
  assertIso8601Utc(input.as_of, "as_of");
  assertDelayClass(input.delay_class);
  assertCurrency(input.currency);
  assertUuid(input.source_id, "source_id");

  const change_abs = input.price - input.prev_close;
  const change_pct = change_abs / input.prev_close;

  return Object.freeze({
    listing: input.listing,
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

// Schema assertion. Re-asserts every contract invariant against an
// already-constructed quote — used by contract tests to verify any adapter
// (not just ones that go through `normalizedQuote`) emits conformant records.
// The bead's verification clause: "Schema assertion in contract tests."
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

  for (const key of ["price", "prev_close", "change_abs", "change_pct"] as const) {
    if (typeof q[key] !== "number" || !Number.isFinite(q[key])) {
      throw new Error(`quote.${key}: must be a finite number`);
    }
  }
  if ((q.price as number) <= 0) {
    throw new Error("quote.price: must be > 0");
  }
  if ((q.prev_close as number) <= 0) {
    throw new Error("quote.prev_close: must be > 0");
  }

  // Move-math invariants: change_abs == price - prev_close, change_pct == change_abs / prev_close.
  // Allow tiny float drift (1e-9 relative) to tolerate adapter-side rounding.
  const expectedAbs = (q.price as number) - (q.prev_close as number);
  const expectedPct = expectedAbs / (q.prev_close as number);
  if (!nearlyEqual(q.change_abs as number, expectedAbs)) {
    throw new Error(
      `quote.change_abs: ${q.change_abs} disagrees with price - prev_close (${expectedAbs})`,
    );
  }
  if (!nearlyEqual(q.change_pct as number, expectedPct)) {
    throw new Error(
      `quote.change_pct: ${q.change_pct} disagrees with change_abs / prev_close (${expectedPct})`,
    );
  }

  if (typeof q.session_state !== "string" || !SESSION_STATES.includes(q.session_state as SessionState)) {
    throw new Error(`quote.session_state: must be one of ${SESSION_STATES.join(", ")}`);
  }

  assertIso8601Utc(q.as_of, "quote.as_of");
  if (typeof q.delay_class !== "string" || !DELAY_CLASSES.includes(q.delay_class as DelayClass)) {
    throw new Error(`quote.delay_class: must be one of ${DELAY_CLASSES.join(", ")}`);
  }
  assertCurrency(q.currency);
  assertUuid(q.source_id, "quote.source_id");
}

function assertFinitePositive(n: unknown, label: string): asserts n is number {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) {
    throw new Error(`normalizedQuote.${label}: must be a finite positive number; received ${String(n)}`);
  }
}

function assertSessionState(s: unknown): asserts s is SessionState {
  if (typeof s !== "string" || !SESSION_STATES.includes(s as SessionState)) {
    throw new Error(
      `normalizedQuote.session_state: must be one of ${SESSION_STATES.join(", ")}; received ${String(s)}`,
    );
  }
}

function assertDelayClass(s: unknown): asserts s is DelayClass {
  if (typeof s !== "string" || !DELAY_CLASSES.includes(s as DelayClass)) {
    throw new Error(
      `normalizedQuote.delay_class: must be one of ${DELAY_CLASSES.join(", ")}; received ${String(s)}`,
    );
  }
}

function assertIso8601Utc(s: unknown, label: string): asserts s is string {
  if (typeof s !== "string" || !ISO_8601_UTC.test(s) || !Number.isFinite(Date.parse(s))) {
    throw new Error(`${label}: must be an ISO-8601 timestamp with explicit Z or offset; received ${String(s)}`);
  }
}

function assertCurrency(s: unknown): asserts s is string {
  if (typeof s !== "string" || !CURRENCY_4217.test(s)) {
    throw new Error(`currency: must be a 3-letter ISO 4217 code; received ${String(s)}`);
  }
}

function assertUuid(s: unknown, label: string): asserts s is string {
  if (typeof s !== "string" || !UUID_V4.test(s)) {
    throw new Error(`${label}: must be a UUID v4; received ${String(s)}`);
  }
}

function nearlyEqual(a: number, b: number): boolean {
  if (a === b) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) / scale < 1e-9;
}

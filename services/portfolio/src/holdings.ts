// Holdings bind to canonical market identity ONLY. The DB column accepts the
// full subject_kind enum (the column type is reused by polymorphic tables like
// watchlist_members and theme_memberships); the rule that a holding can only
// reference an `instrument` or a `listing` lives here, in application code.
// Rejecting `theme` / `screen` / `portfolio` at this seam is the contract that
// keeps overlay math honest (spec §4.2.1).

import type { UUID } from "./portfolio.ts";
import {
  assertFiniteNumber,
  assertIso8601Utc,
  assertUuid,
} from "./validators.ts";

export const HOLDING_SUBJECT_KINDS = ["instrument", "listing"] as const;
export type HoldingSubjectKind = (typeof HOLDING_SUBJECT_KINDS)[number];

export type HoldingSubjectRef = {
  kind: HoldingSubjectKind;
  id: UUID;
};

export type PortfolioHolding = {
  portfolio_holding_id: UUID;
  portfolio_id: UUID;
  subject_ref: HoldingSubjectRef;
  quantity: number;
  cost_basis: number | null;
  opened_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PortfolioHoldingCreateInput = {
  subject_ref: HoldingSubjectRef;
  quantity: number;
  cost_basis?: number | null;
  opened_at?: string | null;
  closed_at?: string | null;
};

export function isHoldingSubjectKind(value: unknown): value is HoldingSubjectKind {
  return (
    typeof value === "string" &&
    (HOLDING_SUBJECT_KINDS as readonly string[]).includes(value)
  );
}

export function assertHoldingSubjectRef(
  value: unknown,
  label = "subject_ref",
): asserts value is HoldingSubjectRef {
  if (value === null || typeof value !== "object") {
    throw new Error(`${label}: must be an object with kind and id`);
  }
  const obj = value as Record<string, unknown>;
  if (!isHoldingSubjectKind(obj.kind)) {
    throw new Error(
      `${label}.kind: must be one of ${HOLDING_SUBJECT_KINDS.join(", ")}; received ${String(obj.kind)}`,
    );
  }
  assertUuid(obj.id, `${label}.id`);
}

function assertOptional(
  value: unknown,
  label: string,
  assertValue: (v: unknown, l: string) => void,
): void {
  if (value === undefined || value === null) return;
  assertValue(value, label);
}

export function assertPortfolioHoldingCreateInput(
  raw: unknown,
): asserts raw is PortfolioHoldingCreateInput {
  if (raw === null || typeof raw !== "object") {
    throw new Error("holding: request body must be an object");
  }
  const obj = raw as Record<string, unknown>;
  assertHoldingSubjectRef(obj.subject_ref, "holding.subject_ref");
  assertFiniteNumber(obj.quantity, "holding.quantity");
  assertOptional(obj.cost_basis, "holding.cost_basis", assertFiniteNumber);
  assertOptional(obj.opened_at, "holding.opened_at", assertIso8601Utc);
  assertOptional(obj.closed_at, "holding.closed_at", assertIso8601Utc);
}

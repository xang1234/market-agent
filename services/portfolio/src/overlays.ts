// Overlay inputs are a read model derived from holdings, NOT a new canonical
// subject (spec §3.16, §4.2.1). Each entry is keyed by `(subject_ref,
// contributing portfolio_id)`; multiple portfolios holding the same subject
// with different `base_currency` values produce distinct contributions —
// this layer never silently nets across currencies through an implicit FX
// step. Consumers that want a single number must apply their own FX policy.

import {
  assertHoldingSubjectRef,
  type HoldingSubjectRef,
} from "./holdings.ts";
import type { UUID } from "./portfolio.ts";

// Bound the bulk-read fan-out so a single client request can't drag the
// server through tens of thousands of holdings rows.
export const OVERLAY_INPUTS_MAX_SUBJECTS = 100;

export type HeldState = "open" | "closed";

export type OverlayContribution = {
  portfolio_id: UUID;
  portfolio_name: string;
  base_currency: string;
  quantity: number;
  cost_basis: number | null;
  held_state: HeldState;
  opened_at: string | null;
  closed_at: string | null;
};

export type SubjectOverlayInputs = {
  subject_ref: HoldingSubjectRef;
  contributions: ReadonlyArray<OverlayContribution>;
};

export type OverlayInputsRequest = {
  subject_refs: ReadonlyArray<HoldingSubjectRef>;
};

export function assertOverlayInputsRequest(
  raw: unknown,
): asserts raw is OverlayInputsRequest {
  if (raw === null || typeof raw !== "object") {
    throw new Error("overlay-inputs: request body must be an object");
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.subject_refs)) {
    throw new Error("overlay-inputs.subject_refs: must be an array");
  }
  if (obj.subject_refs.length === 0) {
    throw new Error("overlay-inputs.subject_refs: must not be empty");
  }
  if (obj.subject_refs.length > OVERLAY_INPUTS_MAX_SUBJECTS) {
    throw new Error(
      `overlay-inputs.subject_refs: must be <= ${OVERLAY_INPUTS_MAX_SUBJECTS} items; received ${obj.subject_refs.length}`,
    );
  }
  obj.subject_refs.forEach((ref, i) => {
    assertHoldingSubjectRef(ref, `overlay-inputs.subject_refs[${i}]`);
  });
}

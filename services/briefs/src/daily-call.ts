import {
  DECISION_HORIZONS,
  assertPublicSubjectRef,
  type DecisionHorizon,
  type PublicSubjectRef,
} from "../../shared/src/subject-ref.ts";
import {
  assertIsoDateTime,
  assertNonEmptyString,
  assertUuid,
} from "../../shared/src/validators.ts";

export const DAILY_CALL_STATUSES = ["draft", "published"] as const;
export type DailyCallStatus = (typeof DAILY_CALL_STATUSES)[number];

export type DailyCallDraftInput = {
  brief_id: string;
  snapshot_id: string;
  as_of: string;
  commodity_refs: ReadonlyArray<PublicSubjectRef & { kind: "commodity" }>;
  narrative: string;
  driver_ids: ReadonlyArray<string>;
  watch_items: ReadonlyArray<string>;
};

export type DailyCallBrief = {
  brief_id: string;
  snapshot_id: string;
  status: DailyCallStatus;
  as_of: string;
  commodity_refs: ReadonlyArray<PublicSubjectRef & { kind: "commodity" }>;
  narrative: string;
  driver_ids: ReadonlyArray<string>;
  watch_items: ReadonlyArray<string>;
  horizons: ReadonlyArray<DecisionHorizon>;
  requires_analyst_signoff: boolean;
  reviewer_user_id?: string;
  published_at?: string;
};

export type PublishDailyCallInput = {
  reviewer_user_id: string;
  published_at: string;
};

export function buildDailyCallDraft(input: DailyCallDraftInput): DailyCallBrief {
  assertNonEmptyString(input.brief_id, "daily_call.brief_id");
  assertUuid(input.snapshot_id, "daily_call.snapshot_id");
  assertIsoDateTime(input.as_of, "daily_call.as_of");
  const commodity_refs = freezeCommodityRefs(input.commodity_refs);
  assertNonEmptyString(input.narrative, "daily_call.narrative");
  const driver_ids = freezeStringArray(input.driver_ids, "daily_call.driver_ids", { allowEmpty: false });
  const watch_items = freezeStringArray(input.watch_items, "daily_call.watch_items", { allowEmpty: true });

  return Object.freeze({
    brief_id: input.brief_id.trim(),
    snapshot_id: input.snapshot_id,
    status: "draft",
    as_of: input.as_of,
    commodity_refs,
    narrative: input.narrative.trim(),
    driver_ids,
    watch_items,
    horizons: Object.freeze([...DECISION_HORIZONS]),
    requires_analyst_signoff: true,
  });
}

export function publishDailyCall(draft: DailyCallBrief, input: PublishDailyCallInput): DailyCallBrief {
  if (draft.status !== "draft") throw new Error("daily_call must be in draft status before publishing");
  assertUuid(input.reviewer_user_id, "daily_call.reviewer_user_id");
  assertIsoDateTime(input.published_at, "daily_call.published_at");

  return Object.freeze({
    ...draft,
    status: "published",
    reviewer_user_id: input.reviewer_user_id,
    published_at: input.published_at,
  });
}

function freezeCommodityRefs(value: unknown): ReadonlyArray<PublicSubjectRef & { kind: "commodity" }> {
  if (!Array.isArray(value) || value.length === 0) throw new Error("daily_call.commodity_refs must be a non-empty array");
  const seen = new Set<string>();
  return Object.freeze(value.map((item, index) => {
    assertPublicSubjectRef(item, `daily_call.commodity_refs[${index}]`);
    if (item.kind !== "commodity") throw new Error(`daily_call.commodity_refs[${index}].kind must be commodity`);
    if (seen.has(item.id)) throw new Error(`daily_call.commodity_refs[${index}] is a duplicate`);
    seen.add(item.id);
    return Object.freeze({ kind: "commodity" as const, id: item.id });
  }));
}

function freezeStringArray(
  value: unknown,
  label: string,
  options: { allowEmpty: boolean },
): ReadonlyArray<string> {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  if (!options.allowEmpty && value.length === 0) throw new Error(`${label} must be non-empty`);
  return Object.freeze(value.map((item, index) => {
    assertNonEmptyString(item, `${label}[${index}]`);
    return item.trim();
  }));
}

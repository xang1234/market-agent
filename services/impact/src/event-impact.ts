import {
  assertPublicSubjectRef,
  type PublicSubjectRef,
} from "../../shared/src/subject-ref.ts";
import {
  IMPACT_CHANNELS,
  IMPACT_DIRECTIONS,
  IMPACT_DRIVER_TYPES,
  IMPACT_HORIZONS,
  type ImpactChannel,
  type ImpactDirection,
  type ImpactDriverType,
  type ImpactHorizon,
} from "../../shared/src/impact-vocabulary.ts";
import {
  assertNonEmptyString,
  assertOneOf,
  assertUnitInterval,
  freezeUuidArray,
  roundTo,
} from "../../shared/src/validators.ts";

export { IMPACT_CHANNELS, IMPACT_DIRECTIONS };
export type { ImpactChannel, ImpactDirection };
export const DRIVER_TYPES = IMPACT_DRIVER_TYPES;
export type DriverType = ImpactDriverType;

export type ImpactDriverInput = {
  driver_id: string;
  subject_refs: ReadonlyArray<PublicSubjectRef>;
  event_refs: ReadonlyArray<string>;
  claim_refs: ReadonlyArray<string>;
  channel: ImpactChannel;
  direction: ImpactDirection;
  horizon: ImpactHorizon;
  driver_type: DriverType;
  confidence: number;
  magnitude: number;
  summary: string;
};

export type ImpactDriver = Readonly<ImpactDriverInput & {
  priority_score: number;
}>;

const CHANNEL_WEIGHT: Readonly<Record<ImpactChannel, number>> = Object.freeze({
  supply: 0.95,
  demand: 0.9,
  inventory: 0.88,
  curve_structure: 0.86,
  freight: 0.82,
  policy: 0.84,
  macro_fx: 0.55,
  weather: 0.76,
  disruption: 0.9,
});

const HORIZON_WEIGHT: Readonly<Record<ImpactHorizon, number>> = Object.freeze({
  "1d": 0.95,
  "1w": 0.86,
  "1m": 0.75,
  "3m": 0.55,
});

export function normalizeImpactDriver(input: ImpactDriverInput): ImpactDriver {
  assertNonEmptyString(input.driver_id, "impact.driver_id");
  const subject_refs = freezeSubjectRefs(input.subject_refs, "impact.subject_refs");
  const event_refs = freezeUuidArray(input.event_refs, "impact.event_refs");
  const claim_refs = freezeUuidArray(input.claim_refs, "impact.claim_refs");
  assertOneOf(input.channel, IMPACT_CHANNELS, "impact.channel");
  assertOneOf(input.direction, IMPACT_DIRECTIONS, "impact.direction");
  assertOneOf(input.horizon, IMPACT_HORIZONS, "impact.horizon");
  assertOneOf(input.driver_type, DRIVER_TYPES, "impact.driver_type");
  assertUnitInterval(input.confidence, "impact.confidence");
  assertUnitInterval(input.magnitude, "impact.magnitude");
  assertNonEmptyString(input.summary, "impact.summary");

  return Object.freeze({
    driver_id: input.driver_id.trim(),
    subject_refs,
    event_refs,
    claim_refs,
    channel: input.channel,
    direction: input.direction,
    horizon: input.horizon,
    driver_type: input.driver_type,
    confidence: input.confidence,
    magnitude: input.magnitude,
    summary: input.summary.trim(),
    priority_score: priorityScore(input),
  });
}

export function rankImpactDrivers(drivers: ReadonlyArray<ImpactDriver>): ReadonlyArray<ImpactDriver> {
  return Object.freeze([...drivers].sort((left, right) => {
    if (right.priority_score !== left.priority_score) return right.priority_score - left.priority_score;
    return left.driver_id.localeCompare(right.driver_id);
  }));
}

function priorityScore(input: Pick<ImpactDriverInput, "channel" | "horizon" | "confidence" | "magnitude">): number {
  return round2(
    input.confidence * 0.35 +
      input.magnitude * 0.32 +
      CHANNEL_WEIGHT[input.channel] * 0.14 +
      HORIZON_WEIGHT[input.horizon] * 0.14,
  );
}

function freezeSubjectRefs(value: unknown, label: string): ReadonlyArray<PublicSubjectRef> {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} must be a non-empty array`);
  return Object.freeze(value.map((item, index) => {
    assertPublicSubjectRef(item, `${label}[${index}]`);
    return Object.freeze({ kind: item.kind, id: item.id });
  }));
}

function round2(value: number): number {
  return roundTo(value, 2);
}

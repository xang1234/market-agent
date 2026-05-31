import {
  assertPublicSubjectRef,
  type DecisionHorizon,
  type PublicSubjectRef,
} from "../../shared/src/subject-ref.ts";
import { IMPACT_HORIZONS } from "../../shared/src/impact-vocabulary.ts";
import {
  assertFiniteNumber,
  assertIsoDateTime,
  assertNonEmptyString,
  assertOneOf,
  assertUnitInterval,
  freezeUuidArray,
  roundTo,
} from "../../shared/src/validators.ts";

export const BALANCE_CHANNELS = [
  "mine_supply",
  "disruption",
  "inventory",
  "port_stock",
  "smelter_margin",
  "steel_margin",
  "trade_flow",
  "freight",
  "house_forecast",
] as const;

export type BalanceChannel = (typeof BALANCE_CHANNELS)[number];

export type BalanceComponentInput = {
  channel: BalanceChannel;
  label: string;
  value: number;
  delta: number;
  horizon: DecisionHorizon;
  confidence: number;
};

export type BalanceComponent = Readonly<BalanceComponentInput>;

export type BalanceSnapshotInput = {
  commodity_ref: PublicSubjectRef & { kind: "commodity" };
  as_of: string;
  unit: string;
  source_refs: ReadonlyArray<string>;
  components: ReadonlyArray<BalanceComponentInput>;
};

export type BalanceSnapshot = {
  commodity_ref: PublicSubjectRef & { kind: "commodity" };
  as_of: string;
  unit: string;
  source_refs: ReadonlyArray<string>;
  components: ReadonlyArray<BalanceComponent>;
  net_delta: number;
};

export function normalizeBalanceSnapshot(input: BalanceSnapshotInput): BalanceSnapshot {
  assertPublicSubjectRef(input.commodity_ref, "balance.commodity_ref");
  if (input.commodity_ref.kind !== "commodity") {
    throw new Error("balance.commodity_ref.kind must be commodity");
  }
  assertIsoDateTime(input.as_of, "balance.as_of");
  assertNonEmptyString(input.unit, "balance.unit");
  const sourceRefs = freezeUuidArray(input.source_refs, "balance.source_refs");
  if (!Array.isArray(input.components) || input.components.length === 0) {
    throw new Error("balance.components must be a non-empty array");
  }
  const components = Object.freeze(input.components.map(normalizeComponent));
  const net_delta = round6(components.reduce((sum, component) => sum + component.delta, 0));

  return Object.freeze({
    commodity_ref: Object.freeze({ ...input.commodity_ref }),
    as_of: input.as_of,
    unit: input.unit.trim(),
    source_refs: sourceRefs,
    components,
    net_delta,
  });
}

function normalizeComponent(input: BalanceComponentInput, index: number): BalanceComponent {
  assertOneOf(input.channel, BALANCE_CHANNELS, `balance.components[${index}].channel`);
  assertNonEmptyString(input.label, `balance.components[${index}].label`);
  assertFiniteNumber(input.value, `balance.components[${index}].value`);
  assertFiniteNumber(input.delta, `balance.components[${index}].delta`);
  assertOneOf(input.horizon, IMPACT_HORIZONS, `balance.components[${index}].horizon`);
  assertUnitInterval(input.confidence, `balance.components[${index}].confidence`);
  return Object.freeze({
    channel: input.channel,
    label: input.label.trim(),
    value: input.value,
    delta: input.delta,
    horizon: input.horizon,
    confidence: input.confidence,
  });
}

function round6(value: number): number {
  return roundTo(value, 6);
}

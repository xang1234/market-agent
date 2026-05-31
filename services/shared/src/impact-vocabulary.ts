import { DECISION_HORIZONS } from "./subject-ref.ts";

export const IMPACT_CHANNELS = Object.freeze([
  "supply",
  "demand",
  "inventory",
  "curve_structure",
  "freight",
  "policy",
  "macro_fx",
  "weather",
  "disruption",
] as const);

export const IMPACT_DIRECTIONS = Object.freeze(["positive", "negative", "mixed", "unknown"] as const);

export const IMPACT_DRIVER_TYPES = Object.freeze([
  "price_move",
  "report_delta",
  "news_event",
  "inventory_change",
  "forecast_change",
  "internal_note",
] as const);

export const IMPACT_HORIZONS = Object.freeze([...DECISION_HORIZONS]) as typeof DECISION_HORIZONS;

export type ImpactChannel = (typeof IMPACT_CHANNELS)[number];
export type ImpactDirection = (typeof IMPACT_DIRECTIONS)[number];
export type ImpactDriverType = (typeof IMPACT_DRIVER_TYPES)[number];
export type ImpactHorizon = (typeof IMPACT_HORIZONS)[number];

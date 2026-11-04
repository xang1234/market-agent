export const FINDING_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export const SCORING_TRUST_TIERS = ["primary", "secondary", "tertiary", "user"] as const;
export type ScoringTrustTier = (typeof SCORING_TRUST_TIERS)[number];

export const SCORING_IMPACT_DIRECTIONS = ["positive", "negative", "mixed", "unknown"] as const;
export type ScoringImpactDirection = (typeof SCORING_IMPACT_DIRECTIONS)[number];

export const SCORING_IMPACT_CHANNELS = [
  "demand",
  "pricing",
  "supply_chain",
  "regulation",
  "competition",
  "balance_sheet",
  "sentiment",
] as const;
export type ScoringImpactChannel = (typeof SCORING_IMPACT_CHANNELS)[number];

export const SCORING_IMPACT_HORIZONS = ["near_term", "medium_term", "long_term"] as const;
export type ScoringImpactHorizon = (typeof SCORING_IMPACT_HORIZONS)[number];

export type SeverityScoringInput = {
  evidence: {
    trust_tier: ScoringTrustTier;
    corroborating_source_count: number;
    confidence: number;
  };
  impact: {
    direction: ScoringImpactDirection;
    channel: ScoringImpactChannel;
    horizon: ScoringImpactHorizon;
    confidence: number;
  };
  thesis_relevance: number;
};

export type SeverityScoreComponents = {
  evidence: number;
  impact: number;
  thesis_relevance: number;
};

export type SeverityScoringResult = {
  severity: FindingSeverity;
  score: number;
  components: SeverityScoreComponents;
  explanation: string;
};

export class SeverityScoringValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeverityScoringValidationError";
  }
}

const TRUST_TIER_WEIGHT: Readonly<Record<ScoringTrustTier, number>> = Object.freeze({
  primary: 0.95,
  secondary: 0.65,
  tertiary: 0.28,
  user: 0.42,
});

const DIRECTION_WEIGHT: Readonly<Record<ScoringImpactDirection, number>> = Object.freeze({
  positive: 0.9,
  negative: 0.95,
  mixed: 0.7,
  unknown: 0.35,
});

const CHANNEL_WEIGHT: Readonly<Record<ScoringImpactChannel, number>> = Object.freeze({
  demand: 0.9,
  pricing: 0.86,
  supply_chain: 0.82,
  regulation: 0.86,
  competition: 0.78,
  balance_sheet: 0.95,
  sentiment: 0.42,
});

const HORIZON_WEIGHT: Readonly<Record<ScoringImpactHorizon, number>> = Object.freeze({
  near_term: 0.95,
  medium_term: 0.75,
  long_term: 0.52,
});

export function scoreFindingSeverity(input: SeverityScoringInput): SeverityScoringResult {
  validateInput(input);

  const evidence = round2(
    clamp01(
      TRUST_TIER_WEIGHT[input.evidence.trust_tier] * 0.62 +
        input.evidence.confidence * 0.26 +
        corroborationScore(input.evidence.corroborating_source_count) * 0.12,
    ),
  );
  const impact = round2(
    clamp01(
      DIRECTION_WEIGHT[input.impact.direction] * 0.34 +
        CHANNEL_WEIGHT[input.impact.channel] * 0.26 +
        HORIZON_WEIGHT[input.impact.horizon] * 0.2 +
        input.impact.confidence * 0.2,
    ),
  );
  const thesis_relevance = round2(input.thesis_relevance);
  const score = round2(evidence * 0.34 + impact * 0.38 + thesis_relevance * 0.28);
  const severity = severityFromScore(score);

  const components = Object.freeze({
    evidence,
    impact,
    thesis_relevance,
  });
  return Object.freeze({
    severity,
    score,
    components,
    explanation: `Severity ${severity}: evidence ${evidence.toFixed(2)}, impact ${impact.toFixed(2)}, thesis relevance ${thesis_relevance.toFixed(2)}.`,
  });
}

function severityFromScore(score: number): FindingSeverity {
  if (score >= 0.9) return "critical";
  if (score >= 0.72) return "high";
  if (score >= 0.45) return "medium";
  return "low";
}

function corroborationScore(count: number): number {
  if (count >= 3) return 1;
  if (count === 2) return 0.82;
  if (count === 1) return 0.55;
  return 0;
}

function validateInput(input: SeverityScoringInput): void {
  assertOneOf(input.evidence.trust_tier, SCORING_TRUST_TIERS, "evidence.trust_tier");
  assertNonNegativeInteger(input.evidence.corroborating_source_count, "evidence.corroborating_source_count");
  assertUnitInterval(input.evidence.confidence, "evidence.confidence");
  assertOneOf(input.impact.direction, SCORING_IMPACT_DIRECTIONS, "impact.direction");
  assertOneOf(input.impact.channel, SCORING_IMPACT_CHANNELS, "impact.channel");
  assertOneOf(input.impact.horizon, SCORING_IMPACT_HORIZONS, "impact.horizon");
  assertUnitInterval(input.impact.confidence, "impact.confidence");
  assertUnitInterval(input.thesis_relevance, "thesis_relevance");
}

function assertOneOf<T extends string>(value: unknown, choices: readonly T[], label: string): asserts value is T {
  if (typeof value !== "string" || !choices.includes(value as T)) {
    throw new SeverityScoringValidationError(`${label}: must be one of ${choices.join(", ")}`);
  }
}

function assertNonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new SeverityScoringValidationError(`${label}: must be a non-negative integer`);
  }
}

function assertUnitInterval(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new SeverityScoringValidationError(`${label}: must be a finite number in [0, 1]`);
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

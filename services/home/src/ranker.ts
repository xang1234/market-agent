import type { HomeFindingCard, HomeFindingSeverity } from "./types.ts";

export type HomeRankingWeights = {
  recency: number;
  severity: number;
  affinity: number;
  recency_half_life_hours: number;
  critical_override_margin: number;
};

export type HomeRankingOptions = {
  now?: string | Date;
  weights?: HomeRankingWeights;
};

export type HomeCardScore = {
  score: number;
  components: {
    recency: number;
    severity: number;
    affinity: number;
  };
};

export const DEFAULT_HOME_RANKING_WEIGHTS: HomeRankingWeights = Object.freeze({
  recency: 0.35,
  severity: 0.5,
  affinity: 0.15,
  recency_half_life_hours: 24,
  critical_override_margin: 0.25,
});

const SEVERITY_VALUE: Record<HomeFindingSeverity, number> = {
  low: 0.25,
  medium: 0.5,
  high: 0.75,
  critical: 1,
};

const SEVERITY_RANK: Record<HomeFindingSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export function rankHomeCards(
  cards: ReadonlyArray<HomeFindingCard>,
  options: HomeRankingOptions = {},
): HomeFindingCard[] {
  const weights = options.weights ?? DEFAULT_HOME_RANKING_WEIGHTS;
  const now = resolveNow(options.now);
  const scored = cards.map((card) => ({
    card,
    score: scoreHomeCard(card, { now, weights }),
  }));

  scored.sort((a, b) => compareScoredCards(a, b, weights));
  return scored.map(({ card }) => card);
}

export function scoreHomeCard(
  card: HomeFindingCard,
  options: HomeRankingOptions = {},
): HomeCardScore {
  const weights = options.weights ?? DEFAULT_HOME_RANKING_WEIGHTS;
  const now = resolveNow(options.now);
  const components = {
    recency: recencyScore(card.created_at, now, weights.recency_half_life_hours),
    severity: severityScore(card.severity),
    affinity: clamp01(card.user_affinity),
  };
  return {
    score:
      weights.recency * components.recency +
      weights.severity * components.severity +
      weights.affinity * components.affinity,
    components,
  };
}

function compareScoredCards(
  a: { card: HomeFindingCard; score: HomeCardScore },
  b: { card: HomeFindingCard; score: HomeCardScore },
  weights: HomeRankingWeights,
): number {
  if (a.card.severity === "critical" && b.card.severity !== "critical") {
    if (b.score.score <= a.score.score + weights.critical_override_margin) return -1;
  }
  if (b.card.severity === "critical" && a.card.severity !== "critical") {
    if (a.score.score <= b.score.score + weights.critical_override_margin) return 1;
  }

  if (a.score.score !== b.score.score) return b.score.score - a.score.score;
  const severity = SEVERITY_RANK[b.card.severity] - SEVERITY_RANK[a.card.severity];
  if (severity !== 0) return severity;
  const created = Date.parse(b.card.created_at) - Date.parse(a.card.created_at);
  if (created !== 0) return created;
  return a.card.home_card_id < b.card.home_card_id
    ? -1
    : a.card.home_card_id > b.card.home_card_id
      ? 1
      : 0;
}

function recencyScore(createdAt: string, now: Date, halfLifeHours: number): number {
  if (!Number.isFinite(halfLifeHours) || halfLifeHours <= 0) {
    throw new Error("recency_half_life_hours must be positive");
  }
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) throw new Error("card.created_at must be an ISO date-time string");
  const ageHours = Math.max(0, (now.getTime() - created) / 3_600_000);
  return 0.5 ** (ageHours / halfLifeHours);
}

function severityScore(severity: HomeFindingSeverity): number {
  const score = SEVERITY_VALUE[severity];
  if (score === undefined) throw new Error("card.severity must be low, medium, high, or critical");
  return score;
}

function resolveNow(now: string | Date | undefined): Date {
  if (now instanceof Date) return now;
  const resolved = now === undefined ? new Date() : new Date(now);
  if (Number.isNaN(resolved.getTime())) throw new Error("now must be a valid date");
  return resolved;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

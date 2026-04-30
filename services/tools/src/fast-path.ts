export const FAST_PATH_DETECTOR_VERSION = "v1";

export const FAST_PATH_QUOTE_BUNDLE_ID = "quote_lookup";
export const FAST_PATH_QUOTE_TOOL_NAME = "get_quote";

const QUOTE_INTENT_PATTERN = /\b(?:price|prices|priced|quote|quotes|quoted)\b/i;

const ANALYTICAL_SIGNAL_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  signal: string;
}> = [
  { pattern: /\b(?:why|how)\b/i, signal: "explanatory_question" },
  {
    pattern: /\b(?:vs\.?|versus|compare(?:d)?|comparison|peer|peers)\b/i,
    signal: "comparison",
  },
  {
    pattern:
      /\b(?:history|historical|chart|over|since|trend|past|year|years|month|months|week|weeks|day|days|ytd|qtd|mtd|ago)\b/i,
    signal: "temporal_range",
  },
  {
    pattern:
      /\b(?:earnings|filing|filings|report|news|analysis|summary|outlook|forecast|risk|growth|estimate|estimates|consensus)\b/i,
    signal: "analytical_topic",
  },
  {
    pattern:
      /\b(?:target|rating|upgrade|downgrade|valuation|fair|buy|sell|hold|overweight|underweight|pt|analyst)\b/i,
    signal: "analyst_opinion",
  },
  {
    pattern:
      /\b(?:change|delta|gain|loss|return|returns|percent|percentage|moved|move|movement|decline|drop|surge)\b/i,
    signal: "performance_metric",
  },
  { pattern: /%/, signal: "percent_sign" },
];

const MAX_TOKEN_COUNT = 8;
const MAX_CHARACTER_COUNT = 80;

export type DetectFastPathInput = {
  user_turn: string;
  resolved_subject_count?: number;
  now?: () => number;
};

export type FastPathRejectionReason =
  | "missing_user_turn"
  | "too_many_characters"
  | "too_many_tokens"
  | "no_quote_intent"
  | "analytical_signal"
  | "subject_count_mismatch";

/**
 * Result of `detectFastPath`.
 *
 * On `ok: true`, the caller MUST bypass `selectToolBundle` /
 * `createTurnToolPolicy` entirely and dispatch `tool_name` directly against
 * `bundle_id`. Routing the success variant through the standard turn-policy
 * pipeline reintroduces the analyst loop and defeats the purpose of the
 * short-circuit.
 *
 * `heuristic_ms` measures only the deterministic detector itself (regex /
 * length checks). It is NOT end-to-end fast-path latency: the caller is
 * responsible for measuring the eventual `get_quote` call and assembly to
 * verify the <100ms turnaround contract.
 */
export type FastPathDecision =
  | {
      ok: true;
      kind: "quote_only";
      bundle_id: typeof FAST_PATH_QUOTE_BUNDLE_ID;
      tool_name: typeof FAST_PATH_QUOTE_TOOL_NAME;
      detected_intent: "quote";
      classification: { bundle_id: typeof FAST_PATH_QUOTE_BUNDLE_ID; reason: string };
      detector_version: string;
      heuristic_ms: number;
      reason: string;
    }
  | {
      ok: false;
      detector_version: string;
      heuristic_ms: number;
      reason: FastPathRejectionReason;
      detail?: string;
    };

export function detectFastPath(input: DetectFastPathInput): FastPathDecision {
  const now = input.now ?? defaultNow;
  const startedAt = now();
  const inner = evaluate(input);
  const heuristic_ms = Math.max(0, now() - startedAt);
  return Object.freeze({
    ...inner,
    detector_version: FAST_PATH_DETECTOR_VERSION,
    heuristic_ms,
  } as FastPathDecision);
}

type FastPathInnerDecision =
  | Omit<Extract<FastPathDecision, { ok: true }>, "detector_version" | "heuristic_ms">
  | Omit<Extract<FastPathDecision, { ok: false }>, "detector_version" | "heuristic_ms">;

function evaluate(input: DetectFastPathInput): FastPathInnerDecision {
  const text = typeof input.user_turn === "string" ? input.user_turn.trim() : "";
  if (text.length === 0) {
    return { ok: false, reason: "missing_user_turn" };
  }
  if (text.length > MAX_CHARACTER_COUNT) {
    return {
      ok: false,
      reason: "too_many_characters",
      detail: `${text.length} > ${MAX_CHARACTER_COUNT}`,
    };
  }

  const tokens = text.split(/\s+/);
  if (tokens.length > MAX_TOKEN_COUNT) {
    return {
      ok: false,
      reason: "too_many_tokens",
      detail: `${tokens.length} > ${MAX_TOKEN_COUNT}`,
    };
  }

  if (!QUOTE_INTENT_PATTERN.test(text)) {
    return { ok: false, reason: "no_quote_intent" };
  }

  for (const { pattern, signal } of ANALYTICAL_SIGNAL_PATTERNS) {
    if (pattern.test(text)) {
      return { ok: false, reason: "analytical_signal", detail: signal };
    }
  }

  if (
    input.resolved_subject_count !== undefined &&
    input.resolved_subject_count !== 1
  ) {
    return {
      ok: false,
      reason: "subject_count_mismatch",
      detail: `expected exactly 1 resolved subject, received ${input.resolved_subject_count}`,
    };
  }

  const reason = "quote-only intent matched without analytical signals";
  return {
    ok: true,
    kind: "quote_only",
    bundle_id: FAST_PATH_QUOTE_BUNDLE_ID,
    tool_name: FAST_PATH_QUOTE_TOOL_NAME,
    detected_intent: "quote",
    classification: Object.freeze({
      bundle_id: FAST_PATH_QUOTE_BUNDLE_ID,
      reason,
    }),
    reason,
  };
}

function defaultNow(): number {
  return performance.now();
}

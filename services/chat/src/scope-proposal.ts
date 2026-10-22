// A model reads what a question asks for and turns off (#287 follow-up): its
// metrics, its facets (peers, segments, guidance, a cause...), its income
// items and its period (#472). English patterns kept missing phrasings, one
// review at a time. The model only proposes, from closed vocabularies: every
// key is checked, and anything outside them rejects the whole proposal, so the
// turn asks for nothing new (research-scope.ts). It never picks companies,
// data or figures, and nothing it writes reaches the answer: the readers and gap notes
// do as before.
//
// Off when there is no model or CHAT_SCOPE_PROPOSAL=off. Recorded replies
// (LLM_REPLAY_FILE) answer it like any other call: a fixture records one per
// question, matched by proposalQuestion.

import { createLlmRouterFromEnv, type LlmChatClient, type LlmSettingsLoaderEnv } from "../../llm/src/index.ts";
import { withDeadlines, type ModelDeadlines } from "./llm-runtime.ts";
import {
  FISCAL_PERIODS,
  INCOME_ITEMS,
  isOneOf,
  PERIOD_FIELDS,
  PROPOSABLE_ADJUSTMENTS,
  PROPOSABLE_METRICS,
  PROPOSABLE_QUALIFIERS,
  proposedMetric,
  SCOPE_FACETS,
  type RequestedMetric,
  type ScopePeriod,
  type ScopeProposal,
} from "./research-scope.ts";

// One attempt, no fallback model: the turn waits on it, and asks for nothing
// new when it is slow. A large model took 3-9 s in the dev probe.
export const SCOPE_DEADLINES: ModelDeadlines = { attemptMs: 12_000, totalMs: 15_000 };
const MAX_METRICS = 10;
const FIELDLESS_PERIODS = ["latest", "trailing_twelve_months", "range", "other"] as const;
const YEARS = { first: 1990, last: 2100 };

type ProposalEnv = LlmSettingsLoaderEnv & { CHAT_SCOPE_PROPOSAL?: string };

// The user message: the question quoted, so a recorded reply can match it
// alone, never a longer question that starts with it.
export function proposalQuestion(question: string): string {
  return `Question: ${JSON.stringify(question)}`;
}

// What the question asks for and turns off, or null when there is no proposal
// (off, no model, a failure, a cut-off reply, or one outside the vocabularies).
export async function proposeScope(input: {
  question: string;
  env?: ProposalEnv;
  createClient?: () => Promise<LlmChatClient> | LlmChatClient;
  deadlines?: ModelDeadlines;
}): Promise<ScopeProposal | null> {
  const env = input.env ?? (process.env as ProposalEnv);
  if (input.question.trim() === "") return null;
  const none = (reason: string, ...detail: unknown[]): null => {
    console.warn(`[chat] no scope proposal (${reason}); the turn asks for nothing new`, ...detail);
    return null;
  };
  if (env.CHAT_SCOPE_PROPOSAL === "off") return none("CHAT_SCOPE_PROPOSAL=off");
  try {
    const router = await createLlmRouterFromEnv(env, { createClient: input.createClient, purpose: "extraction" });
    if (!router) return none("no model");
    const result = await router.complete({
      messages: [
        { role: "system", content: PROPOSAL_INSTRUCTIONS },
        { role: "user", content: proposalQuestion(input.question) },
      ],
      temperature: 0,
      maxTokens: 512,
      reasoning: "off",
    }, withDeadlines(input.deadlines ?? SCOPE_DEADLINES));
    if (result.truncated) return none("reply cut off");
    return parseProposal(result.text) ?? none("reply outside the vocabularies");
  } catch (reason) {
    return none("model call failed", reason);
  }
}

// The reply as a proposal, each metric built as the scope names it; null for
// anything malformed or outside the vocabularies.
export function parseProposal(text: string): ScopeProposal | null {
  let reply: unknown;
  try {
    reply = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    return null;
  }
  const { metrics, asks, turns_off: turnsOff, income_items: incomeItems, period: periodReply } = (reply ?? {}) as Record<string, unknown>;
  if (turnsOff === null || typeof turnsOff !== "object") return null;
  const { facets: offFacets, metrics: offMetrics } = turnsOff as Record<string, unknown>;
  const proposed = metricList(metrics);
  const off = metricList(offMetrics);
  const asked = members(asks, SCOPE_FACETS);
  const offAsked = members(offFacets, [...SCOPE_FACETS, ...PERIOD_FIELDS]);
  const items = members(incomeItems, INCOME_ITEMS);
  const period = periodOf(periodReply);
  if (!proposed || !off || !asked || !offAsked || !items || !period) return null;
  return {
    metrics: proposed,
    asks: new Set(asked),
    turns_off: { facets: new Set(offAsked), metrics: new Set(off.map((metric) => metric.metric_key)) },
    income_items: [...new Set(items)],
    period,
  };
}

// Exactly the fields its kind has: a year outside the bounds, or a field the
// kind does not have, rejects it.
function periodOf(value: unknown): ScopePeriod | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const { kind, ...fields } = value as Record<string, unknown>;
  const keys = Object.keys(fields).sort().join(",");
  const { fiscal_year: year, fiscal_period: quarter } = fields;
  if (kind === "fiscal_year") return keys === "fiscal_year" && isYear(year) ? { kind, fiscal_year: year } : null;
  if (kind === "fiscal_quarter") {
    return keys === "fiscal_period,fiscal_year" && isOneOf(quarter, FISCAL_PERIODS) && (year === null || isYear(year))
      ? { kind, fiscal_period: quarter, fiscal_year: year }
      : null;
  }
  return keys === "" && isOneOf(kind, FIELDLESS_PERIODS) ? { kind } : null;
}

function isYear(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= YEARS.first && (value as number) <= YEARS.last;
}

function members<T extends string>(value: unknown, vocabulary: ReadonlyArray<T>): T[] | null {
  if (!Array.isArray(value)) return null;
  const entries: unknown[] = value;
  return entries.every((entry) => isOneOf(entry, vocabulary)) ? entries : null;
}

function metricList(value: unknown): RequestedMetric[] | null {
  if (!Array.isArray(value) || value.length > MAX_METRICS) return null;
  const metrics: RequestedMetric[] = [];
  for (const item of value) {
    // A bare catalog key is the metric with neither adjustment nor qualifier.
    const { metric, adjustment = null, qualifier = null } = (typeof item === "string" ? { metric: item } : item ?? {}) as Record<string, unknown>;
    if (typeof metric !== "string") return null;
    if (adjustment !== null && typeof adjustment !== "string") return null;
    if (qualifier !== null && typeof qualifier !== "string") return null;
    const built = proposedMetric(metric, adjustment, qualifier);
    if (!built) return null;
    if (!metrics.some((seen) => seen.metric_key === built.metric_key)) metrics.push(built);
  }
  return metrics;
}

const PROPOSAL_INSTRUCTIONS = [
  "Read what a research question about companies asks for, and what it asks to remove. Reply with JSON only, no prose:",
  '{"metrics":[<metric>],"asks":[<facet>],"turns_off":{"facets":[<facet or period>],"metrics":[<metric>]},"income_items":[<item>],"period":<period>}',
  'A <metric> is {"metric":"<key>","adjustment":<adjustment or null>,"qualifier":<qualifier or null>}.',
  "metric is one of these keys (key: what it is):",
  ...PROPOSABLE_METRICS.map((metric) => `- ${metric.metric_key}: ${metric.label}`),
  `adjustment is one of ${PROPOSABLE_ADJUSTMENTS.join(", ")}, or null: an adjective that makes the figure`,
  'another one than reported ("adjusted EPS", "non-GAAP free cash flow").',
  `qualifier is one of ${PROPOSABLE_QUALIFIERS.join(", ")}, or null: what is asked of the metric`,
  '("free cash flow margin" is margin, "growth in EPS" is growth, "FCF YTD" is ytd).',
  "A <facet> is one of these (facet: what the question asks for):",
  "- peers: the company's peers or competitors, not named",
  "- segments: revenue or results by business segment",
  "- margins: an income margin (gross, operating, net) or profitability, its latest value",
  "- margin_trend: an income margin over time: its trend, history, change, since a date, quarter over quarter,",
  "  year over year, or against an earlier quarter or year",
  "- price_window: a stock price return over a window, such as year to date",
  "- benchmark: a market index or benchmark (the S&P 500, the Nasdaq)",
  "- guidance: what the company guided to, its outlook, forecast, projections, targets or expectations",
  "- explains: a cause: why, what drove, led to, contributed to or accounted for something",
  "- evidence: the sources or evidence of the previous answer",
  "- latest_quarter: the latest, most recent or current reported quarter",
  `A period in turns_off is ${PERIOD_FIELDS.join(" or ")}: a fiscal year or quarter the question asks to remove.`,
  `An <item> is one of ${INCOME_ITEMS.join(", ")}: an income-statement item the question names.`,
  "A <period> is the period the question asks about, one of:",
  '- {"kind":"latest"}: no period named, or the latest or most recent one',
  '- {"kind":"fiscal_year","fiscal_year":<year>}: a year ("fiscal 2025", "FY26", "for 2024", "2023 earnings")',
  `- {"kind":"fiscal_quarter","fiscal_period":<${FISCAL_PERIODS.join(", ")}>,"fiscal_year":<year or null>}: a quarter,`,
  '  its year null when the question names none ("what about Q3?")',
  '- {"kind":"trailing_twelve_months"}: the trailing twelve months, TTM, LTM',
  '- {"kind":"range"}: a span of periods ("since 2021", "2022 to 2024", "the past 3 years")',
  '- {"kind":"other"}: any other period, one named relative to now ("last year", "last quarter")',
  "A <year> is a four-digit integer; a two-digit year is in the 2000s (FY26 is 2026).",
  "Rules:",
  "- List only what the question itself asks for, in the order it asks. Empty lists when nothing applies.",
  '- A context is not a metric, but a metric discussed in it is: "what did AMD say about free cash flow on its',
  '  earnings call" asks for free_cash_flow; the earnings call itself is no metric.',
  "- Revenue, sales, profit, income, margins and growth of those are income_statement.",
  "- Cash from, provided by or used in operating activities is operating_cash_flow; the same for investing",
  "  or financing activities is investing_cash_flow or financing_cash_flow.",
  "- The whole balance sheet is balance_sheet; a single balance item is its own key.",
  "- A stock or price return, even year to date, is not a metric here.",
  '- A margin of another metric ("free cash flow margin", "EBITDA margin") is that metric\'s qualifier, not margins;',
  '  an income margin ("gross margin", "operating margin", "profitability") asks margins, and margin_trend too',
  '  when the question is about its change ("how did the gross margin change").',
  "- An operating or net margin is its own item, operating_margin or net_margin, never the operating_income or",
  "  net_income it divides.",
  '- A result set against expectations asks why, not for guidance: "lower than expected", "as expected", "missed',
  '  its forecast", "below target", "beat guidance" ask explains. "Current guidance versus prior guidance" asks guidance.',
  '- A company\'s "sources of revenue" are not evidence; "your sources" or "where does this come from" are.',
  '- A bare "last quarter" is the one before, not latest_quarter: "compare gross margin with last quarter" asks',
  "  margin_trend, and its period is latest.",
  '- turns_off lists what the question asks to remove or stop showing: "without guidance", "no forecasts" or',
  '  "don\'t include guidance" turn guidance off; "drop the YTD window" turns price_window off; "forget fiscal',
  '  2025" turns fiscal_year off, and its period is latest. turns_off.metrics holds <metric> objects like',
  '  metrics, never bare keys: dropping "the cash flow" turns off {"metric":"operating_cash_flow"},',
  '  {"metric":"free_cash_flow"} and {"metric":"capex"}; dropping operating cash flow by name turns off only that one.',
  '- Companies are not facets: "drop AMD and NOW" turns nothing off.',
  '- "No" inside a clause removes nothing: "why was there no change in margins?" asks explains and margin_trend.',
  '- Removing quarter-over-quarter growth is not removing the fiscal quarter.',
  '- A follow-up that names nothing (a "why?", or "compare it with AMD") asks only what it says: explains, or nothing.',
  "- A question or follow-up that names no period has the period latest.",
].join("\n");

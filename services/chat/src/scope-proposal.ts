// A model reads which metrics a question asks for (#287 follow-up): the
// patterns in research-scope.ts kept missing phrasings ("cash used in
// operating activities", "growth in EPS", "adjusted diluted EPS"). The model
// only proposes, from a closed catalog: every key and qualifier is checked,
// and anything outside the catalog rejects the whole proposal, so the patterns
// answer instead. It never picks companies, data or figures, and nothing it
// writes reaches the answer: the readers and gap notes do as before.
//
// Off when there is no model, when replies are recorded (LLM_REPLAY_FILE: a
// recorded conversation has no reply for this call), or CHAT_SCOPE_PROPOSAL=off.

import { createLlmRouterFromEnv, type LlmChatClient, type LlmSettingsLoaderEnv } from "../../llm/src/index.ts";
import { withDeadlines, type ModelDeadlines } from "./llm-runtime.ts";
import {
  PROPOSABLE_ADJUSTMENTS,
  PROPOSABLE_METRICS,
  PROPOSABLE_QUALIFIERS,
  proposedMetric,
  type RequestedMetric,
} from "./research-scope.ts";

// One attempt, no fallback model: the turn waits on it, and the patterns stand
// in when it is slow. A large model took 3-9 s in the dev probe.
export const SCOPE_DEADLINES: ModelDeadlines = { attemptMs: 12_000, totalMs: 15_000 };
const MAX_METRICS = 10;

type ProposalEnv = LlmSettingsLoaderEnv & { LLM_REPLAY_FILE?: string; CHAT_SCOPE_PROPOSAL?: string };

export function scopeProposalEnabled(env: ProposalEnv): boolean {
  return !env.LLM_REPLAY_FILE && env.CHAT_SCOPE_PROPOSAL !== "off";
}

// The metrics the question asks for, or null when the patterns should read
// them instead (off, no model, a failure, or a proposal outside the catalog).
export async function proposeQuestionMetrics(input: {
  question: string;
  env?: ProposalEnv;
  createClient?: () => Promise<LlmChatClient> | LlmChatClient;
  deadlines?: ModelDeadlines;
}): Promise<RequestedMetric[] | null> {
  const env = input.env ?? (process.env as ProposalEnv);
  if (input.question.trim() === "" || !scopeProposalEnabled(env)) return null;
  try {
    const router = await createLlmRouterFromEnv(env, { createClient: input.createClient, purpose: "extraction" });
    if (!router) return null;
    const result = await router.complete({
      messages: [
        { role: "system", content: PROPOSAL_INSTRUCTIONS },
        { role: "user", content: input.question },
      ],
      temperature: 0,
      maxTokens: 512,
      reasoning: "off",
    }, withDeadlines(input.deadlines ?? SCOPE_DEADLINES));
    if (result.truncated) return null;
    return parseProposal(result.text);
  } catch (reason) {
    console.warn("[chat] metric proposal unavailable; reading the question's metrics by pattern", reason);
    return null;
  }
}

// The reply's metrics, each validated and built as the patterns would build
// it; null for anything malformed or outside the catalog.
export function parseProposal(text: string): RequestedMetric[] | null {
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  let reply: unknown;
  try {
    reply = JSON.parse(json);
  } catch {
    return null;
  }
  const items = (reply as { metrics?: unknown } | null)?.metrics;
  if (!Array.isArray(items) || items.length > MAX_METRICS) return null;
  const metrics: RequestedMetric[] = [];
  for (const item of items) {
    const { metric, adjustment = null, qualifier = null } = (item ?? {}) as Record<string, unknown>;
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
  "Read which financial metrics a research question asks for. Reply with JSON only, no prose:",
  '{"metrics":[{"metric":"<key>","adjustment":<adjustment or null>,"qualifier":<qualifier or null>}]}',
  "metric is one of these keys (key: what it is):",
  ...PROPOSABLE_METRICS.map((metric) => `- ${metric.metric_key}: ${metric.label}`),
  `adjustment is one of ${PROPOSABLE_ADJUSTMENTS.join(", ")}, or null: an adjective that makes the figure`,
  'another one than reported ("adjusted EPS", "non-GAAP free cash flow").',
  `qualifier is one of ${PROPOSABLE_QUALIFIERS.join(", ")}, or null: what is asked of the metric`,
  '("free cash flow margin" is margin, "growth in EPS" is growth, "FCF YTD" is ytd).',
  "Rules:",
  "- List only metrics the question itself asks for, in the order it asks.",
  '- A context is not a metric, but a metric discussed in it is: "what did AMD say about free cash flow on its',
  '  earnings call" asks for free_cash_flow; the earnings call itself is no metric.',
  "- Revenue, sales, profit, income, margins and growth of those are income_statement.",
  "- Cash from, provided by or used in operating activities is operating_cash_flow; the same for investing",
  "  or financing activities is investing_cash_flow or financing_cash_flow.",
  "- The whole balance sheet is balance_sheet; a single balance item is its own key.",
  "- A stock or price return, even year to date, is not a metric here.",
  '- If it names no metric (a follow-up such as "why?" or "compare it with AMD"), reply {"metrics":[]}.',
].join("\n");

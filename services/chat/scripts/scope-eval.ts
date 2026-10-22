// The scope proposal's live eval (#378), kept as a regression test with no
// model. test/fixtures/scope-eval-cases.json holds each question, the
// companies it covers, the previous answer's saved scope and the scope it
// should resolve to; test/fixtures/scope-eval-replies.json holds a live
// model's reply to each question. scope-eval.test.ts resolves every recorded
// reply (parseProposal, resolveResearchScope) against its case.
//
// After a prompt change, this asks the live model again, rewrites the replies
// and prints each case that no longer resolves as expected:
//
//   npm run scope:eval
//
// Models come from LLM_SETTINGS_ENV_FILE, by default the repo's .env.dev (a
// worktree has none: point it at the main checkout's).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { createDefaultPiLlmChatClient } from "../../llm/src/index.ts";
import { parseResearchScope, resolveResearchScope, type ResearchScope, type ScopePeriod } from "../src/research-scope.ts";
import { parseProposal, proposalQuestion, proposeScope } from "../src/scope-proposal.ts";

const ROOT = join(import.meta.dirname, "../../..");
const FIXTURES = join(import.meta.dirname, "../test/fixtures");
export const CASES_FILE = join(FIXTURES, "scope-eval-cases.json");
export const REPLIES_FILE = join(FIXTURES, "scope-eval-replies.json");
const AS_OF = "2026-09-01T00:00:00.000Z";
const COMPANIES = {
  NVDA: { issuer_id: "60000000-0000-4000-8000-000000000001", label: "NVDA" },
  AMD: { issuer_id: "60000000-0000-4000-8000-000000000002", label: "AMD" },
  AAPL: { issuer_id: "60000000-0000-4000-8000-000000000003", label: "AAPL" },
};

// The fields an eval case checks: a resolved scope's, and the period kind its
// reading names.
export function scopeView(scope: ResearchScope, period: ScopePeriod) {
  return {
    route: scope.route,
    reads: scope.reads,
    peers: scope.peers,
    segments: scope.segments,
    margin_trend: scope.margin_trend,
    margins: scope.margins,
    metrics: scope.metrics.map((metric) => metric.metric_key),
    guidance: scope.guidance === true,
    explains: scope.explains === true,
    income_items: [...(scope.income_items ?? [])],
    fiscal_year: scope.fiscal_year,
    fiscal_quarter: scope.fiscal_quarter && `${scope.fiscal_quarter.fiscal_period} ${scope.fiscal_quarter.fiscal_year}`,
    price_window: scope.price_window?.kind ?? null,
    benchmark: scope.benchmark,
    period: period.kind,
  };
}
export type ScopeView = ReturnType<typeof scopeView>;

export type ScopeEvalCase = {
  id: number;
  question: string;
  // The previous question, for a reader.
  after?: string;
  companies: ReadonlyArray<keyof typeof COMPANIES>;
  // The previous answer's scope as saved; null for a fresh question.
  prior: unknown;
  expected: ScopeView;
  // A field that may also resolve another way, and why that is as right.
  accept?: { [Field in keyof ScopeView]?: { value: ScopeView[Field]; reason: string } };
  // Why the expected scope is not the one the English patterns read.
  note?: string;
};

export type ScopeEvalReplies = { model: string; recorded: string; replies: Array<{ match: string; text: string }> };

export function replyTo(replies: ScopeEvalReplies, question: string): string | undefined {
  return replies.replies.find((reply) => reply.match === proposalQuestion(question))?.text;
}

// Each way the recorded reply resolves other than the case expects; none when it passes.
export function caseFailures(evalCase: ScopeEvalCase, reply: string | undefined): string[] {
  const name = `#${evalCase.id} ${evalCase.question}`;
  if (reply === undefined) return [`${name}: no recorded reply`];
  const proposal = parseProposal(reply);
  if (proposal === null) return [`${name}: reply rejected: ${reply}`];
  const view = scopeView(resolveResearchScope({
    question: evalCase.question,
    companies: evalCase.companies.map((ticker) => COMPANIES[ticker]),
    prior: evalCase.prior === null ? null : parseResearchScope(evalCase.prior),
    asOf: AS_OF,
    proposal,
  }), proposal.period);
  return (Object.keys(evalCase.expected) as Array<keyof ScopeView>).flatMap((field) => {
    const right = [evalCase.expected[field], ...(evalCase.accept?.[field] ? [evalCase.accept[field].value] : [])].map((value) => JSON.stringify(value));
    const got = JSON.stringify(view[field]);
    return right.includes(got) ? [] : [`${name}: ${field} ${got}, expected ${right.join(" or ")}`];
  });
}

async function recordLiveReplies(): Promise<number> {
  const cases = JSON.parse(readFileSync(CASES_FILE, "utf8")) as ScopeEvalCase[];
  const env: Record<string, string | undefined> = {
    ...process.env,
    LLM_SETTINGS_ENV_FILE: process.env.LLM_SETTINGS_ENV_FILE ?? join(ROOT, ".env.dev"),
    LLM_REPLAY_FILE: undefined,
    CHAT_SCOPE_PROPOSAL: undefined,
  };
  const live = await createDefaultPiLlmChatClient();
  const models = new Set<string>();
  const replies: ScopeEvalReplies["replies"] = [];
  for (const question of new Set(cases.map((evalCase) => evalCase.question))) {
    let text = "";
    await proposeScope({
      question,
      env,
      createClient: () => async (deployment, request, options) => {
        const result = await live(deployment, request, options);
        models.add(`${deployment.channel}/${deployment.model}`);
        text = result.text;
        return result;
      },
    });
    replies.push({ match: proposalQuestion(question), text });
    process.stderr.write(`${replies.length} ${question}\n`);
  }
  const recorded: ScopeEvalReplies = { model: [...models].join(", "), recorded: new Date().toISOString().slice(0, 10), replies };
  writeFileSync(REPLIES_FILE, `${JSON.stringify(recorded, null, 2)}\n`);
  const failing = cases.map((evalCase) => caseFailures(evalCase, replyTo(recorded, evalCase.question))).filter((failures) => failures.length > 0);
  for (const failure of failing.flat()) console.log(failure);
  const rejected = replies.filter((reply) => parseProposal(reply.text) === null).length;
  console.log(`${recorded.model}: ${cases.length - failing.length} of ${cases.length} cases as expected; ${rejected} of ${replies.length} replies rejected`);
  return failing.length === 0 ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await recordLiveReplies();
}

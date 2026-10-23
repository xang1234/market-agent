// Re-records the golden fixture's planner replies (test/golden/llm-replies.json)
// with the live planning model, for a change to the planner prompt (#517).
// Each question is planned as the golden chat turn plans it: its companies as
// written, and with its industry peers when it asks about peers, as the peer
// catalog adds them. Only the questions given are re-recorded; every other
// reply is kept.
//
//   node --experimental-strip-types scripts/planner-replies.ts "<question>" ["<question> --peers"]...
//
// Uses the stack's LLM settings (LLM_SETTINGS_ENV_FILE, default .env.dev).

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createRuntimeAuthority } from "../../financial-core/src/index.ts";
import { planFinancialRequest, planningModelFromRouter, type PlanningContext, type RequestedSubject } from "../../financial-engine/src/planner.ts";
import { createLlmRouterFromEnv } from "../../llm/src/index.ts";
import { extractSubjectMentions } from "../src/subject-extraction.ts";
import { GOLDEN_AS_OF, GOLDEN_COMPANIES, goldenCatalogPeers, type GoldenCompany } from "../test/golden/dataset.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const REPLIES = fileURLToPath(new URL("../test/golden/llm-replies.json", import.meta.url));
const PEERS = " --peers";

type Reply = { match: string | string[]; text: string };

const company = (mention: string) => GOLDEN_COMPANIES.find((candidate) => candidate.ticker === (mention === "AMDX" ? "AMD" : mention))!;
const subject = (mention: string, golden: GoldenCompany): RequestedSubject =>
  ({ mention, resolution: { status: "resolved", subject_ref: { kind: "issuer", id: golden.issuer_id }, label: golden.legal_name } });

function subjects(question: string, peers: boolean): RequestedSubject[] {
  const named = extractSubjectMentions(question).map((mention) => subject(mention, company(mention)));
  if (!peers) return named;
  return [...named, ...goldenCatalogPeers(company(extractSubjectMentions(question)[0]!))];
}

function context(requested: RequestedSubject[]): PlanningContext {
  return {
    plan_id: "65000000-0000-4000-8000-0000000000d2",
    origin: { kind: "chat_request", ref: "chat:planner-replies" },
    knowledge_cutoff: GOLDEN_AS_OF,
    cutoff_timezone: "UTC",
    reporting_basis: "as_reported",
    freshness_max_age_days: null,
    authority: createRuntimeAuthority({
      owner_user_id: "10000000-0000-4000-8000-000000000001",
      egress_channel: "chat",
      parent: { kind: "chat_thread", id: "65000000-0000-4000-8000-0000000000d1", version: "turn:planner-replies" },
      allowed_source_classes: ["sec_filing"],
      feature: { surface: "chat", capability: "financial-answer", mode: "enforce" },
      approval_state: "not_required",
      lease: null,
    }),
    parent_limits: {},
    max_model_calls: 2,
    requested_subjects: requested,
    publication_unit_kind: "chat_section",
  };
}

let source = readFileSync(REPLIES, "utf8");
const fixture = JSON.parse(source) as { replies: Reply[] };
const router = await createLlmRouterFromEnv({ ...process.env, LLM_SETTINGS_ENV_FILE: process.env.LLM_SETTINGS_ENV_FILE ?? join(ROOT, ".env.dev") });
if (!router) throw new Error("no LLM is configured");
const live = planningModelFromRouter(router);

for (const argument of process.argv.slice(2)) {
  const peers = argument.endsWith(PEERS);
  const question = peers ? argument.slice(0, -PEERS.length) : argument;
  const requested = subjects(question, peers);
  const texts: string[] = [];
  const result = await planFinancialRequest(context(requested), question, async (request) => {
    const reply = await live(request);
    texts.push(reply.text);
    return reply;
  });
  if (texts.length !== 1) throw new Error(`"${question}" took ${texts.length} planner calls; re-record it again`);
  const prefix = `Request: ${question}\nRequested`;
  const match: Reply["match"] = peers ? [prefix, ...requested.slice(extractSubjectMentions(question).length).map((peer) => peer.mention)] : prefix;
  const at = fixture.replies.findIndex((reply) => JSON.stringify(reply.match) === JSON.stringify(match));
  if (at === -1) throw new Error(`no recorded reply matches ${JSON.stringify(match)}`);
  const recorded = `"text": ${JSON.stringify(fixture.replies[at]!.text)}`;
  if (source.split(recorded).length !== 2) throw new Error(`the recorded reply for ${JSON.stringify(match)} is not unique in the fixture`);
  source = source.replace(recorded, () => `"text": ${JSON.stringify(texts[0]!)}`);
  fixture.replies[at] = { match, text: texts[0]! };
  console.log(`${question}${peers ? " (with peers)" : ""}: ${result.outcome}`);
}
writeFileSync(REPLIES, source);

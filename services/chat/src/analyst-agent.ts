// The analyst agent (AA5), behind CHAT_ANALYST_AGENT=1. A tool loop reads
// stored sources through the analyst_agent bundle: certified financials from
// the engine, and the 10-K claims, peers and consensus AA4 serves. Its own
// words are never shown. The turn's answer is the assertions list over the one
// packet those reads made (mergePackets), written, rendered and judged as every
// analyst answer is (answer-trace.ts answerTurn), so every number is an F id
// and every business fact a C id. A turn it reads nothing for is the next
// runner's.

import { createHash, randomUUID } from "node:crypto";

import type { FinancialSubjectRef } from "../../financial-core/src/index.ts";
import type { PlanningModel, RequestedSubject } from "../../financial-engine/src/planner.ts";
import { findPlanForRequest } from "../../financial-engine/src/run-repo.ts";
import { createLlmRouterFromEnv, LlmProviderError, LlmRouterError, type LlmChatClient, type LlmSettingsLoaderEnv } from "../../llm/src/index.ts";
import type { ControlledRouter, LlmToolCall } from "../../llm/src/router.ts";
import { runToolLoop, type ToolLoopOutput } from "../../llm/src/tool-loop.ts";
import type { JsonObject, JsonValue } from "../../shared/src/json.ts";
import { isRecord } from "../../shared/src/http.ts";
import type { FinancialAnswerBlock } from "../../snapshot/src/financial-verifier.ts";
import { createTurnToolPolicy, loadToolRegistry, type ToolRegistry } from "../../tools/src/index.ts";
import { isAnalystToolName, type AnalystToolName, type AnalystToolResult } from "./analyst-tools.ts";
import type { AnsweredTurn, AnswerTraceInput, TurnTrace } from "./answer-trace.ts";
import { isUuid, noteBlock } from "./chat-ids.ts";
import { COMMENTARY_UNAVAILABLE } from "./engine-commentary.ts";
import { ANALYST_AGENT_BUNDLE_ID, labelList, type ChatAnalystAgent, type ChatAnalystToolRuntimeResult, type ChatAnalystToolRuntimeToolCall, type ChatTurnRunContext } from "./coordinator.ts";
import { mergePackets, type EvidencePacket } from "./evidence-packet.ts";
import {
  certifiedFinancials,
  chatAuthority,
  chatGapText,
  requestedSubjects,
  requestKeyFor,
  type CertifiedFinancials,
  type ChatFinancialRuntimeDeps,
} from "./financial-runtime.ts";
import { ANSWER_DEADLINES, withDeadlines, type DroppedClaims } from "./llm-runtime.ts";
import { ENGINE_READS_BY_CATALOG_METRIC, LATEST, type PlanChoice, type ReadPeriod } from "./scope-figures.ts";

// ponytail: the loop's steps and the planner's calls share one count, so a
// turn makes at most AGENT_CALLS model calls before its answer and judge;
// tune both from the perf lane's calls per turn.
const MAX_STEPS = 3;
const AGENT_CALLS = 5;
// A turn's certified calls are few (the medium budget allows 4); a run of keys this long is a defect.
const MAX_REQUEST_KEYS = 64;

export type AnalystAgentDeps = Readonly<{
  financial: Pick<ChatFinancialRuntimeDeps, "pool" | "planningModel" | "evidence" | "clock" | "resolveMention" | "priorSubjects" | "researchScope" | "hydrate">;
  // The agent's router (analystAgentRouter).
  router: () => Promise<ControlledRouter | null>;
  // An AA4 read, through the registry's argument checks (analyst-tools.ts runRegisteredAnalystTool).
  read: (name: AnalystToolName, args: Readonly<Record<string, JsonValue>>, turn: { as_of: string; user_id: string | null }) => Promise<AnalystToolResult>;
  // The answer and its judge (answer-trace.ts answerTurn).
  compose: (input: AnswerTraceInput, turn: Pick<TurnTrace, "thread_id" | "run_id" | "turn_id" | "question">, onAnswered: (deployment: string) => void) => Promise<AnsweredTurn>;
  // The cutoff the analyst tools read at.
  asOf: () => string;
  conversation?: (threadId: string) => Promise<ReadonlyArray<{ role: string; text: string }>>;
  // Records the calls that read the answer's evidence, which its seal checks (tool_call_logs).
  logToolCalls?: (threadId: string, calls: ReadonlyArray<ChatAnalystToolRuntimeToolCall>) => Promise<void>;
  registry?: ToolRegistry;
}>;

/**
 * The router the agent's loop runs on: purpose agent (AGENT_LITELLM_MODEL
 * first), each step with deadlines of its own. runToolLoop passes no
 * controls, and withDeadlines fixes when its total ends as it is made.
 */
export async function analystAgentRouter(
  env: LlmSettingsLoaderEnv,
  options: { createClient?: () => Promise<LlmChatClient> | LlmChatClient } = {},
): Promise<ControlledRouter | null> {
  const router = await createLlmRouterFromEnv(env, { ...options, purpose: "agent" });
  return router && perStepDeadlines(router);
}

export function perStepDeadlines(router: ControlledRouter): ControlledRouter {
  return { complete: (request) => router.complete(request, withDeadlines(ANSWER_DEADLINES)) };
}

type Certified = Readonly<{ block: FinancialAnswerBlock; packet: EvidencePacket }>;

/** The agent's answer to a turn, or null to leave the turn to the next runner. */
export function analystAgentRunner(deps: AnalystAgentDeps): ChatAnalystAgent {
  const registry = deps.registry ?? loadToolRegistry();
  return async (context) => {
    if (!context.userId || !isUuid(context.threadId)) return null;
    const question = context.userIntent ?? "";
    const companies = await requestedSubjects(deps.financial, context, question);
    const named = companies.subjects.flatMap((subject) => subject.resolution.status === "resolved" ? [subject] : []);
    if (companies.clarify || named.length === 0) return null;
    const router = await deps.router();
    if (!router) return null;
    const policy = createTurnToolPolicy({
      registry,
      audience: "analyst",
      classification: { bundle_id: ANALYST_AGENT_BUNDLE_ID, reason: "analyst_agent" },
      user_turn: question,
    });
    if (!policy.ok) throw new Error(policy.message);

    const turnId = context.turnId ?? context.runId;
    const authority = chatAuthority(context.userId, context.threadId, turnId);
    const asOf = deps.asOf();
    // By issuer: each company a tool may name, the turn's and the peers a read returned.
    const known = new Map(named.map((subject) => [issuerOf(subject), subject] as const));
    const labelOf = (issuer: string) => companies.labels.get(issuer) ?? known.get(issuer)?.mention ?? issuer;
    const calls = { used: 0 };
    const counted: ControlledRouter = {
      complete: (request, controls) => {
        calls.used += 1;
        return router.complete(request, controls);
      },
    };
    const planningModel: PlanningModel | null = deps.financial.planningModel && (async (request) => {
      if (calls.used >= AGENT_CALLS) throw new Error(`the turn has made its ${AGENT_CALLS} model calls`);
      calls.used += 1;
      return deps.financial.planningModel!(request);
    });
    const certified: Certified[] = [];
    const analyst: AnalystToolResult[] = [];
    const notes: string[] = [];
    const toolCalls: ChatAnalystToolRuntimeToolCall[] = [];
    const asked = new Map<string, Promise<ToolLoopOutput>>();
    const keys = requestKeys(deps.financial.pool, authority, context.threadId, turnId);
    // Each company's filings are fetched once a turn, before its first certified call plans, as
    // the financial lane fetches them; the fetch streams nothing, so a turn left to the next runner shows none.
    const fetched = new Map<string, Promise<boolean>>();
    const stillLoading = (issuers: ReadonlyArray<string>) => Promise.all(issuers.map((issuer) => {
      const pending = fetched.get(issuer) ?? (deps.financial.hydrate
        ? deps.financial.hydrate([{ issuer_id: issuer, label: labelOf(issuer) }], { emit: QUIET, turnId })
          .then((loading) => loading.has(issuer))
          .catch((reason: unknown) => {
            console.warn("[chat] fetching a company's filings failed; the analyst agent answers from what is on file", reason);
            return true;
          })
        : Promise.resolve(false));
      fetched.set(issuer, pending);
      return pending.then((loading) => (loading ? [issuer] : []));
    })).then((lists) => lists.flat());

    const certify = async (args: JsonObject): Promise<ToolLoopOutput> => {
      const ask = certifiedAsk(args, known);
      if ("invalid" in ask) return invalid("certified_financials", ask.invalid);
      // The same ask twice in a turn is one run, answered once.
      const prior = asked.get(ask.fingerprint);
      if (prior) return prior;
      const answer = (async (): Promise<ToolLoopOutput> => {
        const loading = await stillLoading(ask.subjects);
        if (loading.length > 0) notes.push(`Filings for ${labelList(loading.map(labelOf))} are still loading; ask again in a minute.`);
        const key = await keys(ask.fingerprint);
        const subjects = ask.subjects.map((issuer) => known.get(issuer)!);
        const who = labelList(ask.subjects.map(labelOf));
        if (key === null) {
          notes.push(`${who}: ${chatGapText("request_conflict")}`);
          return { content: JSON.stringify({ tool: "certified_financials", status: "gap", reason: "request_conflict" }) };
        }
        // Each call plans only its own ask: no other question, and no pick the turn's clarification offered.
        const { clarificationAnswer: _picked, ...turn } = context;
        const outcome = await certifiedFinancials({ ...deps.financial, planningModel }, {
          context: { ...turn, userIntent: ask.question },
          subjects,
          choice: ask.choice,
          labels: new Map(subjects.map((subject) => [issuerOf(subject), labelOf(issuerOf(subject))])),
          authority,
          requestKey: requestKeyFor(turnId, key.n),
          // The block is kept here and saved once with the turn's answer.
          persistParent: async () => {},
          originRef: key.origin,
        });
        return certifiedOutput(outcome, who, async (published) => {
          const packet = await published.packet();
          certified.push({ block: published.block, packet });
          return packet;
        }, notes);
      })();
      asked.set(ask.fingerprint, answer);
      return answer;
    };

    const readStored = async (name: AnalystToolName, args: JsonObject): Promise<ToolLoopOutput> => {
      const result = await deps.read(name, lowercasedRefs(args), { as_of: asOf, user_id: context.userId ?? null });
      analyst.push(result);
      if (result.tool === "get_peer_set" && result.status === "ok") {
        for (const peer of result.peers) {
          const issuer = peer.issuer_id.toLowerCase();
          if (!known.has(issuer)) known.set(issuer, { mention: peer.label, resolution: { status: "resolved", subject_ref: { kind: "issuer", id: issuer }, label: peer.label } });
        }
      }
      const note = statusNote(result, labelList(argIssuers(args).map(labelOf)), args.role === "competitor");
      if (note) notes.push(note);
      return { content: JSON.stringify(readSummary(result)), ...(isFailure(result) ? { isError: true } : {}) };
    };

    const execute = async (call: LlmToolCall): Promise<ToolLoopOutput> => {
      const output = call.name === "certified_financials"
        ? await certify(call.arguments)
        : isAnalystToolName(call.name) ? await readStored(call.name, call.arguments) : invalid(call.name, "no such tool");
      toolCalls.push({
        tool_call_id: randomUUID(),
        tool_name: call.name,
        status: output.isError ? "error" : "ok",
        bundle_id: ANALYST_AGENT_BUNDLE_ID,
        arguments: call.arguments,
        result: { status: statusOf(output.content) },
      });
      return output;
    };

    const template = policy.selection.prompt_template;
    const conversation = await deps.conversation?.(context.threadId) ?? [];
    const loop = await runToolLoop({
      router: counted,
      policy,
      maxSteps: MAX_STEPS,
      execute,
      request: {
        messages: [
          { role: "system", content: [template.system_prompt, template.policy_prompt, ...GATHER_RULES].join(" ") },
          { role: "user", content: JSON.stringify({ question, companies: named.map((subject) => companyEntry(subject, companies.carried, labelOf)), conversation }) },
        ],
        tools: policy.selection.tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.input_json_schema as JsonObject })),
        temperature: 0,
        reasoning: "low",
        maxTokens: 4096,
      },
    });
    if (loop.steps.every((step) => (step.reply.toolCalls ?? []).length === 0)) return null;

    const packet = mergePackets({
      engine: certified.map((answer) => answer.packet),
      analyst,
      notes: [...new Set(notes)],
      labels: new Map([...known.keys()].map((issuer) => [issuer, labelOf(issuer)])),
      cutoff: asOf,
    });
    await deps.logToolCalls?.(context.threadId, toolCalls);
    // The calls that read the evidence: a seal that binds a source or claim checks each against its log.
    const readCalls = toolCalls.filter((entry) => entry.status === "ok").map((entry) => entry.tool_call_id);
    const snapshotId = randomUUID();
    const subjectRefs = named.map((subject) => ({ kind: "issuer" as const, id: issuerOf(subject) }));
    const cardId = randomUUID();
    const card = {
      id: cardId, kind: "rich_text", snapshot_id: snapshotId, data_ref: { kind: "rich_text", id: cardId },
      source_refs: [], as_of: asOf, analyst_commentary: true, segments: [], subject_refs: subjectRefs,
    };
    const noted = packet.gaps.length === 0 ? [] : [{ ...noteBlock({ snapshotId, asOf }, "agent:not-covered", packet.gaps.join(" ")), subject_refs: subjectRefs, tool_call_ids: readCalls }];
    let answeredBy: string | undefined;
    let answer: Pick<AnsweredTurn, "assertions" | "blocks" | "judging" | "without">;
    try {
      answer = await deps.compose({
        context: { userIntent: question, bundleId: ANALYST_AGENT_BUNDLE_ID },
        blocks: [card],
        toolCalls: [],
        factBlocks: noted,
        conversation,
        packet,
        instructions: ANSWER_RULES,
      }, { thread_id: context.threadId, run_id: context.runId, ...(context.turnId ? { turn_id: context.turnId } : {}), question }, (deployment) => {
        answeredBy = deployment;
      });
      // The save is claimed after the judge, so the turn stays stoppable until then.
      if (answer.judging) answer = { ...answer, assertions: (await answer.judging.done).assertions };
    } catch (reason) {
      if (!(reason instanceof LlmRouterError || reason instanceof LlmProviderError)) throw reason;
      console.warn("[chat] the analyst agent's answer could not be written; the turn answers with its certified figures alone", reason);
      answer = { assertions: null, blocks: [], without: () => ({ blocks: [] }) };
    }

    const claims = analyst.flatMap((result) => (result.status === "ok" && "claims" in result ? result.claims : []));
    const cited = citedSources(answer.assertions, packet);
    // Every engine block is named for its unit, and a message proves nothing of an id two blocks share.
    const certifiedBlocks = certified.map((answer, i) => ({ ...answer.block, id: `${answer.block.id}-${i + 1}` }) as Record<string, unknown>);
    // The seal needs one block of the agent's own: with no card and no note, a typed line says why.
    const unwritten = [{
      ...noteBlock({ snapshotId, asOf }, "agent:unwritten", certified.length > 0 ? COMMENTARY_UNAVAILABLE : NO_ANSWER),
      subject_refs: subjectRefs,
      tool_call_ids: readCalls,
    }];
    const turnBlocks = (written: ReadonlyArray<Record<string, unknown>>) => {
      // An answer that rendered no assertion is not shown: the certified blocks stand alone.
      const own = [...written.filter(rendered).map((block) => ({ ...withRefs(block, claims, cited), tool_call_ids: readCalls })), ...noted];
      return [...certifiedBlocks, ...(own.length > 0 ? own : unwritten)];
    };
    // The blocks as every verdict left them: judged already, watch hears them at once. The turn
    // seals and saves these, so it reveals nothing after its seal.
    const turnAnswer = (shown: Pick<AnsweredTurn, "blocks" | "judging">): Pick<ChatAnalystToolRuntimeResult, "blocks"> => {
      let settled = shown.blocks;
      shown.judging?.watch((blocks) => {
        settled = blocks;
      });
      return { blocks: turnBlocks(settled) };
    };
    const scope = await deps.financial.researchScope?.({ ...context, subjectPreResolutions: companies.resolved, subjectPreResolution: companies.resolved[0] }, Promise.resolve(null))
      .catch((reason: unknown) => {
        console.warn("[chat] research scope unavailable; saving the analyst agent's answer without it", reason);
        return undefined;
      });
    return {
      snapshot_id: snapshotId,
      verification: { ok: true },
      tool_calls: toolCalls,
      ...turnAnswer(answer),
      without: (dropped: DroppedClaims) => turnAnswer(answer.without(dropped)),
      ...(answeredBy ? { answered_by: answeredBy } : {}),
      ...(answer.assertions ? { assertion_report: answer.assertions } : {}),
      ...(scope ? { research_scope: { ...scope, companies: named.map((subject) => ({ issuer_id: issuerOf(subject), label: labelOf(issuerOf(subject)) })) } } : {}),
    };
  };
}

const GATHER_RULES = [
  "Read stored sources with the tools until you hold what the question needs, then reply DONE and nothing else.",
  "You do not write the answer: it is written later from what the tools returned, and your words are never shown.",
  "Never rely on your own knowledge of a company, not even to choose what to read.",
  "Name only the companies listed, or peers a get_peer_set result returned, by their subject_ref.",
  "Ask certified_financials for the reported figures the question asks for, and never state or compute one yourself;",
  "when it asks different figures of different companies, ask each company's in its own call.",
  "get_company_profile reads what a company does and sells; get_claims reads risk factors (predicate risk.factor), competition",
  "(business.competition, and role competitor for other filers that name it) and customers; get_peer_set reads industry peers;",
  "get_analyst_consensus reads attributed analyst consensus, which is what analysts expect: no certified figure stands in for it.",
  "A question about competitors reads the business.competition claims and the company's industry peers.",
  "Read every company the question is about, in one step when you can.",
];

// The fetch's progress events go nowhere: they would start the stream before the agent knows it takes the turn.
const QUIET = (() => undefined) as unknown as ChatTurnRunContext["emit"];

const NO_ANSWER = "No answer could be written from the stored sources read for this question.";

const ANSWER_RULES = [
  "evidence_packet.claims also hold what a company's 10-K states (its business, products, customers, competition and risk factors),",
  "attributed analyst consensus values, and industry peers: cite each as a management_attribution with its C id, which quotes it as stored.",
  "Say what a company does or faces only as a claim states it, never from your own knowledge, and never write Buy, Hold, Sell or any recommendation.",
  "Write at most two analyst_inference entries: the takeaway and the counterpoint.",
];

const issuerOf = (subject: RequestedSubject) => (subject.resolution as { subject_ref: FinancialSubjectRef }).subject_ref.id.toLowerCase();

function companyEntry(subject: RequestedSubject, carried: ReadonlyArray<string>, labelOf: (issuer: string) => string): JsonObject {
  const issuer = issuerOf(subject);
  return { label: labelOf(issuer), subject_ref: { kind: "issuer", id: issuer }, ...(carried.includes(subject.mention) ? { carried_from_previous_answer: true } : {}) };
}

type CertifiedAsk = Readonly<{ subjects: ReadonlyArray<string>; choice: PlanChoice; question: string; fingerprint: string }>;

const PERIOD_KINDS = new Set(["latest", "fiscal_year", "fiscal_quarter"]);
const QUARTERS = new Set(["Q1", "Q2", "Q3", "Q4"]);

// A certified_financials call's arguments as one engine request, or why they are not one.
export function certifiedAsk(args: JsonObject, known: ReadonlyMap<string, RequestedSubject>): CertifiedAsk | { invalid: string } {
  const refs = args.subject_refs;
  if (!Array.isArray(refs) || refs.length === 0) return { invalid: "subject_refs names the companies, as the prompt lists them" };
  const subjects = refs.map((ref) => (isRecord(ref) && ref.kind === "issuer" && typeof ref.id === "string" ? ref.id.toLowerCase() : null));
  if (subjects.some((issuer) => issuer === null || !known.has(issuer))) return { invalid: "name each company by a subject_ref the prompt or a peer read gave" };
  const question = typeof args.question === "string" ? args.question.trim() : "";
  if (question === "") return { invalid: "question says the ask in one sentence" };
  const metrics = args.metrics;
  if (metrics !== undefined && !(Array.isArray(metrics) && metrics.length > 0 && metrics.every((metric) => typeof metric === "string" && Object.hasOwn(ENGINE_READS_BY_CATALOG_METRIC, metric)))) {
    return { invalid: `metrics are among ${Object.keys(ENGINE_READS_BY_CATALOG_METRIC).join(", ")}` };
  }
  const period = readPeriod(args.period);
  if (period === null) return { invalid: "period is latest, a fiscal_year with its year, or a fiscal_quarter with its quarter" };
  const companies = [...new Set(subjects as string[])];
  const keptMetrics = metrics === undefined ? null : [...new Set(metrics as string[])].sort();
  // Named metrics plan with no model, so their ask is the figures; any other is the question's.
  const choice: PlanChoice = keptMetrics ? { kind: "kept_figures", metrics: keptMetrics, period } : { kind: "planner" };
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ companies: [...companies].sort(), ...(keptMetrics ? { metrics: keptMetrics, period } : { question: question.toLowerCase().replace(/\s+/g, " ") }) }))
    .digest("hex").slice(0, 16);
  return { subjects: companies, choice, question, fingerprint };
}

function readPeriod(value: JsonValue | undefined): ReadPeriod | null {
  if (value === undefined) return LATEST;
  if (!isRecord(value) || typeof value.kind !== "string" || !PERIOD_KINDS.has(value.kind)) return null;
  const year = typeof value.fiscal_year === "number" && Number.isInteger(value.fiscal_year) ? value.fiscal_year : null;
  if (value.kind === "latest") return value.period === "quarter" || value.period === "fiscal_year" ? { kind: "latest", period: value.period } : LATEST;
  if (value.kind === "fiscal_year") return year === null ? null : { kind: "fiscal_year", fiscal_year: year };
  return typeof value.fiscal_period === "string" && QUARTERS.has(value.fiscal_period)
    ? { kind: "fiscal_quarter", fiscal_period: value.fiscal_period as "Q1" | "Q2" | "Q3" | "Q4", fiscal_year: year }
    : null;
}

/**
 * A turn's request keys, turn:<id>:1 on, one per ask. A retry gives an ask the
 * key an earlier attempt gave it, and never a key another ask holds: a key
 * resumes its stored plan, whatever the call asks now. The plan records the
 * ask that made it in its origin ref, which its semantic hash leaves out.
 * Keys are taken one at a time, so two calls in one step never share one.
 */
export function requestKeys(
  pool: ChatFinancialRuntimeDeps["pool"],
  authority: ReturnType<typeof chatAuthority>,
  threadId: string,
  turnId: string,
): (fingerprint: string) => Promise<{ n: number; origin: string } | null> {
  const taken = new Map<number, string>();
  let queue: Promise<unknown> = Promise.resolve();
  return (fingerprint) => {
    const origin = `chat:${threadId}:${turnId}:${fingerprint}`;
    const next = queue.then(async () => {
      for (let n = 1; n <= MAX_REQUEST_KEYS; n++) {
        const held = taken.get(n);
        if (held !== undefined) {
          if (held === fingerprint) return { n, origin };
          continue;
        }
        const stored = await findPlanForRequest(pool, { authority, request_key: requestKeyFor(turnId, n) });
        if (stored !== null && stored.origin.ref !== origin) continue;
        taken.set(n, fingerprint);
        return { n, origin };
      }
      return null;
    });
    queue = next.catch(() => undefined);
    return next;
  };
}

async function certifiedOutput(
  outcome: CertifiedFinancials,
  who: string,
  keep: (published: Extract<CertifiedFinancials, { status: "published" }>) => Promise<EvidencePacket>,
  notes: string[],
): Promise<ToolLoopOutput> {
  const output = (status: string, fields: JsonObject = {}): ToolLoopOutput => ({ content: JSON.stringify({ tool: "certified_financials", status, ...fields }) });
  switch (outcome.status) {
    case "published": {
      const packet = await keep(outcome);
      return output("published", {
        run_id: outcome.run_id,
        figures: packet.figures.map((figure) => ({
          ...(figure.company ? { company: figure.company } : {}),
          metric: figure.metric,
          period: figure.period ?? "",
          ...(figure.gap === undefined ? { value: figure.value } : { gap: figure.gap }),
        })),
      });
    }
    case "existing":
      // Its sealed block lived only in the attempt that published it.
      notes.push(`${who}: these figures were computed in an earlier attempt of this turn and cannot be shown again.`);
      return output("existing", { run_id: outcome.run_id });
    case "clarification":
      notes.push(`${who}: the figures were not computed, as the request needs a choice first (${outcome.clarification.question}).`);
      return output("clarification", { question: outcome.clarification.question, choices: outcome.clarification.choices.map((choice) => choice.label) });
    case "declined":
    case "gap":
      notes.push(`${who}: ${chatGapText(outcome.reason)}`);
      return output(outcome.status, { reason: outcome.reason });
  }
}

function invalid(tool: string, reason: string): ToolLoopOutput {
  return { content: JSON.stringify({ tool, status: "invalid_arguments", reason }), isError: true };
}

const isFailure = (result: AnalystToolResult) => result.status === "invalid_arguments" || result.status === "no_subject" || result.status === "unavailable";

// What the model hears of a read: its status, and each entry's words.
function readSummary(result: AnalystToolResult): JsonObject {
  const base = { tool: result.tool, status: result.status, ...("reason" in result ? { reason: result.reason } : {}) };
  if ("reads" in result) {
    return {
      ...base,
      truncated: result.truncated,
      ...(result.status === "ok" ? { claims: result.claims.map((claim) => ({ filer: claim.filer_label, predicate: claim.predicate, text: claim.text_canonical })) } : {}),
      unread_items: result.reads.filter((read) => read.state !== "read" || read.newer_unread !== null).map((read) => ({ filer: read.filer_label, item: read.item, state: read.state })),
      no_filing: result.no_filing.map((issuer) => issuer.label),
    };
  }
  if (result.tool === "get_peer_set" && result.status === "ok") {
    return { ...base, company: result.company, industry: result.industry, peers: result.peers.map((peer) => ({ label: peer.label, subject_ref: { kind: "issuer", id: peer.issuer_id.toLowerCase() } })) };
  }
  if (result.tool === "get_analyst_consensus" && result.status === "ok") {
    return { ...base, company: result.company, captured_on: result.captured_on, values: result.values.map((value) => ({ label: value.label, value: value.raw_value, unit: value.unit, fiscal_period: value.fiscal_period })) };
  }
  return base;
}

// The note a read that found nothing leaves, for the answer's notes: typed
// text, never the model's. An item not read in full and a company with no
// 10-K are the packet's own entries (mergePackets); a read the model asked
// wrongly is its to fix, and leaves none.
export function statusNote(result: AnalystToolResult, who: string, competitor = false): string | null {
  switch (result.status) {
    case "no_business_claims":
      return `${who}: its latest 10-K's business section (Item 1) was read in full and states no business claims.`;
    case "no_claims":
      return competitor
        ? `${who}: no other company's 10-K on file names it as a competitor.`
        : `${who}: the 10-K items read in full state no claims of the kind asked for.`;
    case "no_peers":
      return `${who}: no industry peers are on file (${result.reason === "no_industry" ? "no source gives its industry" : "no other company shares its industry"}).`;
    case "no_consensus":
      return `${who}: no analyst consensus captured in the 7 days to the cutoff is on file.`;
    case "unavailable":
      return `${who}: the stored sources could not be read just now, so this says nothing about what is on file.`;
    case "incomplete_read":
    case "ok":
      return "truncated" in result && result.truncated ? `${who}: a read limit left some 10-K filers or claims out.` : null;
    default:
      return null;
  }
}

// AA4's executors compare issuer ids as text, lowercase as Postgres prints them.
function lowercasedRefs(args: JsonObject): Readonly<Record<string, JsonValue>> {
  const lower = (ref: JsonValue): JsonValue => (isRecord(ref) && typeof ref.id === "string" ? { ...ref, id: ref.id.toLowerCase() } : ref);
  return {
    ...args,
    ...(args.subject_ref === undefined ? {} : { subject_ref: lower(args.subject_ref) }),
    ...(Array.isArray(args.subject_refs) ? { subject_refs: args.subject_refs.map(lower) } : {}),
  };
}

function argIssuers(args: JsonObject): string[] {
  const refs = Array.isArray(args.subject_refs) ? args.subject_refs : [args.subject_ref];
  return refs.flatMap((ref) => (isRecord(ref) && typeof ref.id === "string" ? [ref.id.toLowerCase()] : []));
}

function statusOf(content: string): string {
  try {
    const parsed: unknown = JSON.parse(content);
    return isRecord(parsed) && typeof parsed.status === "string" ? parsed.status : "unknown";
  } catch {
    return "unknown";
  }
}

// A card the answer rendered from its assertions has commentary parts; the fallback sentence has none.
const rendered = (block: Record<string, unknown>) => Array.isArray(block.commentary) && block.commentary.length > 0;

// The sources of the claims no claim row stores (consensus, peers) that the answer cites, which seal as sources.
function citedSources(report: AnsweredTurn["assertions"], packet: EvidencePacket): ReadonlyArray<string> {
  const cited = new Set((report?.accepted ?? []).flatMap((entry) => entry.evidence));
  return packet.claims.filter((claim) => cited.has(claim.id) && !isUuid(claim.claim_id) && isUuid(claim.source_id)).map((claim) => claim.source_id);
}

// What the card's seal binds: the 10-K claims its segments quote, their documents and sources, and any other source it cites.
function withRefs(
  block: Record<string, unknown>,
  claims: ReadonlyArray<{ claim_id: string; document_id: string; source_id: string }>,
  sources: ReadonlyArray<string>,
): Record<string, unknown> {
  const segments = Array.isArray(block.segments) ? block.segments as Array<{ type?: unknown; ref_kind?: unknown; ref_id?: unknown }> : [];
  const quoted = new Set(segments.flatMap((segment) => (segment.type === "ref" && segment.ref_kind === "claim" && typeof segment.ref_id === "string" ? [segment.ref_id] : [])));
  const used = claims.filter((claim) => quoted.has(claim.claim_id));
  const own = Array.isArray(block.source_refs) ? block.source_refs.filter((id): id is string => typeof id === "string") : [];
  return {
    ...block,
    source_refs: [...new Set([...own, ...used.map((claim) => claim.source_id), ...sources])],
    claim_refs: [...new Set(used.map((claim) => claim.claim_id))],
    document_refs: [...new Set(used.map((claim) => claim.document_id))],
  };
}

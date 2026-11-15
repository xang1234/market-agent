import { createHash, randomUUID } from "node:crypto";

import type { FinancialSubjectRef } from "../../financial-core/src/index.ts";
import type { Clarification, PlanningModel, RequestedSubject } from "../../financial-engine/src/planner.ts";
import { createLlmRouterFromEnv, LlmClientError, LlmProviderError, LlmRouterError, withLlmAbortSignal, type LlmChatClient, type LlmSettingsLoaderEnv } from "../../llm/src/index.ts";
import type { ControlledRouter, LlmToolCall } from "../../llm/src/router.ts";
import { runToolLoop, type ToolLoopOutput, type ToolLoopResult } from "../../llm/src/tool-loop.ts";
import type { JsonObject, JsonValue } from "../../shared/src/json.ts";
import { isRecord } from "../../shared/src/http.ts";
import type { FinancialAnswerBlock } from "../../snapshot/src/financial-verifier.ts";
import { createTurnToolPolicy, loadToolRegistry, type ToolRegistry } from "../../tools/src/index.ts";
import { CLAIM_PREDICATES, isAnalystToolName, type AnalystToolName, type AnalystToolResult } from "./analyst-tools.ts";
import type { AnsweredTurn, AnswerTraceInput, TurnTrace } from "./answer-trace.ts";
import { isUuid, noteBlock } from "./chat-ids.ts";
import { COMMENTARY_UNAVAILABLE } from "./engine-commentary.ts";
import { ANALYST_AGENT_BUNDLE_ID } from "./bundle-routing.ts";
import { labelList, type ChatAnalystAgent, type ChatAnalystToolRuntimeResult, type ChatAnalystToolRuntimeToolCall, type ChatTurnRunContext } from "./coordinator.ts";
import { mergePackets, type EvidencePacket } from "./evidence-packet.ts";
import {
  certifiedFinancials,
  chatAuthority,
  chatGapText,
  leftOutNotes,
  requestedSubjects,
  requestKeyFor,
  type CertifiedFinancials,
  type ChatFinancialRuntimeDeps,
} from "./financial-runtime.ts";
import { ANSWER_DEADLINES, withDeadlines, type DroppedClaims } from "./llm-runtime.ts";
import { ENGINE_READS_BY_CATALOG_METRIC, INCOME_LINE_READS, LATEST, type PlanChoice, type ReadPeriod } from "./scope-figures.ts";
import { turnStopSignal } from "./turn-stop.ts";

const MAX_STEPS = 3;
const TURN_CALLS = 8;
const ANSWER_CALLS = 3;
const DEADLINES = { readMs: 75_000, turnMs: 120_000 };

export type AnalystAgentDeps = Readonly<{
  financial: Pick<ChatFinancialRuntimeDeps, "pool" | "evidence" | "resolveMention" | "priorSubjects" | "researchScope" | "hydrate">;
  // Each model-facing dep calls beforeModelCall before every model attempt it makes; it throws once the turn has made its calls.
  router: (beforeModelCall: () => void) => Promise<ControlledRouter | null>;
  planner?: (beforeModelCall: () => void) => PlanningModel;
  read: (name: AnalystToolName, args: Readonly<Record<string, JsonValue>>, turn: { as_of: string; user_id: string | null }) => Promise<AnalystToolResult>;
  compose: (input: AnswerTraceInput, turn: Pick<TurnTrace, "thread_id" | "run_id" | "turn_id" | "question">, onAnswered: (deployment: string) => void, beforeModelCall: () => void) => Promise<AnsweredTurn>;
  asOf: () => string;
  conversation?: (threadId: string) => Promise<ReadonlyArray<{ role: string; text: string }>>;
  logToolCalls?: (threadId: string, calls: ReadonlyArray<ChatAnalystToolRuntimeToolCall>) => Promise<void>;
  registry?: ToolRegistry;
  deadlines?: Readonly<{ readMs: number; turnMs: number }>;
}>;

export class TurnDeadline extends Error {
  constructor() {
    super("the turn ran out of time");
    this.name = "TurnDeadline";
  }
}

export async function analystAgentRouter(
  env: LlmSettingsLoaderEnv,
  options: { createClient?: () => Promise<LlmChatClient> | LlmChatClient } = {},
): Promise<ControlledRouter | null> {
  const router = await createLlmRouterFromEnv(env, { ...options, purpose: "agent" });
  return router && perStepDeadlines(router);
}

function perStepDeadlines(router: ControlledRouter): ControlledRouter {
  return { complete: (request) => router.complete(request, withDeadlines(ANSWER_DEADLINES)) };
}

type Certified = Readonly<{ block: FinancialAnswerBlock; packet: EvidencePacket; subjects: ReadonlyArray<string> }>;

export function analystAgentRunner(deps: AnalystAgentDeps): ChatAnalystAgent {
  let registry = deps.registry;
  const agentTurn = async (context: ChatTurnRunContext, signal: AbortSignal): ReturnType<ChatAnalystAgent> => {
    if (!context.userId || !isUuid(context.threadId)) return null;
    const question = context.userIntent ?? "";
    const meter = callMeter(TURN_CALLS);
    const reading = context.reading?.(meter(ANSWER_CALLS)) ?? Promise.resolve(null);
    const companies = await requestedSubjects(deps.financial, context, question, true);
    const named = companies.subjects.flatMap((subject) => subject.resolution.status === "resolved" ? [subject] : []);
    if (companies.clarify || companies.subjects.some((subject) => subject.resolution.status === "ambiguous")) return "pick_company";
    if (named.length === 0) return null;
    const read = await reading;
    let loopRefused = false;
    let answerRefused = false;
    const router = await deps.router(meter(ANSWER_CALLS, () => {
      loopRefused = true;
    }));
    if (!router) return null;
    registry ??= loadToolRegistry();
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
    const known = new Map(named.map((subject) => [issuerOf(subject), subject] as const));
    const labelOf = (issuer: string) => companies.labels.get(issuer) ?? known.get(issuer)?.mention ?? issuer;
    const whoOf = (args: JsonObject) => labelList(argIssuers(args).filter((issuer) => known.has(issuer)).map(labelOf));
    const certified: Certified[] = [];
    const askedFor = new Set<string>();
    const analyst: AnalystToolResult[] = [];
    const unmatched = companies.subjects.flatMap((subject) => (subject.resolution.status === "not_found" ? [subject.mention] : []));
    const notes: string[] = [
      ...leftOutNotes({ notFound: unmatched }),
      ...companies.notFound.map((name) => `"${name}" did not match a company name or ticker on file; try the ticker.`),
    ];
    const heldCompetitorNotes: string[] = [];
    let readCompetition = false;
    const toolCalls: ChatAnalystToolRuntimeToolCall[] = [];
    const asked = new Map<string, Promise<ToolLoopOutput>>();
    const fetched = new Map<string, Promise<boolean>>();
    const stillLoading = (issuers: ReadonlyArray<string>) => Promise.all(issuers.map((issuer) => {
      const pending = fetched.get(issuer) ?? (deps.financial.hydrate
        ? deps.financial.hydrate([{ issuer_id: issuer, label: labelOf(issuer) }], { emit: QUIET, turnId })
          .then((loading) => loading.has(issuer))
          .catch((reason: unknown) => {
            console.warn("[chat] fetching a company's filings failed; the analyst agent answers from what is on file", reason);
            return false;
          })
        : Promise.resolve(false));
      fetched.set(issuer, pending);
      return pending.then((loading) => (loading ? [issuer] : []));
    })).then((lists) => lists.flat());

    const certify = async (args: JsonObject): Promise<ToolLoopOutput> => {
      const ask = certifiedAsk(args, known, read?.income_items ?? []);
      if ("invalid" in ask) return invalid("certified_financials", ask.invalid);
      const prior = asked.get(ask.fingerprint);
      if (prior) return prior;
      for (const issuer of ask.subjects) askedFor.add(issuer);
      const answer = (async (): Promise<ToolLoopOutput> => {
        const loading = await stillLoading(ask.subjects);
        if (loading.length > 0) notes.push(`Filings for ${labelList(loading.map(labelOf))} are still loading; ask again in a minute.`);
        const subjects = ask.subjects.map((issuer) => known.get(issuer)!);
        const who = labelList(ask.subjects.map(labelOf));
        const { clarificationAnswer: _picked, ...turn } = context;
        let plannerRefused = false;
        // A planner call leaves one for the loop's next step, beside the answer's.
        const planningModel = deps.planner?.(meter(ANSWER_CALLS + 1, () => {
          plannerRefused = true;
        })) ?? null;
        const outcome = await certifiedFinancials({ ...deps.financial, planningModel, clock: () => new Date(deps.asOf()) }, {
          context: { ...turn, userIntent: ask.question },
          subjects,
          choice: ask.choice,
          labels: new Map(subjects.map((subject) => [issuerOf(subject), labelOf(issuerOf(subject))])),
          authority,
          requestKey: requestKeyFor(turnId, context.runId, ask.fingerprint),
          persistParent: async () => {},
        });
        if (outcome.status === "declined" && outcome.reason === "planning_unavailable" && plannerRefused) {
          notes.push(`${who}: the figures were not computed, as the turn reached its limit of model calls.`);
          return { content: JSON.stringify({ tool: "certified_financials", status: "declined", reason: "turn_call_limit" }) };
        }
        return certifiedOutput(outcome, who, async (published) => {
          const packet = await published.packet();
          certified.push({ block: published.block, packet, subjects: ask.subjects });
          return packet;
        }, notes);
      })();
      asked.set(ask.fingerprint, answer);
      return answer;
    };

    const readStored = async (name: AnalystToolName, args: JsonObject): Promise<ToolLoopOutput> => {
      if (argIssuers(args).some((issuer) => !known.has(issuer))) return invalid(name, UNKNOWN_COMPANY);
      const result = await deps.read(name, lowercasedRefs(args), { as_of: asOf, user_id: context.userId ?? null });
      analyst.push(result);
      if (result.tool === "get_peer_set" && result.status === "ok") {
        for (const peer of result.peers) {
          const issuer = peer.issuer_id.toLowerCase();
          if (!known.has(issuer)) known.set(issuer, { mention: peer.label, resolution: { status: "resolved", subject_ref: { kind: "issuer", id: issuer }, label: peer.label } });
        }
      }
      const competitor = args.role === "competitor";
      const predicates: ReadonlyArray<JsonValue> = Array.isArray(args.predicates) ? args.predicates : CLAIM_PREDICATES;
      if (!isFailure(result) && (name === "get_peer_set" || (name === "get_claims" && !competitor && predicates.includes("business.competition")))) readCompetition = true;
      const note = statusNote(result, whoOf(args), competitor);
      if (note) (competitor && result.status === "no_claims" ? heldCompetitorNotes : notes).push(note);
      return { content: JSON.stringify(readSummary(result)), ...(isFailure(result) ? { isError: true } : {}) };
    };

    const inFlight = new Set<Promise<ToolLoopOutput>>();
    const execute = async (call: LlmToolCall): Promise<ToolLoopOutput> => {
      const work = call.name === "certified_financials"
        ? certify(call.arguments)
        : isAnalystToolName(call.name) ? readStored(call.name, call.arguments) : Promise.resolve(invalid(call.name, "no such tool"));
      inFlight.add(work);
      const output = await work.finally(() => inFlight.delete(work));
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
    const readingDeadline = new AbortController();
    const readTimer = setTimeout(() => readingDeadline.abort(new TurnDeadline()), (deps.deadlines ?? DEADLINES).readMs);
    const loop = await withLlmAbortSignal(AbortSignal.any([signal, readingDeadline.signal]), () => runToolLoop({
      router,
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
    })).catch(async (reason: unknown) => {
      await Promise.allSettled([...inFlight]);
      if (!isModelFailure(reason)) throw reason;
      console.warn("[chat] the analyst agent's reading stopped early; it answers from what it read", reason);
      notes.push(loopRefused ? UNFINISHED.calls : reason instanceof TurnDeadline ? UNFINISHED.time : UNFINISHED.model_failed);
      return null;
    }).finally(() => clearTimeout(readTimer));
    if (loop) notes.push(...stopNotes(loop, whoOf));
    if (!toolCalls.some((entry) => entry.status === "ok")) return null;

    const namedIds = new Set(named.map(issuerOf));
    const covered = [...new Set([...namedIds, ...certified.flatMap((answer) => answer.subjects)])];
    const packet = mergePackets({
      engine: certified.map((answer) => answer.packet),
      analyst,
      figuresAskedFor: [...askedFor].map(labelOf),
      notes: [...new Set([...notes, ...(readCompetition ? heldCompetitorNotes : [])])],
      labels: new Map([...known.keys()].map((issuer) => [issuer, labelOf(issuer)])),
      cutoff: asOf,
    });
    await deps.logToolCalls?.(context.threadId, toolCalls);
    const readCalls = toolCalls.filter((entry) => entry.status === "ok").map((entry) => entry.tool_call_id);
    const snapshotId = randomUUID();
    const subjectRefs = covered.map((id) => ({ kind: "issuer" as const, id }));
    const cardId = randomUUID();
    const card = {
      id: cardId, kind: "rich_text", snapshot_id: snapshotId, data_ref: { kind: "rich_text", id: cardId },
      source_refs: [], as_of: asOf, analyst_commentary: true, segments: [], subject_refs: subjectRefs,
    };
    const noted = packet.gaps.length === 0 ? [] : [{ ...noteBlock({ snapshotId, asOf }, "agent:not-covered", packet.gaps.join(" ")), subject_refs: subjectRefs, tool_call_ids: readCalls }];
    let answeredBy: string | undefined;
    let answer: Pick<AnsweredTurn, "assertions" | "blocks" | "judging" | "without">;
    let failed = false;
    const askedFigures = certified.length > 0;
    try {
      answer = await deps.compose({
        context: { userIntent: question, bundleId: ANALYST_AGENT_BUNDLE_ID },
        blocks: [card],
        toolCalls,
        factBlocks: noted,
        conversation,
        packet,
        instructions: askedFigures ? [...ANSWER_RULES, ANALYSIS_RULE] : ANSWER_RULES,
        ...(askedFigures ? {} : { answerShape: DESCRIPTION_SHAPE, inferences: false as const }),
      }, { thread_id: context.threadId, run_id: context.runId, ...(context.turnId ? { turn_id: context.turnId } : {}), question }, (deployment) => {
        answeredBy = deployment;
      }, meter(0, () => {
        answerRefused = true;
      }));
      if (answer.judging) answer = { ...answer, assertions: (await answer.judging.done).assertions };
    } catch (reason) {
      if (!isModelFailure(reason)) throw reason;
      console.warn("[chat] the analyst agent's answer could not be written; the turn answers with what it read alone", reason);
      failed = true;
      answer = { assertions: null, blocks: [], without: () => ({ blocks: [] }) };
    }

    const claims = analyst.flatMap((result) => (result.status === "ok" && "claims" in result ? result.claims : []));
    const cited = citedSources(answer.assertions, packet);
    const certifiedBlocks = certified.map((answer, i) => ({ ...answer.block, id: `${answer.block.id}-${i + 1}` }) as Record<string, unknown>);
    const unwritten = [{
      ...noteBlock({ snapshotId, asOf }, "agent:unwritten", certified.length > 0 ? COMMENTARY_UNAVAILABLE : failed ? ANSWER_FAILED : NO_ANSWER),
      subject_refs: subjectRefs,
      tool_call_ids: readCalls,
    }];
    const turnBlocks = (written: ReadonlyArray<Record<string, unknown>>) => {
      const shown = written.filter(rendered).map((block) => ({ ...withRefs(block, claims, cited), tool_call_ids: readCalls }));
      const spent = answerRefused && shown.length > 0 ? [{ ...noteBlock({ snapshotId, asOf }, "agent:calls-spent", ANALYSIS_LEFT_OUT), subject_refs: subjectRefs, tool_call_ids: readCalls }] : [];
      const own = [...shown, ...(failed ? unwritten : []), ...noted, ...spent];
      return [...certifiedBlocks, ...(own.length > 0 ? own : unwritten)];
    };
    const turnAnswer = (shown: Pick<AnsweredTurn, "blocks" | "judging">): Pick<ChatAnalystToolRuntimeResult, "blocks"> => {
      let settled = shown.blocks;
      shown.judging?.watch((blocks) => {
        settled = blocks;
      });
      return { blocks: turnBlocks(settled) };
    };
    const scope = await deps.financial.researchScope?.({ ...context, subjectPreResolutions: companies.resolved, subjectPreResolution: companies.resolved[0] }, reading)
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
      ...(scope ? { research_scope: { ...scope, companies: covered.map((id) => (namedIds.has(id) ? { issuer_id: id, label: labelOf(id) } : { issuer_id: id })) } } : {}),
    };
  };
  return async (context) => {
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(new TurnDeadline()), (deps.deadlines ?? DEADLINES).turnMs);
    const stop = turnStopSignal();
    const signal = stop ? AbortSignal.any([stop, deadline.signal]) : deadline.signal;
    try {
      return await withLlmAbortSignal(signal, () => agentTurn(context, signal));
    } finally {
      clearTimeout(timer);
    }
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

const QUIET = (() => undefined) as unknown as ChatTurnRunContext["emit"];

const UNKNOWN_COMPANY = "name each company by a subject_ref the prompt or a peer read gave";

const isModelFailure = (reason: unknown) => reason instanceof LlmRouterError || reason instanceof LlmProviderError || reason instanceof TurnDeadline;

// A turn's model calls: each guard takes one while more than `reserved` are left, and else throws as a client failure.
function callMeter(total: number) {
  let made = 0;
  return (reserved: number, refused?: () => void) => () => {
    if (made < total - reserved) {
      made += 1;
      return;
    }
    refused?.();
    throw new LlmClientError("the turn has made its model calls");
  };
}

const NO_ANSWER = "No answer could be written from the stored sources read for this question.";
const ANSWER_FAILED = "The answer could not be written, as the model failed or ran out of time; ask again in a minute.";

const ANSWER_RULES = [
  "evidence_packet.claims also hold what a company's 10-K states (its business, products, customers, competition and risk factors),",
  "attributed analyst consensus values, and industry peers: cite each as a management_attribution with its C id, which quotes it as stored.",
  "Say what a company does or faces only as a claim states it, never from your own knowledge, and never write Buy, Hold, Sell or any recommendation.",
];
const ANALYSIS_RULE = "Write at most two analyst_inference entries: the takeaway and the counterpoint.";
const DESCRIPTION_SHAPE = [
  "Answer with what the stored sources say: list management_attribution entries alone, each citing a claim that answers the question as asked,",
  "and write no analyst_inference, neither a takeaway nor a counterpoint.",
];
const ANALYSIS_LEFT_OUT = "Some of the analysis was left out, as the turn reached its limit of model calls.";

const UNFINISHED = {
  calls: "Reading stopped at the turn's limit of model calls, so part of the question may be unanswered.",
  time: "Reading stopped at the turn's time limit, so part of the question may be unanswered.",
  model_failed: "Reading stopped early, as the model failed, so part of the question may be unanswered.",
  step_cap: "Reading stopped at its step limit, so part of the question may be unanswered.",
  truncated: "Reading was cut off, so part of the question may be unanswered.",
} as const;

const TOPIC: Readonly<Record<string, string>> = {
  certified_financials: "Certified figures",
  get_company_profile: "The business profile",
  get_claims: "10-K claims",
  get_peer_set: "Industry peers",
  get_analyst_consensus: "Analyst consensus",
};

export function stopNotes(loop: Pick<ToolLoopResult, "stop" | "steps">, who: (args: JsonObject) => string): string[] {
  const unread = (calls: ReadonlyArray<LlmToolCall>, why: string) => calls.map((call) => {
    const whom = who(call.arguments);
    return `${Object.hasOwn(TOPIC, call.name) ? TOPIC[call.name] : "A read"}${whom ? ` for ${whom}` : ""} went unread, as ${why}.`;
  });
  switch (loop.stop) {
    case "final":
      return [];
    case "step_cap":
      return [UNFINISHED.step_cap];
    case "truncated": {
      const calls = loop.steps.at(-1)?.reply.toolCalls ?? [];
      return calls.length === 0 ? [UNFINISHED.truncated] : unread(calls, "the reading was cut off");
    }
    case "budget":
      return unread(loop.steps.flatMap((step) => step.results).filter((result) => result.outcome === "refused" && result.content.startsWith("refused (budget_exceeded)")).map((result) => result.call), "the turn reached its limit of reads");
  }
}

const issuerOf = (subject: RequestedSubject) => (subject.resolution as { subject_ref: FinancialSubjectRef }).subject_ref.id.toLowerCase();

function companyEntry(subject: RequestedSubject, carried: ReadonlyArray<string>, labelOf: (issuer: string) => string): JsonObject {
  const issuer = issuerOf(subject);
  return { label: labelOf(issuer), subject_ref: { kind: "issuer", id: issuer }, ...(carried.includes(subject.mention) ? { carried_from_previous_answer: true } : {}) };
}

type CertifiedAsk = Readonly<{ subjects: ReadonlyArray<string>; choice: PlanChoice; question: string; fingerprint: string }>;

const PERIOD_KINDS = new Set(["latest", "fiscal_year", "fiscal_quarter"]);
const QUARTERS = new Set(["Q1", "Q2", "Q3", "Q4"]);

const ASKABLE_FIGURES: Readonly<Record<string, unknown>> = { ...ENGINE_READS_BY_CATALOG_METRIC, ...INCOME_LINE_READS };

export function certifiedAsk(args: JsonObject, known: ReadonlyMap<string, RequestedSubject>, incomeLines: ReadonlyArray<string> = []): CertifiedAsk | { invalid: string } {
  const refs = args.subject_refs;
  if (!Array.isArray(refs) || refs.length === 0) return { invalid: "subject_refs names the companies, as the prompt lists them" };
  const subjects = refs.map((ref) => (isRecord(ref) && ref.kind === "issuer" && typeof ref.id === "string" ? ref.id.toLowerCase() : null));
  if (subjects.some((issuer) => issuer === null || !known.has(issuer))) return { invalid: UNKNOWN_COMPANY };
  const question = typeof args.question === "string" ? args.question.trim() : "";
  if (question === "") return { invalid: "question says the ask in one sentence" };
  const metrics = args.metrics;
  if (metrics !== undefined && !(Array.isArray(metrics) && metrics.length > 0 && metrics.every((metric) => typeof metric === "string" && Object.hasOwn(ASKABLE_FIGURES, metric)))) {
    return { invalid: `metrics are among ${Object.keys(ASKABLE_FIGURES).join(", ")}` };
  }
  const period = readPeriod(args.period);
  if (period === null) return { invalid: "period is latest, a fiscal_year with its year, or a fiscal_quarter with its quarter" };
  const companies = [...new Set(subjects as string[])];
  const named = metrics === undefined ? null : [...new Set(metrics as string[])].sort();
  const statement = named?.length === 1 && named[0] === "income_statement";
  const kept = named !== null && !(statement && incomeLines.length > 0) ? named : null;
  const choice: PlanChoice = kept ? { kind: "kept_figures", metrics: kept, period } : { kind: "planner" };
  const plannerMayRead = named === null || statement;
  const asked = plannerMayRead ? { metrics: named, question: question.toLowerCase().replace(/\s+/g, " ") } : { metrics: named };
  const fingerprint = createHash("sha256").update(JSON.stringify({ companies: [...companies].sort(), period, ...asked })).digest("hex").slice(0, 16);
  return { subjects: companies, choice, question: kept ? question : plannerQuestion(question, period), fingerprint };
}

function plannerQuestion(question: string, period: ReadPeriod): string {
  const words = periodWords(period);
  return words === null ? question : `${question} (for ${words})`;
}

function periodWords(period: ReadPeriod): string | null {
  switch (period.kind) {
    case "latest":
      return period.period === null ? null : period.period === "quarter" ? "the latest fiscal quarter" : "the latest fiscal year";
    case "fiscal_year":
      return `fiscal year ${period.fiscal_year}`;
    case "fiscal_quarter":
      return period.fiscal_year === null ? `the latest ${period.fiscal_period}` : `${period.fiscal_period} of fiscal year ${period.fiscal_year}`;
  }
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
      notes.push(`${who}: these figures were computed in an earlier attempt of this turn and cannot be shown again.`);
      return output("existing", { run_id: outcome.run_id });
    case "clarification": {
      const figures = catalogChoices(outcome.clarification);
      notes.push(figures.length > 0
        ? `${who}: the figures were not computed, as the request names no one figure; ask again for ${figures.length < 2 ? figures[0] : `${figures.slice(0, -1).join(", ")} or ${figures.at(-1)}`}.`
        : `${who}: the figures were not computed, as the request could not be planned as asked.`);
      return output("clarification", { kind: outcome.clarification.kind, ...(figures.length > 0 ? { choices: figures } : {}) });
    }
    case "declined":
    case "gap":
      notes.push(`${who}: ${chatGapText(outcome.reason)}`);
      return output(outcome.status, { reason: outcome.reason });
  }
}

function catalogChoices(clarification: Clarification): string[] {
  return clarification.kind === "metric" ? clarification.choices.map((choice) => choice.label) : [];
}

function invalid(tool: string, reason: string): ToolLoopOutput {
  return { content: JSON.stringify({ tool, status: "invalid_arguments", reason }), isError: true };
}

const isFailure = (result: AnalystToolResult) => result.status === "invalid_arguments" || result.status === "no_subject" || result.status === "unavailable";

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

const rendered = (block: Record<string, unknown>) => Array.isArray(block.commentary) && block.commentary.length > 0;

function citedSources(report: AnsweredTurn["assertions"], packet: EvidencePacket): ReadonlyArray<string> {
  const cited = new Set((report?.accepted ?? []).flatMap((entry) => entry.evidence));
  return packet.claims.filter((claim) => cited.has(claim.id) && !isUuid(claim.claim_id) && isUuid(claim.source_id)).map((claim) => claim.source_id);
}

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

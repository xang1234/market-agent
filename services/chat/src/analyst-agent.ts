import { createHash, randomUUID } from "node:crypto";

import type { FinancialRuntimeAuthority, FinancialSubjectRef } from "../../financial-core/src/index.ts";
import { planningModelFromRouter, type Clarification, type PlanningModel, type RequestedSubject } from "../../financial-engine/src/planner.ts";
import { createDefaultPiLlmChatClient, createLlmRouterFromEnv, LlmClientError, LlmProviderError, LlmRouterError, withLlmAbortSignal, type LlmChatClient, type LlmPurpose, type LlmSettingsLoaderEnv } from "../../llm/src/index.ts";
import { createReplayLlmChatClient } from "../../llm/src/replay-client.ts";
import type { ControlledRouter, LlmToolCall } from "../../llm/src/router.ts";
import { runToolLoop, type ToolLoopOutput, type ToolLoopResult } from "../../llm/src/tool-loop.ts";
import type { JsonObject, JsonValue } from "../../shared/src/json.ts";
import { isRecord } from "../../shared/src/http.ts";
import type { FinancialAnswerBlock } from "../../snapshot/src/financial-verifier.ts";
import { createTurnToolPolicy, loadToolRegistry, type ToolRegistry } from "../../tools/src/index.ts";
import { CLAIM_PREDICATES, isAnalystToolName, type AnalystToolName, type AnalystToolResult } from "./analyst-tools.ts";
import { answerPath, answerTurn, type AnsweredTurn, type AnswerTraceInput, type TurnTrace } from "./answer-trace.ts";
import { isUuid, noteBlock } from "./chat-ids.ts";
import { COMMENTARY_UNAVAILABLE } from "./engine-commentary.ts";
import { ANALYST_AGENT_BUNDLE_ID } from "./bundle-routing.ts";
import { labelList, type ChatAnalystAgent, type ChatAnalystToolRuntimeResult, type ChatAnalystToolRuntimeToolCall, type ChatTurnEmit, type ChatTurnRunContext } from "./coordinator.ts";
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
  type ChatFinancialTurnContext,
} from "./financial-runtime.ts";
import { claimSources } from "./render-assertions.ts";
import { ANSWER_DEADLINES, renderedAnswer, withDeadlines, type AnswerInput, type DroppedClaims } from "./llm-runtime.ts";
import { ENGINE_READS_BY_CATALOG_METRIC, INCOME_LINE_READS, LATEST, type PlanChoice, type ReadPeriod } from "./scope-figures.ts";
import { turnStopSignal } from "./turn-stop.ts";
import { shownAs } from "./verdicts.ts";
import type { AssertionReport } from "./assertions.ts";

const MAX_STEPS = 4;
const TURN_CALLS = 8;
const ANSWER_CALLS = 3;
const SECTION_CALLS = MAX_STEPS + ANSWER_CALLS;
const DEADLINES = { readMs: 75_000, turnMs: 120_000 };

type AgentModels = Readonly<{
  // Each model-facing dep calls beforeModelCall before every model attempt it makes; it throws once the turn has made its calls.
  router: (beforeModelCall: () => void) => Promise<ControlledRouter | null>;
  planner?: (beforeModelCall: () => void) => PlanningModel;
  read: (name: AnalystToolName, args: Readonly<Record<string, JsonValue>>, turn: { as_of: string; user_id: string | null }) => Promise<AnalystToolResult>;
  compose: (input: AnswerTraceInput, turn: Pick<TurnTrace, "thread_id" | "run_id" | "turn_id" | "question">, onAnswered: (deployment: string) => void, beforeModelCall: () => void) => Promise<AnsweredTurn>;
  registry?: ToolRegistry;
  deadlines?: Readonly<{ readMs: number; turnMs: number }>;
}>;

type AgentCore = AgentModels & Readonly<{ financial: Pick<ChatFinancialRuntimeDeps, "pool" | "evidence" | "hydrate"> }>;

export type AnalystAgentDeps = AgentModels & Readonly<{
  financial: Pick<ChatFinancialRuntimeDeps, "pool" | "evidence" | "resolveMention" | "priorSubjects" | "researchScope" | "hydrate">;
  asOf: () => string;
  conversation?: (threadId: string) => Promise<ReadonlyArray<{ role: string; text: string }>>;
  logToolCalls?: (threadId: string, calls: ReadonlyArray<ChatAnalystToolRuntimeToolCall>) => Promise<void>;
}>;

export type AnalystSectionDeps = AgentModels & Readonly<{
  financial: Pick<ChatFinancialRuntimeDeps, "pool" | "evidence">;
  logToolCalls?: (calls: ReadonlyArray<ChatAnalystToolRuntimeToolCall>) => Promise<void>;
}>;

export class TurnDeadline extends Error {
  constructor() {
    super("the turn ran out of time");
    this.name = "TurnDeadline";
  }
}

export async function analystAgentRouter(
  env: LlmSettingsLoaderEnv,
  options: { createClient?: () => Promise<LlmChatClient> | LlmChatClient; purpose?: Extract<LlmPurpose, "agent" | "analyze"> } = {},
): Promise<ControlledRouter | null> {
  const router = await createLlmRouterFromEnv(env, { purpose: "agent", ...options });
  return router && perStepDeadlines(router);
}

function perStepDeadlines(router: ControlledRouter): ControlledRouter {
  return { complete: (request) => router.complete(request, withDeadlines(ANSWER_DEADLINES)) };
}

export function meteredModels(
  env: NodeJS.ProcessEnv,
  base: () => Promise<LlmChatClient> | LlmChatClient = () => (env.LLM_REPLAY_FILE?.trim() ? createReplayLlmChatClient(env.LLM_REPLAY_FILE.trim()) : createDefaultPiLlmChatClient()),
  purpose: Extract<LlmPurpose, "agent" | "analyze"> = "agent",
): Pick<AgentModels, "router" | "planner" | "compose"> {
  const guarded = (beforeModelCall: () => void) => async (): Promise<LlmChatClient> => {
    const client = await base();
    return (deployment, request, options) => {
      beforeModelCall();
      return client(deployment, request, options);
    };
  };
  return {
    router: (beforeModelCall) => analystAgentRouter(env, { createClient: guarded(beforeModelCall), purpose }),
    planner: (beforeModelCall) => async (request) => {
      const router = await createLlmRouterFromEnv(env, { createClient: guarded(beforeModelCall) });
      if (!router) throw new Error("LLM router is not configured");
      return planningModelFromRouter(router)(request);
    },
    compose: (input, turn, onAnswered, beforeModelCall) =>
      answerTurn(input, turn, { env, traceDir: env.CHAT_TRACE_DIR?.trim(), onAnswered, createClient: guarded(beforeModelCall) }),
  };
}

type Certified = Readonly<{ block: FinancialAnswerBlock; packet: EvidencePacket; subjects: ReadonlyArray<string> }>;

type Meter = ReturnType<typeof callMeter>;

type AgentAsk = Readonly<{
  question: string;
  named: ReadonlyArray<RequestedSubject>;
  labels: ReadonlyMap<string, string>;
  carried: ReadonlyArray<string>;
  notes: ReadonlyArray<string>;
  planningContext: ChatFinancialTurnContext;
  authority: FinancialRuntimeAuthority;
  requestKey: (ask: string) => string;
  incomeLines: ReadonlyArray<string>;
  conversation: () => Promise<ReadonlyArray<{ role: string; text: string }>>;
  asOf: string;
  // A certified call's cutoff, read when it is made, so a company's filings fetched earlier in the turn are in it.
  clock: () => string;
  meter: Meter;
  snapshotId: string;
  scopedKey: (name: string) => string;
  noFilingAsOfCutoff: boolean;
  writing: keyof typeof WRITING;
  trace: Pick<TurnTrace, "thread_id" | "run_id" | "turn_id">;
  logToolCalls?: (calls: ReadonlyArray<ChatAnalystToolRuntimeToolCall>) => Promise<void>;
}>;

type Gathered = Readonly<{
  conversation: ReadonlyArray<{ role: string; text: string }>;
  toolCalls: ChatAnalystToolRuntimeToolCall[];
  certified: ReadonlyArray<Certified>;
  analyst: ReadonlyArray<AnalystToolResult>;
  packet: EvidencePacket;
  covered: ReadonlyArray<string>;
  labelOf: (issuer: string) => string;
}>;

type Answered = Pick<ChatAnalystToolRuntimeResult, "blocks"> & Readonly<{
  without: (dropped: DroppedClaims) => Pick<ChatAnalystToolRuntimeResult, "blocks">;
  answeredBy?: string;
  assertions: AnsweredTurn["assertions"];
  failed: boolean;
}>;

export function analystAgentRunner(deps: AnalystAgentDeps): ChatAnalystAgent {
  const agentTurn = async (context: ChatTurnRunContext, signal: AbortSignal): ReturnType<ChatAnalystAgent> => {
    if (!context.userId || !isUuid(context.threadId)) return null;
    const question = context.userIntent ?? "";
    const meter = callMeter(TURN_CALLS);
    const reading = context.reading?.(meter(ANSWER_CALLS)) ?? Promise.resolve(null);
    const companies = await requestedSubjects(deps.financial, context, question, true);
    const named = companies.subjects.flatMap((subject) => subject.resolution.status === "resolved" ? [subject] : []);
    if (companies.clarify || companies.subjects.some((subject) => subject.resolution.status === "ambiguous")) return "pick_company";
    if (named.length === 0) return null;
    context.emit("turn.started", { bundle_id: ANALYST_AGENT_BUNDLE_ID });
    const read = await reading;
    const turnId = context.turnId ?? context.runId;
    const unmatched = companies.subjects.flatMap((subject) => (subject.resolution.status === "not_found" ? [subject.mention] : []));
    const logToolCalls = deps.logToolCalls;
    const job: AgentAsk = {
      question,
      named,
      labels: companies.labels,
      carried: companies.carried,
      notes: [
        ...leftOutNotes({ notFound: unmatched }),
        ...companies.notFound.map((name) => `"${name}" did not match a company name or ticker on file; try the ticker.`),
      ],
      planningContext: context,
      authority: chatAuthority(context.userId, context.threadId, turnId),
      requestKey: (ask) => requestKeyFor(turnId, context.runId, ask),
      incomeLines: read?.income_items ?? [],
      conversation: async () => await deps.conversation?.(context.threadId) ?? [],
      asOf: deps.asOf(),
      clock: deps.asOf,
      meter,
      snapshotId: randomUUID(),
      scopedKey: (name) => name,
      noFilingAsOfCutoff: false,
      writing: "chat",
      trace: { thread_id: context.threadId, run_id: context.runId, ...(context.turnId ? { turn_id: context.turnId } : {}) },
      ...(logToolCalls ? { logToolCalls: (calls: ReadonlyArray<ChatAnalystToolRuntimeToolCall>) => logToolCalls(context.threadId, calls) } : {}),
    };
    const gathered = await gather(deps, job, signal);
    if (!gathered?.toolCalls.some((entry) => entry.status === "ok")) return null;
    const answered = await write(deps, job, gathered);
    const namedIds = new Set(named.map(issuerOf));
    const scope = await deps.financial.researchScope?.({ ...context, subjectPreResolutions: companies.resolved, subjectPreResolution: companies.resolved[0] }, reading)
      .catch((reason: unknown) => {
        console.warn("[chat] research scope unavailable; saving the analyst agent's answer without it", reason);
        return undefined;
      });
    return {
      snapshot_id: job.snapshotId,
      verification: { ok: true },
      tool_calls: gathered.toolCalls,
      blocks: answered.blocks,
      without: answered.without,
      ...(answered.answeredBy ? { answered_by: answered.answeredBy } : {}),
      ...(answered.assertions ? { assertion_report: answered.assertions } : {}),
      ...(scope ? { research_scope: { ...scope, companies: gathered.covered.map((id) => (namedIds.has(id) ? { issuer_id: id, label: gathered.labelOf(id) } : { issuer_id: id })) } } : {}),
    };
  };
  return (context) => withTurnDeadline(deps, (signal) => agentTurn(context, signal));
}

export type AnalystSectionInput = Readonly<{
  subject: Readonly<{ issuer_id: string; label: string }>;
  goal: string;
  claimsRequired?: boolean;
  sectionId: string;
  userId: string;
  // The memo run the section's certified figures belong to, under its authority.
  runId: string;
  authority: FinancialRuntimeAuthority;
  snapshotId: string;
  asOf: string;
}>;

export type AnalystSection = Readonly<{
  // empty: no stored source covers the section. unwritten: nothing could be read, or no answer written. The blocks say which.
  status: "written" | "empty" | "unwritten";
  blocks: ReadonlyArray<Record<string, unknown>>;
  packet: EvidencePacket | null;
  assertions: AnsweredTurn["assertions"];
}>;

export function analystSectionRunner(deps: AnalystSectionDeps): (input: AnalystSectionInput) => Promise<AnalystSection> {
  const section = async (input: AnalystSectionInput, signal: AbortSignal): Promise<AnalystSection> => {
    const issuer = input.subject.issuer_id.toLowerCase();
    const job: AgentAsk = {
      question: input.goal,
      named: [{ mention: input.subject.label, resolution: { status: "resolved", subject_ref: { kind: "issuer", id: issuer }, label: input.subject.label } }],
      labels: new Map([[issuer, input.subject.label]]),
      carried: [],
      notes: [],
      planningContext: { threadId: input.runId, runId: input.runId, turnId: input.sectionId, userId: input.userId, userIntent: input.goal, bundleId: ANALYST_AGENT_BUNDLE_ID, emit: QUIET },
      authority: input.authority,
      requestKey: (ask) => `agent:${input.sectionId}:${ask}`,
      incomeLines: [],
      conversation: async () => [],
      asOf: input.asOf,
      clock: () => input.asOf,
      meter: callMeter(SECTION_CALLS),
      snapshotId: input.snapshotId,
      scopedKey: (name) => `${input.sectionId}:${name}`,
      noFilingAsOfCutoff: true,
      writing: "themes",
      trace: { thread_id: input.runId, run_id: input.runId, turn_id: input.sectionId },
      ...(deps.logToolCalls ? { logToolCalls: deps.logToolCalls } : {}),
    };
    const gathered = await gather(deps, job, signal);
    const noted = (status: "empty" | "unwritten", text: string): AnalystSection => ({
      status,
      blocks: [{ ...noteBlock({ snapshotId: input.snapshotId, asOf: input.asOf }, job.scopedKey("agent:empty"), [text, ...(gathered?.packet.gaps ?? [])].join(" ")), subject_refs: [{ kind: "issuer", id: issuer }] }],
      packet: gathered?.packet ?? null,
      assertions: null,
    });
    if (!gathered?.toolCalls.some((entry) => entry.status === "ok")) return noted("unwritten", SECTION_UNREAD);
    const { figures, claims } = gathered.packet;
    if (claims.length === 0 && (input.claimsRequired || figures.every((figure) => figure.gap !== undefined))) return noted("empty", NO_SOURCES);
    const answered = await write(deps, job, gathered);
    return { status: answered.failed ? "unwritten" : "written", blocks: answered.blocks, packet: gathered.packet, assertions: answered.assertions };
  };
  return (input) => withTurnDeadline(deps, (signal) => section(input, signal));
}

async function withTurnDeadline<T>(deps: Pick<AgentModels, "deadlines">, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new TurnDeadline()), (deps.deadlines ?? DEADLINES).turnMs);
  const stop = turnStopSignal();
  const signal = stop ? AbortSignal.any([stop, deadline.signal]) : deadline.signal;
  try {
    return await withLlmAbortSignal(signal, () => run(signal));
  } finally {
    clearTimeout(timer);
  }
}

let defaultRegistry: ToolRegistry | undefined;

async function gather(deps: AgentCore, job: AgentAsk, signal: AbortSignal): Promise<Gathered | null> {
  let loopRefused = false;
  const router = await deps.router(job.meter(ANSWER_CALLS, () => {
    loopRefused = true;
  }));
  if (!router) return null;
  const policy = createTurnToolPolicy({
    registry: deps.registry ?? (defaultRegistry ??= loadToolRegistry()),
    audience: "analyst",
    classification: { bundle_id: ANALYST_AGENT_BUNDLE_ID, reason: "analyst_agent" },
    user_turn: job.question,
  });
  if (!policy.ok) throw new Error(policy.message);

  const conversation = await job.conversation();
  const { planningContext: context, meter, asOf } = job;
  const turnId = context.turnId ?? context.runId;
  const known = new Map(job.named.map((subject) => [issuerOf(subject), subject] as const));
  const labelOf = (issuer: string) => job.labels.get(issuer) ?? known.get(issuer)?.mention ?? issuer;
  const whoOf = (args: JsonObject) => labelList(argIssuers(args).filter((issuer) => known.has(issuer)).map(labelOf));
  const certified: Certified[] = [];
  const askedFor = new Set<string>();
  const analyst: AnalystToolResult[] = [];
  const notes: string[] = [...job.notes];
  const heldCompetitorNotes: string[] = [];
  let readCompetition = false;
  const toolCalls: ChatAnalystToolRuntimeToolCall[] = [];
  const asked = new Map<string, Promise<ToolLoopOutput>>();
  const fetched = new Map<string, Promise<boolean>>();
  const stillLoading = (issuers: ReadonlyArray<string>) => Promise.all(issuers.map((issuer) => {
    const pending = fetched.get(issuer) ?? (deps.financial.hydrate
      ? deps.financial.hydrate([{ issuer_id: issuer, label: labelOf(issuer) }], { emit: context.emit, turnId: `${turnId}:${issuer}` })
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
    const ask = certifiedAsk(args, known, job.incomeLines);
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
      const outcome = await certifiedFinancials({ ...deps.financial, planningModel, clock: () => new Date(job.clock()) }, {
        context: { ...turn, userIntent: ask.question },
        subjects,
        choice: ask.choice,
        labels: new Map(subjects.map((subject) => [issuerOf(subject), labelOf(issuerOf(subject))])),
        authority: job.authority,
        requestKey: job.requestKey(ask.fingerprint),
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
    const name = call.name;
    if (name !== "certified_financials" && !isAnalystToolName(name)) return invalid(name, "no such tool");
    const shown = { tool_call_id: randomUUID(), tool_name: name, label: stepLabel(name, call.arguments, whoOf(call.arguments)) };
    const output = await inStep(context.emit, shown, () => {
      const work = name === "certified_financials" ? certify(call.arguments) : readStored(name, call.arguments);
      inFlight.add(work);
      return work.finally(() => inFlight.delete(work));
    }, (done) => !done.isError);
    toolCalls.push({
      tool_call_id: shown.tool_call_id,
      tool_name: name,
      status: output.isError ? "error" : "ok",
      bundle_id: ANALYST_AGENT_BUNDLE_ID,
      arguments: call.arguments,
      result: { status: statusOf(output.content) },
    });
    return output;
  };

  const template = policy.selection.prompt_template;
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
        { role: "user", content: JSON.stringify({ question: job.question, companies: job.named.map((subject) => companyEntry(subject, job.carried, labelOf)), conversation }) },
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

  const covered = [...new Set([...job.named.map(issuerOf), ...certified.flatMap((entry) => entry.subjects)])];
  const read = job.noFilingAsOfCutoff ? datedNoFiling(analyst, asOf, labelOf) : { analyst, notes: [] };
  const packet = mergePackets({
    engine: certified.map((entry) => entry.packet),
    analyst: read.analyst,
    figuresAskedFor: [...askedFor].map(labelOf),
    notes: [...new Set([...notes, ...(readCompetition ? heldCompetitorNotes : []), ...read.notes])],
    labels: new Map([...known.keys()].map((issuer) => [issuer, labelOf(issuer)])),
    cutoff: asOf,
  });
  if (toolCalls.some((entry) => entry.status === "ok")) await job.logToolCalls?.(toolCalls);
  return { conversation, toolCalls, certified, analyst, packet, covered, labelOf };
}

async function write(deps: AgentCore, job: AgentAsk, gathered: Gathered): Promise<Answered> {
  const { conversation, toolCalls, certified, analyst, packet, covered } = gathered;
  const { snapshotId, asOf, question } = job;
  const readCalls = toolCalls.filter((entry) => entry.status === "ok").map((entry) => entry.tool_call_id);
  const subjectRefs = covered.map((id) => ({ kind: "issuer" as const, id }));
  const cardId = randomUUID();
  const card = {
    id: cardId, kind: "rich_text", snapshot_id: snapshotId, data_ref: { kind: "rich_text", id: cardId },
    source_refs: [], as_of: asOf, analyst_commentary: true, segments: [], subject_refs: subjectRefs,
  };
  const noted = packet.gaps.length === 0 ? [] : [{ ...noteBlock({ snapshotId, asOf }, job.scopedKey("agent:not-covered"), packet.gaps.join(" ")), subject_refs: subjectRefs, tool_call_ids: readCalls }];
  let answerRefused = false;
  let answeredBy: string | undefined;
  let written: Pick<AnsweredTurn, "assertions" | "blocks" | "judging" | "without">;
  let failed = false;
  const input = {
    context: { userIntent: question, bundleId: ANALYST_AGENT_BUNDLE_ID },
    blocks: [card],
    toolCalls,
    factBlocks: noted,
    conversation,
    packet,
    ...WRITING[job.writing](certified.length > 0),
  };
  const { emit } = job.planningContext;
  try {
    written = await inStep(emit, { tool_call_id: randomUUID(), tool_name: "write_answer", label: "Writing the answer" }, () => deps.compose(input, { ...job.trace, question }, (deployment) => {
      answeredBy = deployment;
    }, job.meter(0, () => {
      answerRefused = true;
    })));
    const { judging } = written;
    if (judging) {
      const judged = await inStep(emit, { tool_call_id: randomUUID(), tool_name: "judge_answer", label: "Checking the answer's inferences" }, () => judging.done);
      written = { ...written, assertions: judged.assertions };
    }
    if (written.assertions) written = withoutStance(input, packet, written.assertions) ?? written;
  } catch (reason) {
    if (!isModelFailure(reason)) throw reason;
    console.warn("[chat] the analyst agent's answer could not be written; the turn answers with what it read alone", reason);
    failed = true;
    written = { assertions: null, blocks: [], without: () => ({ blocks: [] }) };
  }

  const claims = analyst.flatMap((result) => (result.status === "ok" && "claims" in result ? result.claims : []));
  const cited = citedSources(written.assertions, packet);
  const certifiedBlocks = certified.map((entry, i) => ({ ...entry.block, id: `${entry.block.id}-${job.scopedKey(String(i + 1))}` }) as Record<string, unknown>);
  const unwritten = [{
    ...noteBlock({ snapshotId, asOf }, job.scopedKey("agent:unwritten"), certified.length > 0 ? COMMENTARY_UNAVAILABLE : failed ? ANSWER_FAILED : NO_ANSWER),
    subject_refs: subjectRefs,
    tool_call_ids: readCalls,
  }];
  const turnBlocks = (blocks: ReadonlyArray<Record<string, unknown>>) => {
    const shown = blocks.filter(rendered).map((block) => ({ ...withRefs(block, claims, cited), tool_call_ids: readCalls }));
    const spent = answerRefused && shown.length > 0 ? [{ ...noteBlock({ snapshotId, asOf }, job.scopedKey("agent:calls-spent"), ANALYSIS_LEFT_OUT), subject_refs: subjectRefs, tool_call_ids: readCalls }] : [];
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
  return {
    ...turnAnswer(written),
    without: (dropped) => turnAnswer(written.without(dropped)),
    ...(answeredBy ? { answeredBy } : {}),
    assertions: written.assertions,
    failed,
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

// ADR 0005. Buy, sell and hold are stance only as a rating, so "customers buy in bulk" is not one.
const RATING = String.raw`(?:strong\s+)?(?:buy|sell|hold)\b(?!-)`;
const STANCE = new RegExp([
  String.raw`\b(?:overweight|underweight|outperform|underperform|conviction|upgrade|downgrade)\b`,
  String.raw`\b(?:raise[sd]?|raising|lift(?:s|ed)?|lower(?:s|ed|ing)?|cut(?:s|ting)?|set(?:s|ting)?|reiterate[sd]?|maintain(?:s|ed)?|boost(?:s|ed)?|trim(?:s|med)?|increase[sd]?|reduce[sd]?)\b(?:\s+\S+){0,3}?\s+price targets?\b`,
  String.raw`\bprice targets?\s+(?:raise|cut|increase|hike|reduction)s?\b`,
  String.raw`\b(?:a|an|the|our|my)\s+${RATING}`,
  String.raw`\brate[ds]?\s+(?:a\s+|an\s+)?${RATING}`,
  String.raw`\brate[ds]?\s+(?:\S+\s+){0,3}?as\s+(?:a\s+|an\s+)?${RATING}`,
  String.raw`\bstrong\s+(?:buy|sell|hold)\b(?!-)`,
  String.raw`\b(?:buy|sell|hold)\s+(?:rating|recommendation)s?\b`,
  String.raw`\b(?:rating|recommendation)s?\s+(?:of\s+)?(?:buy|sell|hold)\b(?!-)`,
  String.raw`\brecommend(?:s|ed|ing)?\s+(?:buy|sell|hold)(?:ing)?\b`,
].join("|"), "iu");

export const statesStance = (text: string) => STANCE.test(text);

function withoutStance(input: AnswerInput & Pick<AnswerTraceInput, "context">, packet: EvidencePacket, report: AssertionReport): Pick<AnsweredTurn, "assertions" | "blocks" | "without"> | null {
  const stance = report.accepted.filter((entry) => entry.kind === "analyst_inference" && statesStance(entry.text));
  if (stance.length === 0) return null;
  const rendering = renderedAnswer(input, packet, {
    ...report,
    accepted: report.accepted.filter((entry) => !stance.includes(entry)),
    rejected: [...report.rejected, ...stance.map((entry) => ({ index: entry.index, text: entry.text, check: "limit" as const, reason: "states a stance" }))].sort((a, b) => a.index - b.index),
  });
  const shown = new Map((report.judged ?? []).flatMap((verdict) => {
    const as = shownAs(verdict, answerPath({ ...input, packet }));
    return as === "hidden" ? [] : [[verdict.index, as] as const];
  }));
  return { assertions: rendering.report, blocks: rendering.blocks(shown), without: (dropped) => ({ blocks: rendering.blocks(shown, dropped) }) };
}

function datedNoFiling(analyst: ReadonlyArray<AnalystToolResult>, asOf: string, labelOf: (issuer: string) => string): { analyst: ReadonlyArray<AnalystToolResult>; notes: ReadonlyArray<string> } {
  const issuers = new Set(analyst.flatMap((result) => ("reads" in result ? result.no_filing.map((issuer) => issuer.issuer_id.toLowerCase()) : [])));
  return {
    analyst: analyst.map((result) => ("reads" in result ? { ...result, no_filing: [] } : result)),
    notes: [...issuers].map((issuer) => `${labelOf(issuer)} had no 10-K on file as of ${asOf.slice(0, 10)}, so no business or risk factor claims from one.`),
  };
}

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
const NO_SOURCES = "No stored source covers this section.";
const SECTION_UNREAD = "This section was not written, as nothing could be read for it just now.";
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
const THEME_SHAPE = [
  "Write the section as two or three themes, each grouping the claims, and the figures where one bears on it, that speak to one subject",
  "(for risk factors, themes such as customer concentration, supply chain, regulation and export controls, or competition), the themes that matter most first.",
  "For each theme, in this order: one management_attribution whose evidence lists the C id of every claim in the theme; an observation of the figures",
  "that bear on the theme, when one does; then one analyst_inference of one or two sentences that opens with the theme's name and a colon, sums up the theme,",
  "and weighs it in its claims' own terms: what the filing says is at stake and, when a figure bears on it, what that figure shows, set beside the claims",
  "without saying they caused it, since the filing does not say why its figures moved",
  "({\"kind\":\"analyst_inference\",\"text\":\"Pricing: the filing warns that price swings may hurt its business and gross margins, and its gross margin moved widely between the two years shown.\",\"supports\":[0,1]}).",
  "Its supports are the indexes of that management_attribution and those observations, and it says nothing they do not state or clearly imply.",
  "It names the rivals, peers, customers or markets its claims name, and calls a filing \"the filing\", never by its form, since an inference writes no digit.",
  "Industry peers on file share its industry and nothing more is known of them: a theme of peers names them and says only that.",
  "Its words never include rating, upgrade, downgrade, upside, conviction, buy, sell or hold, even where a claim does (\"its credit standing\", not \"its credit rating\").",
  "Leave out a claim that fits no theme.",
];

const WRITING = {
  chat: (askedFigures: boolean) => (askedFigures
    ? { instructions: [...ANSWER_RULES, ANALYSIS_RULE] }
    : { instructions: ANSWER_RULES, answerShape: DESCRIPTION_SHAPE, inferences: false as const }),
  themes: () => ({ instructions: ANSWER_RULES, answerShape: THEME_SHAPE }),
};

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

type AgentTool = AnalystToolName | "certified_financials";
type PlanStep = Readonly<{ tool_call_id: string; tool_name: string; label: string }>;

const PREDICATE_WORDS: Readonly<Record<(typeof CLAIM_PREDICATES)[number], string>> = {
  "business.description": "business",
  "business.products": "products",
  "business.customers": "customers",
  "business.competition": "competition",
  "risk.factor": "risk factors",
};

// Labels stream to the reader before anything is judged, so they read only the tool, enum arguments and the server's company labels.
const STEP_LABELS: Readonly<Record<AgentTool, (args: JsonObject, who: string) => string>> = {
  certified_financials: (args, who) => {
    const period = readPeriod(args.period);
    const when = period && periodWords(period);
    return `Certifying ${labelList(keysOf(args.metrics, ASKABLE_FIGURES).map((metric) => metric.replaceAll("_", " "))) || "figures"} for ${who}${when ? ` in ${when}` : ""}`;
  },
  get_company_profile: (_args, who) => `Reading ${who}'s 10-K`,
  get_claims: (args, who) => {
    if (args.role === "competitor") return `Finding 10-Ks that name ${who} as a competitor`;
    const topic = labelList(keysOf(args.predicates, PREDICATE_WORDS).map((predicate) => PREDICATE_WORDS[predicate]));
    return `Reading ${who}'s 10-K${topic ? ` ${topic}` : ""}`;
  },
  get_peer_set: (_args, who) => `Finding ${who}'s industry peers`,
  get_analyst_consensus: (_args, who) => `Reading analyst consensus for ${who}`,
};

export function stepLabel(name: AgentTool, args: JsonObject, who: string): string {
  return STEP_LABELS[name](args, who || "a company");
}

function keysOf<K extends string>(value: JsonValue | undefined, table: Readonly<Record<K, unknown>>): K[] {
  return Array.isArray(value) ? [...new Set(value.filter((key): key is K => typeof key === "string" && Object.hasOwn(table, key)))] : [];
}

async function inStep<T>(emit: ChatTurnEmit, step: PlanStep, run: () => Promise<T>, ok: (done: T) => boolean = () => true): Promise<T> {
  emit("tool.started", step);
  let done: T;
  try {
    done = await run();
  } catch (reason) {
    emit("tool.completed", { ...step, status: "error" });
    throw reason;
  }
  emit("tool.completed", { ...step, status: ok(done) ? "ok" : "error" });
  return done;
}

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
  return packet.claims.filter((claim) => cited.has(claim.id) && !isUuid(claim.claim_id) && isUuid(claim.source_id))
    .flatMap((claim) => claimSources(claim).map((source) => source.source_id).filter(isUuid));
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

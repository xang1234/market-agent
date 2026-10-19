import {
  createLlmRouterFromEnv,
  type LlmChatClient,
  type LlmChatRequest,
  type LlmExecutionControls,
  type LlmSettingsLoaderEnv,
} from "../../llm/src/index.ts";
import type { ThreadTitleModel } from "../../summary/src/title-generator.ts";
import type {
  ChatAnalystToolRuntimeToolCall,
} from "./coordinator.ts";
import { displayedFigures, requestIsNamedGap } from "./fact-blocks.ts";
import { buildEvidencePacket, packetForModel, type AvailableFigure, type ClaimEvidence, type ClaimRecord, type EvidencePacket } from "./evidence-packet.ts";
import { assertionList, checkAssertions, MAX_ASSERTIONS, type AssertionReport } from "./assertions.ts";
import { formatCompactCurrency, formatCurrency } from "../../analyze/src/block-format.ts";
import { calendarNote, plainText, renderAssertion, type RenderedAssertion } from "./render-assertions.ts";
import type { ResearchScope } from "./research-scope.ts";
import type { ModelExchange } from "./answer-trace.ts";
import { isRecord } from "../../shared/src/http.ts";

// Shown when no assertion renders.
const FACT_BLOCKS_FALLBACK_TEXT =
  "The reported figures below come from the company's filings; select any value to see its source.";
// The same case for an answer without figures to point to.
const NO_ANSWER_FALLBACK_TEXT = "No written answer is available for this question; try asking again.";

// What the reader sees as the answer (#208): the accepted assertions in their
// templates, with the notes they cannot say themselves, or a fixed sentence no
// model wrote. The model's prose is never shown. An analyst inference's
// paragraph names its assertion: it shows only once the judge entails it.
type Paragraph = Pick<RenderedAssertion, "segments" | "fact_bindings" | "source_refs"> & { inference?: number };
type Answer =
  | { kind: "rendered"; paragraphs: ReadonlyArray<Paragraph>; notes: ReadonlyArray<string> }
  | { kind: "fallback"; text: string };

// What an answer shows of each accepted inference, by index: "shown" (the
// judge entailed it, inference-judge.ts), "pending" (a line in its place while
// the judge reads it); one absent is left out.
export type Inferences = ReadonlyMap<number, "shown" | "pending">;
// The turn's blocks, its answer showing the given inferences.
export type AnswerBlocks = (inferences: Inferences) => ReadonlyArray<Record<string, unknown>>;

const PENDING_INFERENCE: Paragraph = {
  segments: [{ type: "text", text: "> _Checking an analyst inference against the figures it rests on…_" }],
  fact_bindings: [],
  source_refs: [],
};

// The accepted assertions' answer, null when none renders; and the report with
// what rendering left out and why, whether or not it renders, so evals see it
// either way.
type Rendering = {
  answer: Extract<Answer, { kind: "rendered" }> | null;
  report: AssertionReport;
};

// A provider can accept a request and never answer (one held a turn 516 s, #184).
// Each attempt gets a deadline, after which the router tries the next deployment: the
// smaller of its own limit and what is left of the total. There is no separate timer
// on the whole call, so every attempt ends on its own deadline and a failure is the
// router's error naming each one, while the chain still ends by the total. Two
// attempts (a primary and its fallback) fit in each budget below.
export type ModelDeadlines = { attemptMs: number; totalMs: number };
export const ANSWER_DEADLINES: ModelDeadlines = { attemptMs: 80_000, totalMs: 180_000 };
export const TITLE_DEADLINES: ModelDeadlines = { attemptMs: 20_000, totalMs: 45_000 };

export function withDeadlines(deadlines: ModelDeadlines): LlmExecutionControls {
  const { attemptMs, totalMs } = deadlines;
  if (!Number.isInteger(attemptMs) || !Number.isInteger(totalMs) || attemptMs <= 0 || attemptMs >= totalMs) {
    throw new RangeError(`model deadlines need 0 < attemptMs < totalMs (integers); got ${attemptMs} and ${totalMs}`);
  }
  const endsAt = performance.now() + totalMs;
  return {
    // Only attempts that a full deadline could fit in the total are started.
    maxAttempts: Math.ceil(totalMs / attemptMs) - 1,
    executeAttempt: (_attempt, dispatch) =>
      dispatch(AbortSignal.timeout(Math.max(1, Math.min(attemptMs, Math.floor(endsAt - performance.now()))))),
  };
}

type LlmRuntimeContext = {
  userIntent?: string;
  bundleId: string;
};

type LlmRuntimeOptions = {
  env?: LlmSettingsLoaderEnv;
  createClient?: () => Promise<LlmChatClient> | LlmChatClient;
  deadlines?: ModelDeadlines;
};

export function createLlmThreadTitleModel(options: LlmRuntimeOptions = {}): ThreadTitleModel {
  return async (input) => {
    const router = await createLlmRouterFromEnv(options.env ?? process.env, {
      createClient: options.createClient,
    });
    if (!router) {
      throw new Error("LLM router is not configured");
    }
    const result = await router.complete({
      messages: [
        {
          role: "system",
          content: "Create a short, specific research chat title. Return only the title.",
        },
        {
          role: "user",
          content: [
            `User intent: ${input.userIntent ?? ""}`,
            `Assistant answer: ${input.assistantText}`,
          ].join("\n"),
        },
      ],
      temperature: 0.2,
      // A title is short, but reasoning models think before answering; 32 tokens
      // truncates them mid-thought and yields an empty title. Leave room to reason.
      maxTokens: 512,
      reasoning: "off",
    }, withDeadlines(options.deadlines ?? TITLE_DEADLINES));
    // A cut-off title reads as a typo; the generator falls back to the default one.
    if (result.truncated) throw new Error("thread title was cut off at the token limit");
    return result.text;
  };
}

export async function composeAnalystBlocksWithLlm(input: {
  env?: LlmSettingsLoaderEnv;
  context: LlmRuntimeContext;
  blocks: ReadonlyArray<Record<string, unknown>>;
  toolCalls: ReadonlyArray<ChatAnalystToolRuntimeToolCall>;
  // Deterministic chart/table blocks shown with the answer, whose figures its
  // assertions cite.
  factBlocks?: ReadonlyArray<Record<string, unknown>>;
  // Recent thread messages, oldest first, so the answer reads as a reply.
  conversation?: ReadonlyArray<{ role: string; text: string }>;
  // False when the turn asks only for metrics no reader serves (#206): the
  // model then sees the named gap, not other facts it could offer in its place.
  availableData?: boolean;
  // The turn's research scope and cutoff, for the evidence packet (#207).
  scope?: ResearchScope;
  cutoff?: string;
  createClient?: () => Promise<LlmChatClient> | LlmChatClient;
  // Receives the deployment (channel/model) that wrote the answer (#183).
  onAnswered?: (deployment: string) => void;
  // Receives the answer call's token usage, so evals can measure it (#181).
  onUsage?: (usage: AnswerUsage) => void;
  // Receives the check of the answer's assertion list, and what rendering left out (#208).
  onAssertions?: (report: AssertionReport) => void;
  // Receives what the model was sent and wrote, raw, for turn traces (answer-trace.ts).
  onModelExchange?: (exchange: ModelExchange) => void;
  deadlines?: ModelDeadlines;
}): Promise<AnswerBlocks> {
  const router = await createLlmRouterFromEnv(input.env ?? process.env, {
    createClient: input.createClient,
  });
  if (!router) return () => input.blocks;
  const packet = turnPacket(input);
  const factBlocks = input.factBlocks ?? [];

  const request: LlmChatRequest = {
    messages: [
      {
        role: "system",
        content: [
          // The golden replay fixture matches on this opening sentence.
          "Write a concise investment research answer for the chat user.",
          // An analyst's answer, not a list of numbers (#179): the #124 baseline scored
          // conclusions 6/18 and counterarguments 2/18.
          "Answer as a buy-side analyst would, in short plain paragraphs, in this order:",
          "(1) the takeaway: your view, answering the question directly;",
          "(2) the trend across every period shown, not just the latest, in words;",
          "(3) what is strong or weak and why, judged against the other periods or companies shown;",
          "(4) one specific counterpoint grounded in the data that cuts against the takeaway;",
          // A missing period named by its year reads as an unshown figure (#264).
          "(5) what the data shown cannot tell, such as periods or metrics that are missing;",
          "describe a missing period in words (\"no prior-year revenue\"), never by its year or number.",
          "If the data shown does not answer the question (the metric or period asked for is",
          "not there), say so plainly and briefly instead, and do not analyze other figures",
          "in its place.",
          "Name context the data itself supports, such as revenue concentrated in one",
          "segment, but never add facts, numbers, or events that are not in the tool context,",
          // Causes the answers asserted without data (#228); the four allowed forms (#261).
          "and never state a cause the data does not show (a charge, supply constraints, heavy",
          "spending). A cause may be stated only as: a management attribution from a cited claim;",
          "a figure's arithmetic share of a change; or, if the data shows none, a plain statement",
          "that the data does not show why. A hedge (\"could reflect\") or a disclaimer after the",
          "cause does not make it allowed. A plausible explanation the data does not show may",
          "appear as at most two hypotheses, each on its own line in exactly this form (never as",
          "a list of candidate causes inside a sentence about what the data cannot tell):",
          "> **Unverified hypothesis (low|medium|high confidence):** <one explanation>, given <a figure or metric shown in this answer>.",
          "Use only the context provided; do not invent citations or data.",
          "The figures you may use are listed in evidence_packet.figures, each with the metric",
          "and, in a comparison, the company it belongs to; one marked displayed false is in no chart or table",
          "the user sees, and one with a period_coverage covers only part of its period, so say so.",
          "Write a figure only as its packet reference,",
          // The reference renders as the packet's value, sealed to its fact (prose-refs.ts).
          "[[F3]] for the figure with id F3, in place of the value itself (\"revenue of [[F3]]\"): it renders as",
          "the displayed value, linked to its source, with its unit, so do not add $, %, B or x around it.",
          "A reference is not a citation to put after a number: never write the value, not even beside its",
          "reference (\"$7.7B [[F3]]\" is wrong; \"[[F3]]\" is right). Write a cited claim's content as [[C2]], in",
          "place of the claim's words, never a paraphrase with [[C2]] after it; a number a claim states may",
          "appear only this way. Never write any other digit, except in a period label (Q4, FY2026, fiscal",
          "2026, a month and year); a product named only in a claim (\"MI308\") appears by citing the claim; write",
          "counts in words (\"eight quarters\"). A sentence that types a",
          "figure or a claim's number is removed from the answer. Never compute new figures such as growth rates,",
          "margins, differences, or ratios. A magnitude comparison between figures is a computation too, even in words",
          // A wrong comparison in words (#228): "nine times" for 12.8x.
          "(\"roughly double\", \"six times\", \"larger than X's whole revenue\"):",
          "never state one in words; quote a displayed figure that gives the magnitude itself, such as a growth rate (two figures side by side do not state one),",
          "and otherwise say only the direction (\"higher\", \"faster\", \"larger\") without how much.",
          // Fiscal calendars differ (#180): the period and its end date come with each figure.
          "Name the fiscal period each figure is for (its period, and the month its period_end",
          "falls in; never the day), and a chart's window by month and year. When a comparison's title says the fiscal years end months",
          "apart, say so: the same fiscal year covers different months for each company.",
          "Claims in evidence_packet.claims are sourced statements you may draw on, dated by effective_time",
          "and published_at: say when a claim dates from, by month and year, if it is not recent. A claim's stance is from its",
          "stored direction; evidence_packet.disagreements names claims that may conflict: present both sides, never pick one.",
          "If evidence_packet.claims_truncated is set, more claims matched than are shown; if claims_status is unavailable,",
          "research claims could not be read, so never say there are none. evidence_packet.gaps say what",
          "could not be shown, evidence_packet.coverage which companies have no figures, and evidence_packet.query_bounds",
          "which periods were looked at: never describe a period outside them as missing. If evidence_packet.staleness flags data as stale (quote.stale, or",
          "fact_recency.stale / a large fact_recency.age_days), explicitly note",
          "that the figure may be out of date and say how old it is.",
          "Return plain text suitable for a rich_text block.",
          "After the answer, list what it asserts in a fenced block that opens with ```assertions on its own line:",
          `a JSON array of at most ${MAX_ASSERTIONS} objects {"kind", "text", "evidence"}. kind is "observation" (what figures`,
          "show; evidence lists their F ids only), \"comparison\" (a high or low, a ranking, or a trend of exactly one metric, so one",
          "comparison per metric; a segment breakdown is one metric, revenue, across segments; evidence lists the F ids of every",
          "company, segment or period it covers; add \"op\": \"highest\", \"lowest\", \"order\" or \"trend\", and \"result\": the F id",
          "that is highest or lowest, the F ids highest first, or one of \"rose\", \"fell\", \"flat\", \"rose_throughout\",",
          "\"fell_throughout\", \"rebounded\" or \"pulled_back\"), \"management_attribution\" (what a claim says management stated;",
          "evidence lists its C id), \"unknown_cause\" (a change the evidence gives no cause for; evidence lists the F id of each",
          "figure that changed), or \"analyst_inference\" (what the observations, comparisons and management attributions mean, in words; the figures are",
          "theirs, so it writes no digit, period label or reference (\"a year earlier\", not FY2025); evidence may be omitted; add \"supports\": the array indexes of",
          // The judge reads an inference beside its supports alone (#302): live
          // inferences leaned on a price return or a stated charge they never bound.
          "every observation, comparison and management_attribution whose content it uses (a figure, a price return, scale, a ranking, a",
          "charge management stated), and it says nothing those supports do not show, not even hedged (\"may already be priced in\");",
          "add \"subject\": the company label the inference is about, one its evidence covers).",
          "When the answer covers more than one company, an analyst_inference's text names no company, not even in the counterpoint:",
          "who leads, trails, rose or fell is shown from the comparisons it rests on, so rest a ranking or direction on its comparison",
          "and say only what it means (\"the margin lead funds more research\", not \"NVDA leads AMD\"); the text refers to its",
          "subject as \"it\" or \"its\" ({\"kind\":\"analyst_inference\",\"subject\":\"AMD\",\"text\":\"Its net margin may understate",
          "underlying profitability, given the one-time charge management disclosed.\",\"supports\":[2,3]}).",
          "The answer is shown from this list alone, in its order, so it must carry the answer: your takeaway first, as an",
          "analyst_inference; then the observations, comparisons and what the data cannot tell about a change, as an",
          "unknown_cause; and last your counterpoint, as an analyst_inference. List nothing for what the data shown cannot tell:",
          // A gap's words name a metric or company nothing checks (#302).
          "the answer's own notes say what is missing, from evidence_packet.gaps.",
          "text restates the assertion in one sentence, written as the answer is: each figure or claim only as its",
          "reference from the assertion's evidence ([[F3]], [[C2]]), no other number but a period label of that evidence's",
          "periods or dates, and only companies its evidence holds; an analyst_inference's text is words only.",
          "When evidence_packet has neither figures nor claims, omit the block.",
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify(answerContext({ ...input, packet })),
      },
    ],
    temperature: 0.2,
    // Effort is set here; the length of the answer is the prompt's job. The ceiling is a
    // safety net for reasoning that runs long (it counts reasoning tokens too): at 800 a
    // reasoning model spent it all thinking and answered nothing (#124 baseline, #175).
    reasoning: "low",
    maxTokens: 8192,
  };
  const startedAt = performance.now();
  const result = await router.complete(request, withDeadlines(input.deadlines ?? ANSWER_DEADLINES));
  const usage: AnswerUsage | undefined = result.usage && {
    input_tokens: result.usage.inputTokens,
    output_tokens: result.usage.outputTokens,
    ...(result.usage.reasoningTokens === undefined ? {} : { reasoning_tokens: result.usage.reasoningTokens }),
  };
  input.onModelExchange?.({
    messages: request.messages,
    text: result.text,
    truncated: result.truncated === true,
    deployment: `${result.deployment.channel}/${result.deployment.model}`,
    latency_ms: Math.round(performance.now() - startedAt),
    ...(usage ? { usage } : {}),
  });
  if (usage) input.onUsage?.(usage);
  const report = checkAssertions(assertionList(result.text), packet);
  if (report.status !== "checked" || report.rejected.length > 0) {
    console.info(`[chat] assertions ${report.status}: ${report.accepted.length} accepted, ${report.rejected.length} rejected`);
  }
  // Pointing to "the reported figures below" needs figures shown: not a gap
  // note, nor values only an assertion references (#302).
  const shown = displayedFigures(factBlocks);
  const renderAccepted = (): Rendering => {
    if (report.status !== "checked" || report.accepted.length === 0) return { answer: null, report };
    // Nothing is left out once accepted, so every support an inference rests
    // on is on the page (assertions.ts binds only accepted supports), and its
    // label states what those comparisons checked.
    const kept = report.accepted.map((assertion) => ({
      ...renderAssertion(assertion, packet, factBlocks, report.accepted),
      kind: assertion.kind,
    }));
    // The figures the kept assertions state, and their companies: a comparison
    // rendered for only some of the companies it shows figures for would read
    // one-sided, so the fallback stands instead.
    // An inference shows no figure, so its evidence covers no company.
    const keptAssertions = report.accepted.filter((assertion) => assertion.kind !== "analyst_inference");
    const keptFigures = keptAssertions.flatMap((assertion) => packet.figures.filter((figure) => assertion.evidence.includes(figure.id)));
    const covered = new Set([
      ...keptFigures.map((figure) => figure.company ?? packet.companies[0]),
      ...keptAssertions.flatMap((assertion) => packet.claims.filter((claim) => assertion.evidence.includes(claim.id)).map((claim) => claim.company)),
    ]);
    if (packet.companies.length > 1 && packet.coverage.some((entry) => entry.status === "shown" && !covered.has(entry.company))) {
      const oneSided = kept.map((entry) => ({ index: entry.index, text: plainText(entry.segments), check: "rendering" as const, reason: "left out: the answer would show only some of the companies shown" }));
      return { answer: null, report: { ...report, accepted: [], rejected: [...report.rejected, ...oneSided].sort((a, b) => a.index - b.index) } };
    }
    // An observation whose every figure a kept comparison writes is not said
    // twice; it still stands as an inference's support. One fact shown in two
    // blocks is one figure.
    const factOf = (id: string) => packet.figures.find((figure) => figure.id === id)?.fact_id ?? id;
    const compared = new Set(kept.filter((entry) => entry.kind === "comparison").flatMap((entry) => entry.figure_ids.map(factOf)));
    const repeated = kept.filter((entry) => entry.kind === "observation" && entry.figure_ids.every((id) => compared.has(factOf(id)))).map((entry) => entry.index);
    // A stored disagreement keeps both sides: a claim rendered without the
    // claim that contradicts it brings that claim along, said as such.
    const shownClaims = new Set(kept.filter((entry) => entry.kind === "management_attribution")
      .flatMap((entry) => report.accepted.find((assertion) => assertion.index === entry.index)?.evidence ?? []));
    const otherSides = [...new Set(packet.disagreements.flatMap(({ claims: [a, b] }) =>
      shownClaims.has(a) && !shownClaims.has(b) ? [b] : shownClaims.has(b) && !shownClaims.has(a) ? [a] : []
    ))].map((id, i) => {
      const side = renderAssertion({ index: -1 - i, kind: "management_attribution", text: "", evidence: [id] }, packet, factBlocks);
      return { ...side, segments: [{ type: "text" as const, text: "A source disagrees. " }, ...side.segments] };
    });
    // What the rendered assertions cannot say themselves: a company with no
    // figures shown, unless the answer states one of its values (a claim is
    // no value), and stale data.
    const stated = new Set(keptFigures.map((figure) => figure.company ?? packet.companies[0]));
    const notShown = packet.coverage.filter((entry) => entry.status === "not_shown" && !stated.has(entry.company)).map((entry) => entry.company);
    const answer = {
      kind: "rendered" as const,
      paragraphs: [
        ...kept.filter((entry) => !repeated.includes(entry.index))
          .map(({ kind, ...entry }) => (kind === "analyst_inference" ? { ...entry, inference: entry.index } : entry)),
        ...otherSides,
      ],
      notes: [
        ...[calendarNote(keptAssertions, packet)].filter((note) => note !== undefined),
        ...(notShown.length > 0 ? [`No figures are shown for ${new Intl.ListFormat("en").format(notShown)}.`] : []),
        // The claims as selected: more matched than were read, or none could be.
        ...(packet.claims_truncated ? ["More sources matched than are shown here."] : []),
        ...(packet.claims_status === "unavailable" ? ["Research claims could not be read for this answer."] : []),
        ...stalenessNotes(input.toolCalls),
      ],
    };
    return { answer, report: { ...report, rendered: true, ...(repeated.length > 0 ? { repeated } : {}) } };
  };
  // A request the data does not hold points to the gap notes shown below the
  // answer (#302). Not every note is a gap ("the previous answer's figures
  // were ... verified"), so the scope says whether the request is one (#358 review).
  const namedGap = input.scope !== undefined && requestIsNamedGap(input.scope, factBlocks) &&
    packet.figures.length === 0 && packet.gaps.length > 0;
  const rendering = renderAccepted();
  const answer: Answer = rendering.answer ?? {
    kind: "fallback",
    text: namedGap
      ? [
        `The data here does not answer this question; the ${packet.gaps.length > 1 ? "notes below say" : "note below says"} what is missing.`,
        ...(packet.claims_status === "unavailable" ? ["Research claims could not be read for this answer."] : []),
      ].join(" ")
      : shown.length > 0 ? FACT_BLOCKS_FALLBACK_TEXT : NO_ANSWER_FALLBACK_TEXT,
  };
  input.onAssertions?.(rendering.report);
  // The deployment is reported only when the answer is rendered from its
  // assertions: the fallback sentence was written by no model (#183).
  if (rendering.answer) input.onAnswered?.(`${result.deployment.channel}/${result.deployment.model}`);
  else console.warn(`[chat] no assertion rendered (list ${report.status}${result.truncated ? ", answer cut off at the token limit" : ""}); showing the fallback sentence`);
  return (inferences) => withAnswer(input.blocks, answer, inferences);
}

export type AnswerUsage = { input_tokens: number; output_tokens: number; reasoning_tokens?: number };

// What the answer model sees (#181): only what it can use, as an evidence
// packet (#207, evidence-packet.ts) plus the question and conversation. The figures
// it may reference (with company, period and period end), cited claim text, what
// could not be shown, and staleness flags. Raw tool JSON, the placeholder block,
// and the routing bundle are left out: the answer writes a figure only as a
// packet reference, so the raw facts behind them only added tokens and reasoning.
// When no figures are shown (a quote-only subject, or the fact loader came back
// empty), the turn's quote and reported facts are the packet's figures (#302).
export function answerContext(input: {
  context: LlmRuntimeContext;
  toolCalls: ReadonlyArray<ChatAnalystToolRuntimeToolCall>;
  factBlocks?: ReadonlyArray<Record<string, unknown>>;
  conversation?: ReadonlyArray<{ role: string; text: string }>;
  availableData?: boolean;
  scope?: ResearchScope;
  cutoff?: string;
  // The turn's packet, when the caller has built it (turnPacket).
  packet?: EvidencePacket;
}): Record<string, unknown> {
  const results = input.toolCalls.map((toolCall) => (isRecord(toolCall.result) ? toolCall.result : {}));
  const structured = results.map((result) => (isRecord(result.structured_context) ? result.structured_context : {}));
  const quotes = structured.flatMap((context) => isRecord(context.quote) ? [{
    ticker: context.quote.ticker,
    as_of: context.quote.as_of,
    stale: context.quote.stale,
    // Fresh is not live: an end-of-day or delayed quote says so.
    ...(typeof context.quote.session_state === "string" ? { session_state: context.quote.session_state } : {}),
    ...(typeof context.quote.delay_class === "string" ? { delay_class: context.quote.delay_class } : {}),
  }] : []);
  const factRecency = structured.flatMap((context) => (isRecord(context.fact_recency) ? [context.fact_recency] : []));
  const claims = claimEvidence(input.toolCalls);
  const packet = packetForModel(input.packet ?? turnPacket(input));
  // Subjects with no evidence at all are a gap too; when the claims read
  // failed, the claims are unknown, not absent (#207).
  const gaps = [
    ...((packet.gaps as string[] | undefined) ?? []),
    ...(results.some((result) => result.evidence_status === "insufficient_evidence")
      ? [claims.unavailable
        ? "No reported facts or quote are on file for this subject, and its research claims could not be read."
        : "No research claims, reported facts, or quote are on file for this subject."]
      : []),
  ];
  return {
    question: input.context.userIntent ?? "Start a research thread",
    conversation: input.conversation ?? [],
    evidence_packet: {
      ...packet,
      ...(gaps.length > 0 ? { gaps } : {}),
      ...(quotes.length > 0 || factRecency.length > 0
        ? { staleness: { ...(quotes.length > 0 ? { quote: quotes } : {}), ...(factRecency.length > 0 ? { fact_recency: factRecency } : {}) } }
        : {}),
    },
  };
}

// The turn's evidence packet: its figures, claims and bounds (#207). A named
// gap's turn offers no other values in the metric's place (#206).
export function turnPacket(input: {
  toolCalls: ReadonlyArray<ChatAnalystToolRuntimeToolCall>;
  factBlocks?: ReadonlyArray<Record<string, unknown>>;
  availableData?: boolean;
  scope?: ResearchScope;
  cutoff?: string;
}): EvidencePacket {
  return buildEvidencePacket({
    ...(input.scope ? { scope: input.scope } : {}),
    factBlocks: input.factBlocks ?? [],
    cutoff: input.cutoff ?? new Date().toISOString(),
    claims: claimEvidence(input.toolCalls),
    ...(input.availableData === false ? {} : { available: availableFigures(input.toolCalls) }),
  });
}

// The claims the turn's evidence reads selected, each once across tool calls,
// with their dates, so a past claim (an earlier quarter's guidance) is not read
// as current.
function claimEvidence(toolCalls: ReadonlyArray<ChatAnalystToolRuntimeToolCall>): ClaimEvidence {
  const evidence = toolCalls.flatMap((toolCall) => {
    const result = isRecord(toolCall.result) ? toolCall.result.evidence : undefined;
    return isRecord(result) ? [result] : [];
  });
  const claims = new Map<string, ClaimRecord>();
  for (const claim of evidence.flatMap((entry) => (Array.isArray(entry.claims) ? entry.claims : []))) {
    if (!isRecord(claim) || typeof claim.text_canonical !== "string") continue;
    const id = typeof claim.claim_id === "string" ? claim.claim_id : `unidentified:${claims.size}`;
    if (claims.has(id)) continue;
    claims.set(id, {
      claim_id: id,
      source_id: typeof claim.source_id === "string" ? claim.source_id : "",
      text_canonical: claim.text_canonical,
      predicate: typeof claim.predicate === "string" ? claim.predicate : "",
      polarity: typeof claim.polarity === "string" ? claim.polarity : "",
      effective_time: typeof claim.effective_time === "string" ? claim.effective_time : null,
      published_at: typeof claim.published_at === "string" ? claim.published_at : null,
      ...(typeof claim.subject_id === "string" ? { subject_id: claim.subject_id } : {}),
    });
  }
  const contradictions = evidence.flatMap((entry) => (Array.isArray(entry.contradictions) ? entry.contradictions : []))
    .filter((pair): pair is [string, string] => Array.isArray(pair) && pair.length === 2 && pair.every((id) => typeof id === "string"));
  return {
    claims: [...claims.values()],
    truncated: evidence.some((entry) => entry.truncated === true),
    contradictions: [...new Map(contradictions.map((pair) => [pair.join(), pair] as const)).values()],
    unavailable: evidence.some((entry) => entry.unavailable === true),
  };
}

// The quote and reported facts as figures: what an answer with no displayed
// figures stands on (#302), each fact once across tool calls.
function availableFigures(toolCalls: ReadonlyArray<ChatAnalystToolRuntimeToolCall>): AvailableFigure[] {
  const structured = toolCalls.flatMap((toolCall) => {
    const context = isRecord(toolCall.result) ? toolCall.result.structured_context : undefined;
    return isRecord(context) ? [context] : [];
  });
  const quotes = structured.flatMap(({ quote }): AvailableFigure[] => {
    if (!isRecord(quote) || typeof quote.price !== "number" || typeof quote.currency !== "string") return [];
    const dated = typeof quote.as_of === "string" ? { as_of: quote.as_of } : {};
    return [
      { metric: "Price", value: formatCurrency(quote.price, quote.currency), ...dated, source_ids: [], displayed: false },
      // change_pct is a fraction (0.0078 = 0.78%).
      ...(typeof quote.change_pct === "number"
        ? [{ metric: "Day change", value: `${quote.change_pct >= 0 ? "+" : ""}${(quote.change_pct * 100).toFixed(2)}%`, ...dated, source_ids: [], displayed: false as const }]
        : []),
    ];
  });
  const facts = new Map<string, AvailableFigure>();
  for (const fact of structured.flatMap((context) => (Array.isArray(context.facts) ? context.facts : []))) {
    if (!isRecord(fact) || typeof fact.fact_id !== "string" || facts.has(fact.fact_id)) continue;
    const value = factValue(fact);
    const metric = fact.display_name ?? fact.metric_key;
    // A fact whose period has no coverage is no value for it.
    if (value === undefined || typeof metric !== "string" || fact.coverage_level === "unavailable") continue;
    const fiscal = typeof fact.fiscal_year === "number" ? { period: `${typeof fact.fiscal_period === "string" ? fact.fiscal_period : ""}${fact.fiscal_year}` } : {};
    facts.set(fact.fact_id, {
      metric,
      ...fiscal,
      value,
      fact_id: fact.fact_id,
      source_ids: typeof fact.source_id === "string" ? [fact.source_id] : [],
      displayed: false,
      ...(typeof fact.as_of === "string" ? { as_of: fact.as_of } : {}),
      ...(typeof fact.coverage_level === "string" && fact.coverage_level !== "full" ? { period_coverage: fact.coverage_level } : {}),
      ...factBinding(fact),
    });
  }
  return [...quotes, ...facts.values()];
}

// A fact's value as a block would display it.
function factValue(fact: Record<string, unknown>): string | undefined {
  if (typeof fact.value_num !== "number") return typeof fact.value_text === "string" ? fact.value_text : undefined;
  const value = fact.value_num * (typeof fact.scale === "number" ? fact.scale : 1);
  const currency = typeof fact.currency === "string" ? fact.currency : undefined;
  if (currency && fact.unit === "currency") return formatCompactCurrency(value, currency);
  if (currency && fact.unit === "currency_per_share") return formatCurrency(value, currency);
  const amount = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  return typeof fact.unit === "string" && fact.unit !== "pure" ? `${amount} ${fact.unit}` : amount;
}

// The binding a seal checks a fiscal fact by (snapshot-verifier.ts): its unit,
// period kind, and fiscal year and period. Another kind is bound by dates the
// fact summary does not carry, so its value renders unsealed.
function factBinding(fact: Record<string, unknown>): { binding?: Record<string, unknown> } {
  if (typeof fact.unit !== "string" || typeof fact.fiscal_year !== "number") return {};
  if (fact.period_kind === "fiscal_y") return { binding: { fact_id: fact.fact_id, unit: fact.unit, period_kind: "fiscal_y", fiscal_year: fact.fiscal_year } };
  if (fact.period_kind === "fiscal_q" && typeof fact.fiscal_period === "string") {
    return { binding: { fact_id: fact.fact_id, unit: fact.unit, period_kind: "fiscal_q", fiscal_year: fact.fiscal_year, fiscal_period: fact.fiscal_period } };
  }
  return {};
}

function withAnswer(blocks: ReadonlyArray<Record<string, unknown>>, answer: Answer, inferences: Inferences): ReadonlyArray<Record<string, unknown>> {
  let rewritten = false;
  return Object.freeze(blocks.map((block) => {
    if (rewritten || block.kind !== "rich_text") return block;
    rewritten = true;
    if (answer.kind === "fallback") {
      return Object.freeze({ ...block, segments: Object.freeze([Object.freeze({ type: "text", text: answer.text })]) });
    }
    const { notes } = answer;
    const paragraphs = answer.paragraphs.flatMap((entry) => {
      const state = entry.inference === undefined ? "shown" : inferences.get(entry.inference);
      return state === "shown" ? [entry] : state === "pending" ? [PENDING_INFERENCE] : [];
    });
    const segments = [
      ...paragraphs.flatMap((entry, i) => [...(i === 0 ? [] : [{ type: "text", text: "\n\n" }]), ...entry.segments]),
      ...(notes.length > 0 ? [{ type: "text", text: `\n\n${notes.join(" ")}` }] : []),
    ];
    const factBindings = [...new Map(paragraphs.flatMap((entry) => entry.fact_bindings).map((binding) => [binding.fact_id, binding])).values()];
    const dataRef = (block.data_ref ?? {}) as Record<string, unknown>;
    return Object.freeze({
      ...block,
      segments: Object.freeze(segments.map((segment) => Object.freeze({ ...segment }))),
      ...(factBindings.length > 0 ? { data_ref: { ...dataRef, params: { fact_bindings: factBindings } } } : {}),
      source_refs: [...new Set(paragraphs.flatMap((entry) => entry.source_refs))],
    });
  }));
}

// What the prompt asks the model to say about stale data, said by the rendered
// answer itself: the reported figures' age, and a quote's date.
function stalenessNotes(toolCalls: ReadonlyArray<ChatAnalystToolRuntimeToolCall>): string[] {
  const structured = toolCalls.flatMap((toolCall) => {
    const result = isRecord(toolCall.result) ? toolCall.result.structured_context : undefined;
    return isRecord(result) ? [result] : [];
  });
  const ages = structured.flatMap((context) =>
    isRecord(context.fact_recency) && context.fact_recency.stale === true && typeof context.fact_recency.age_days === "number"
      ? [context.fact_recency.age_days]
      : []
  );
  const quotes = structured.flatMap((context) =>
    isRecord(context.quote) && context.quote.stale === true && typeof context.quote.as_of === "string" ? [context.quote.as_of] : []
  );
  return [
    ...(ages.length > 0 ? [`The latest reported figures are ${Math.max(...ages)} days old and may be out of date.`] : []),
    ...[...new Set(quotes)].map((asOf) =>
      `The quote, as of ${new Date(asOf).toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })}, may be out of date.`
    ),
  ];
}

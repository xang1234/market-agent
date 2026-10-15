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
import { displayedFigures, displayTextsForBlocks } from "./fact-blocks.ts";
import { buildEvidencePacket, packetForModel, type ClaimEvidence, type ClaimRecord, type EvidencePacket } from "./evidence-packet.ts";
import { checkAssertions, MAX_ASSERTIONS, splitAssertions, type AssertionKind, type AssertionReport } from "./assertions.ts";
import { calendarNote, gapText, plainText, renderAssertion } from "./render-assertions.ts";
import { proseSegments, referenceTable, type ProseSegments } from "./prose-refs.ts";
import type { ResearchScope } from "./research-scope.ts";
import type { ModelExchange } from "./answer-trace.ts";
import { keepKnownReferences, keepSupportedSentences, keepUncausedSentences, LIST_MARKER, SENTENCE_BREAK, withoutEmptySections } from "./narrative-guard.ts";

// Shown when the guard strips every sentence of the model's prose, or the model gave
// no usable answer (empty, or cut off at the token limit).
export const FACT_BLOCKS_FALLBACK_TEXT =
  "The reported figures below come from the company's filings; select any value to see its source.";
// The same case for an answer without figures to point to.
export const NO_ANSWER_FALLBACK_TEXT = "No written answer is available for this question; try asking again.";

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
  // Deterministic chart/table blocks shown with the answer. When present, the
  // prose may only quote figures they display (or that cited claims state).
  factBlocks?: ReadonlyArray<Record<string, unknown>>;
  // The turn's subjects as labelled ("NVDA"), for the guard (2026-10-08 eval).
  subjectLabels?: ReadonlyArray<string>;
  // Recent thread messages, oldest first, so the answer reads as a reply.
  conversation?: ReadonlyArray<{ role: string; text: string }>;
  // False when the turn asks only for metrics no reader serves (#206): the
  // model then sees the named gap, not other facts it could offer in its place.
  availableData?: boolean;
  // The turn's research scope and cutoff, for the evidence packet (#207).
  scope?: ResearchScope;
  cutoff?: string;
  createClient?: () => Promise<LlmChatClient> | LlmChatClient;
  // Receives the sentences the narrative guard dropped, so evals can count them (#144).
  onNarrativeRemoved?: (sentences: ReadonlyArray<string>) => void;
  // Receives the deployment (channel/model) that wrote the answer (#183).
  onAnswered?: (deployment: string) => void;
  // Receives the answer call's token usage, so evals can measure it (#181).
  onUsage?: (usage: AnswerUsage) => void;
  // Receives the check of the answer's assertion list, in shadow (#208).
  onAssertions?: (report: AssertionReport) => void;
  // Receives what the model was sent and wrote, raw, for turn traces (answer-trace.ts).
  onModelExchange?: (exchange: ModelExchange) => void;
  deadlines?: ModelDeadlines;
}): Promise<ReadonlyArray<Record<string, unknown>>> {
  const router = await createLlmRouterFromEnv(input.env ?? process.env, {
    createClient: input.createClient,
  });
  if (!router) return input.blocks;
  const packet = turnPacket(input);
  const factBlocks = input.factBlocks ?? [];
  // The references the prose may cite, rendered as the packet's values (prose-refs.ts).
  const table = referenceTable(packet, factBlocks);
  const asProse = (text: string) => rewriteFirstRichTextBlockWith(input.blocks, [proseSegments(text, table, factBlocks)], []);

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
          "The figures shown to the user are listed in evidence_packet.figures, each with the metric",
          "and, in a comparison, the company it belongs to. Write a figure only as its packet reference,",
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
          // Wrong comparisons in words the guard cannot see (#228): "nine times" for 12.8x.
          "(\"roughly double\", \"six times\", \"larger than X's whole revenue\"):",
          "never state one in words; quote a displayed figure that gives the magnitude itself, such as a growth rate (two figures side by side do not state one),",
          "and otherwise say only the direction (\"higher\", \"faster\", \"larger\") without how much.",
          // Fiscal calendars differ (#180): the period and its end date come with each figure.
          "Name the fiscal period each figure is for (its period, and the month its period_end",
          "falls in; never the day), and a chart's window by month and year. When a comparison's title says the fiscal years end months",
          "apart, say so: the same fiscal year covers different months for each company.",
          "When evidence_packet.figures is empty, evidence_packet.available_data lists the reported values you may use instead;",
          "a value with a coverage other than full covers only part of its period, so say so.",
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
          // Shadow assertions (#208): checked against the packet, never shown.
          "After the answer, list what it asserts in a fenced block that opens with ```assertions on its own line:",
          `a JSON array of at most ${MAX_ASSERTIONS} objects {"kind", "text", "evidence"}. kind is "observation" (what figures`,
          "show; evidence lists their F ids only), \"comparison\" (a high or low, a ranking, or a trend of exactly one metric, so one",
          "comparison per metric; values that are about the same are an observation, not a comparison; a segment breakdown is one metric, revenue, across segments; evidence lists the F ids of every",
          "company, segment or period it covers; add \"op\": \"highest\", \"lowest\", \"order\" or \"trend\", and \"result\": the F id",
          "that is highest or lowest, the F ids highest first, or one of \"rose\", \"fell\", \"flat\", \"rose_throughout\",",
          "\"fell_throughout\", \"rebounded\" or \"pulled_back\"), \"management_attribution\" (what a claim says management stated;",
          "evidence lists its C id), \"unknown_cause\" (a change the evidence gives no cause for; evidence lists the F id of each",
          "figure that changed), \"data_gap\" (what the data shown cannot tell, such as a missing period, metric or segment, or that it does not answer the question, in",
          "words: no digit, period label or reference (\"no prior-year margins are shown\"); when the answer covers more than one company it",
          "names no company (the answer's own notes say whose data is missing);",
          "evidence is omitted, and no supports), or \"analyst_inference\" (what the observations and comparisons mean, in words; the figures are",
          "theirs, so it writes no digit, period label or reference (\"a year earlier\", not FY2025); evidence may be omitted; add \"supports\": the array indexes of the",
          "observations and comparisons it rests on, every one of which must pass its own check or the inference goes; add \"subject\": the company label the inference is about, one its evidence covers).",
          "When the answer covers more than one company, an analyst_inference's text names no company, not even in the counterpoint:",
          "who leads, trails, rose or fell is shown from the comparisons it rests on, so rest a ranking or direction on its comparison",
          "and say only what it means (\"the margin lead funds more research\", not \"NVDA leads AMD\"); the text refers to its",
          "subject as \"it\" or \"its\" ({\"kind\":\"analyst_inference\",\"subject\":\"AMD\",\"text\":\"Its net margin may understate",
          "underlying profitability, given the one-time charge management disclosed.\",\"supports\":[3]}).",
          "The answer may be shown from this list alone, in its order, so it must carry the answer: your takeaway first, as an",
          "analyst_inference; then the observations, comparisons and what the data cannot tell about a change, as an",
          "unknown_cause; then your counterpoint, as an analyst_inference; and last, what else the data shown cannot tell, as a data_gap.",
          "text restates the assertion in one sentence, written as the answer is: each figure or claim only as its",
          "reference from the assertion's evidence ([[F3]], [[C2]]), no other number but a period label of that evidence's",
          "periods or dates, and only companies its evidence holds; an analyst_inference's or data_gap's text is words only.",
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
  // The deployment is reported only when some of its prose is shown: a fallback
  // sentence in its place was written by no model (#183).
  const answered = () => input.onAnswered?.(`${result.deployment.channel}/${result.deployment.model}`);
  // The assertion list is checked, never shown (#208).
  const { prose, list, open } = splitAssertions(result.text.trim());
  const report = checkAssertions(list, packet, table);
  if (report.status !== "checked" || report.rejected.length > 0) {
    console.info(`[chat] assertions ${report.status}: ${report.accepted.length} accepted, ${report.rejected.length} rejected`);
  }
  // Assertions rendering left out, with why: on the report whether or not the
  // answer was rendered, so evals see them either way.
  let renderRemovals: AssertionReport["rejected"] = [];
  let repeated: number[] = [];
  const reportAssertions = (rendered = false) =>
    input.onAssertions?.(renderRemovals.length > 0 || rendered
      ? {
        ...report,
        accepted: report.accepted.filter((entry) => !renderRemovals.some((removed) => removed.index === entry.index)),
        rejected: [...report.rejected, ...renderRemovals].sort((a, b) => a.index - b.index),
        ...(rendered ? { rendered: true } : {}),
        ...(rendered && repeated.length > 0 ? { repeated } : {}),
      }
      : report);
  // Controlled rendering (#208), unless CHAT_ASSERTION_RENDERING is off: the answer
  // written from the accepted assertions, with the turn's guard still the
  // backstop on each (its drops reported as narrative removals). Null when
  // there is nothing to render, so the guarded prose stands, as with the flag
  // off.
  const renderAccepted = (drops: (text: string, kind: AssertionKind) => ReadonlyArray<string>) => {
    if (!assertionRenderingEnabled(input.env ?? process.env) || report.status !== "checked" || report.accepted.length === 0) return null;
    const rendered = report.accepted.map((assertion) => ({
      ...renderAssertion(assertion, packet, factBlocks, report.accepted),
      kind: assertion.kind,
      supports: assertion.supports ?? [],
    }));
    // The guard reads each rendered assertion with its values as references,
    // so a template's own periods ("Q4 2026") pass and its values are the packet's.
    // An inference goes with any assertion it rests on, as in the check: its
    // words, and its label, may be about what the removed one said.
    const guarded = new Set(rendered.filter((entry) => entry.kind !== "analyst_inference" && drops(entry.reference_text, entry.kind).length > 0).map((entry) => entry.index));
    const orphaned = new Set(rendered.filter((entry) => entry.kind === "analyst_inference" && entry.supports.some((n) => guarded.has(n))).map((entry) => entry.index));
    for (const entry of rendered) {
      if (entry.kind === "analyst_inference" && !orphaned.has(entry.index) && drops(entry.reference_text, entry.kind).length > 0) guarded.add(entry.index);
    }
    const kept = rendered.filter((entry) => !guarded.has(entry.index) && !orphaned.has(entry.index));
    renderRemovals = rendered.filter((entry) => !kept.includes(entry)).map((entry) => ({
      index: entry.index,
      text: plainText(entry.segments),
      reason: guarded.has(entry.index) ? "removed by the narrative guard" : "rests on an observation the narrative guard removed",
    }));
    // An answer must state something the packet holds: data gaps and
    // inferences alone are no answer, so the prose (from available_data,
    // say) stands instead.
    if (!kept.some((entry) => entry.kind !== "data_gap" && entry.kind !== "analyst_inference")) return null;
    // The figures the kept assertions state, and their companies: a comparison
    // rendered for only some of the companies it shows figures for would read
    // one-sided, so its prose stands instead.
    // An inference shows no figure, so its evidence covers no company.
    const keptAssertions = kept.flatMap((entry) => report.accepted.filter((assertion) => assertion.index === entry.index && assertion.kind !== "analyst_inference"));
    const keptFigures = keptAssertions.flatMap((assertion) => packet.figures.filter((figure) => assertion.evidence.includes(figure.id)));
    const covered = new Set([
      ...keptFigures.map((figure) => figure.company ?? packet.companies[0]),
      ...keptAssertions.flatMap((assertion) => packet.claims.filter((claim) => assertion.evidence.includes(claim.id)).map((claim) => claim.company)),
    ]);
    if (packet.companies.length > 1 && packet.coverage.some((entry) => entry.status === "shown" && !covered.has(entry.company))) return null;
    // An observation whose every figure a kept comparison writes is not said
    // twice; it still stands as an inference's support. One fact shown in two
    // blocks is one figure.
    const factOf = (id: string) => packet.figures.find((figure) => figure.id === id)?.fact_id ?? id;
    const compared = new Set(kept.filter((entry) => entry.kind === "comparison").flatMap((entry) => entry.figure_ids.map(factOf)));
    repeated = kept.filter((entry) => entry.kind === "observation" && entry.figure_ids.every((id) => compared.has(factOf(id)))).map((entry) => entry.index);
    // The guard's own drops; an inference removed with its observation is on the report.
    const dropped = renderRemovals.filter((entry) => guarded.has(entry.index));
    if (dropped.length > 0) input.onNarrativeRemoved?.(dropped.flatMap((entry) => (entry.text ? [entry.text] : [])));
    reportAssertions(true);
    answered();
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
    // What the rendered assertions cannot say themselves: a compared company
    // with no figures shown, and stale data.
    const notShown = packet.coverage.filter((entry) => entry.status === "not_shown").map((entry) => entry.company);
    // The data gaps kept read as one paragraph, where the first stood.
    const gaps = report.accepted.filter((assertion) => assertion.kind === "data_gap" && kept.some((entry) => entry.index === assertion.index));
    const shownEntries = kept
      .filter((entry) => !repeated.includes(entry.index) && (entry.kind !== "data_gap" || entry.index === gaps[0]!.index))
      .map((entry) => (entry.kind === "data_gap" ? { ...entry, segments: [{ type: "text" as const, text: gapText(gaps) }] } : entry));
    return rewriteFirstRichTextBlockWith(input.blocks, [...shownEntries, ...otherSides], [
      ...[calendarNote(keptAssertions, packet)].filter((note) => note !== undefined),
      ...(notShown.length > 0 ? [`No figures are shown for ${new Intl.ListFormat("en").format(notShown)}.`] : []),
      // The claims as selected: more matched than were read, or none could be.
      ...(packet.claims_truncated ? ["More sources matched than are shown here."] : []),
      ...(packet.claims_status === "unavailable" ? ["Research claims could not be read for this answer."] : []),
      ...stalenessNotes(input.toolCalls),
    ]);
  };
  const text = prose.trim();
  // Never show a sentence cut off mid-way, or the placeholder the turn started with.
  // Cut off inside the assertion list, the prose before it is whole.
  if ((result.truncated && !open) || text.length === 0) {
    reportAssertions();
    console.warn(`[chat] model answer was ${result.truncated ? "cut off at the token limit" : "empty"}; showing the fallback sentence`);
    // Pointing to "the reported figures below" needs figures shown, not a gap note.
    return rewriteFirstRichTextBlock(
      input.blocks,
      displayedFigures(factBlocks).length > 0 ? FACT_BLOCKS_FALLBACK_TEXT : NO_ANSWER_FALLBACK_TEXT,
    );
  }
  const claimTexts = claimTextsFromToolCalls(input.toolCalls);
  // The guard limits prose to the figures shown; with none shown (no fact blocks,
  // or only a gap note or chart), the model answers from available_data
  // instead, so no figure is guarded (#181), but no cause may be stated outside
  // a labelled hypothesis either (#263). One condition decides both.
  const shown = displayedFigures(factBlocks);
  if (shown.length === 0) {
    // A claim-only answer renders; one also standing on available_data (its
    // figure assertions unchecked, with no fact to render) keeps its prose.
    // An attribution quotes its sourced claim word for word, so a cause the
    // claim states is the claim's, not the model's.
    const claimOnly = report.unchecked ? null : renderAccepted((text, kind) =>
      kind === "management_attribution" ? [] : keepUncausedSentences(text).removed
    );
    if (claimOnly) return claimOnly;
    reportAssertions();
    const uncaused = keepUncausedSentences(text);
    if (uncaused.removed.length > 0) {
      console.warn(`[chat] removed ${uncaused.removed.length} narrative sentence(s) stating a cause with no figures shown`);
    }
    // A named gap's turn gives the model no data (availableData false): any
    // digit it types is invented, a year included (#221). A claim's number
    // appears only by citing the claim, which renders it whole (#294 review).
    const unnumbered = input.availableData === false
      ? withoutWordedAmounts(keepSupportedSentences(uncaused.text, { ...table, years: new Set() }, claimTexts, input.subjectLabels ?? []))
      : keepKnownReferences(uncaused.text, table);
    if (unnumbered.removed.length > 0) {
      console.warn(`[chat] removed ${unnumbered.removed.length} narrative sentence(s) stating a figure on a turn with no data`);
    }
    // Both batches in one report: the consumer keeps the last it receives (#294 review).
    const removedHere = [...uncaused.removed, ...unnumbered.removed];
    if (removedHere.length > 0) input.onNarrativeRemoved?.(removedHere);
    if (unnumbered.text) answered();
    // No figures are shown here, so the fallback points to none.
    return unnumbered.text ? asProse(unnumbered.text) : rewriteFirstRichTextBlock(input.blocks, NO_ANSWER_FALLBACK_TEXT);
  }

  // The words a stated cause or a hypothesis's basis may use: what the blocks
  // display, the cited claims, and each figure's period end as a rendered
  // observation names it ("ended Jan 2026", #208).
  const guard = (text: string) => keepSupportedSentences(
    text,
    table,
    [
      ...displayTextsForBlocks(factBlocks),
      ...claimTexts,
      ...shown.flatMap((figure) => (figure.period_end ? [monthYear(figure.period_end), shortMonthYear(figure.period_end)] : [])),
    ],
    input.subjectLabels ?? [],
  );
  const rendered = renderAccepted((text) => guard(text).removed);
  if (rendered) return rendered;
  // With rendering on, a comparison the check rejected may be what the prose
  // says ("AMD has the highest margin"), and the guard checks figures, not
  // direction: the prose does not stand in for it.
  // Any rejected comparison, whichever check rejected it (its kind as listed).
  const rejectedComparison = report.rejected.some((entry) => {
    const item = Array.isArray(list) ? list[entry.index] : undefined;
    return isRecord(item) && item.kind === "comparison";
  });
  if (assertionRenderingEnabled(input.env ?? process.env) && rejectedComparison) {
    reportAssertions();
    return rewriteFirstRichTextBlock(input.blocks, FACT_BLOCKS_FALLBACK_TEXT);
  }
  reportAssertions();
  const guarded = guard(text);
  if (guarded.removed.length > 0) {
    console.warn(`[chat] removed ${guarded.removed.length} narrative sentence(s) quoting figures not shown to the user`);
    input.onNarrativeRemoved?.(guarded.removed);
  }
  if (guarded.text) answered();
  return guarded.text ? asProse(guarded.text) : rewriteFirstRichTextBlock(input.blocks, FACT_BLOCKS_FALLBACK_TEXT);
}

// An amount in words: any magnitude or unit word ("three billion dollars",
// "a quarter billion", "hundreds of millions", "twelve percent", "zero
// dollars"), which the guard's digit-based check does not see (#294 review).
// On a turn with no data there is nothing such a word could measure.
// A bare number word is a value too ("a P/E of twenty", #294 review); "one"
// and "a" are left out, as ordinary wording ("one of the metrics").
const WORDED_AMOUNT = /\b(?:zero|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|dozens?|hundreds?|thousands?|millions?|billions?|trillions?|percent|per cent|percentage points?|basis points?|dollars?|cents?|euros?|pounds?|pence|yen|yuan|renminbi|francs?|rupees?)\b/i;

// On a turn with no data, a sentence stating an amount in words goes as one
// in digits does.
function withoutWordedAmounts(guarded: { text: string; removed: string[] }): { text: string; removed: string[] } {
  const removed = [...guarded.removed];
  // A line that lost every sentence is dropped (null), so a heading left with
  // nothing under it goes too, as in the guard (#294 review).
  const lines = guarded.text.split("\n").map((line) => {
    if (line.trim() === "") return line;
    // A list marker leads the line, not a sentence of it, as in the guard.
    const lead = line.match(LIST_MARKER)?.[0] ?? "";
    const kept = line.slice(lead.length).trim().split(SENTENCE_BREAK).filter((sentence) => {
      if (!WORDED_AMOUNT.test(sentence)) return true;
      removed.push(sentence.trim());
      return false;
    });
    return kept.length === 0 ? null : `${lead}${kept.join(" ")}`;
  });
  return { text: withoutEmptySections(lines), removed };
}

// Claim text the answer cites; a figure a claim states is supported.
// Its dates too, as month and year only: the model is asked to date a claim
// ("in November 2025"), so that year is supported, while an ISO date's day and
// time digits ("19", "0") never become supported figures (#181).
function claimTextsFromToolCalls(toolCalls: ReadonlyArray<ChatAnalystToolRuntimeToolCall>): string[] {
  return claimEvidence(toolCalls).claims.flatMap((claim) => [
    claim.text_canonical,
    ...[claim.effective_time, claim.published_at].flatMap((date) => (date ? [monthYear(date)] : [])),
  ]);
}

function shortMonthYear(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

function monthYear(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export type AnswerUsage = { input_tokens: number; output_tokens: number; reasoning_tokens?: number };

// What the answer model sees (#181): only what it can use, as an evidence
// packet (#207, evidence-packet.ts) plus the question and conversation. The figures shown to
// the user (the only ones it may quote, with company, period and period end),
// cited claim text, what could not be shown, and staleness flags. Raw tool JSON,
// the placeholder block, and the routing bundle are left out: the narrative
// guard drops any figure not shown, so the raw facts behind them only added
// tokens and reasoning. When no figures are shown (no fact blocks: a quote-only
// subject, or the fact loader came back empty), nothing is guarded either, and
// the evidence is then summarized compactly as available_data instead.
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
  const quotes = structured.flatMap((context) =>
    isRecord(context.quote) ? [{ ticker: context.quote.ticker, as_of: context.quote.as_of, stale: context.quote.stale }] : []
  );
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
  const shown = (packet.figures as unknown[]).length > 0;
  const available = !shown && input.availableData !== false ? availableData(structured) : null;
  return {
    question: input.context.userIntent ?? "Start a research thread",
    conversation: input.conversation ?? [],
    evidence_packet: {
      ...packet,
      ...(gaps.length > 0 ? { gaps } : {}),
      ...(available ? { available_data: available } : {}),
      ...(quotes.length > 0 || factRecency.length > 0
        ? { staleness: { ...(quotes.length > 0 ? { quote: quotes } : {}), ...(factRecency.length > 0 ? { fact_recency: factRecency } : {}) } }
        : {}),
    },
  };
}

// The turn's evidence packet: its figures, claims and bounds (#207).
function turnPacket(input: {
  toolCalls: ReadonlyArray<ChatAnalystToolRuntimeToolCall>;
  factBlocks?: ReadonlyArray<Record<string, unknown>>;
  scope?: ResearchScope;
  cutoff?: string;
}): EvidencePacket {
  return buildEvidencePacket({
    ...(input.scope ? { scope: input.scope } : {}),
    factBlocks: input.factBlocks ?? [],
    cutoff: input.cutoff ?? new Date().toISOString(),
    claims: claimEvidence(input.toolCalls),
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

// The quote and reported facts, compactly: what an answer with no displayed
// figures can stand on. Null when there is neither.
function availableData(structured: ReadonlyArray<Record<string, unknown>>): Record<string, unknown> | null {
  const quotes = structured.flatMap((context) => isRecord(context.quote) ? [{
    ticker: context.quote.ticker,
    price: context.quote.price,
    // change_pct is a fraction (0.0078 = 0.78%); sent as the percentage it means.
    ...(typeof context.quote.change_pct === "number"
      ? { change: `${context.quote.change_pct >= 0 ? "+" : ""}${(context.quote.change_pct * 100).toFixed(2)}%` }
      : {}),
    currency: context.quote.currency,
    as_of: context.quote.as_of,
    // Fresh is not live: an end-of-day or delayed quote says so.
    ...(typeof context.quote.session_state === "string" ? { session_state: context.quote.session_state } : {}),
    ...(typeof context.quote.delay_class === "string" ? { delay_class: context.quote.delay_class } : {}),
  }] : []);
  const facts = structured.flatMap((context) => (Array.isArray(context.facts) ? context.facts : []).flatMap((fact) =>
    isRecord(fact) && (typeof fact.value_num === "number" || typeof fact.value_text === "string") ? [{
      metric: fact.display_name ?? fact.metric_key,
      value: typeof fact.value_num === "number" ? fact.value_num * (typeof fact.scale === "number" ? fact.scale : 1) : fact.value_text,
      ...(fact.unit ? { unit: fact.unit } : {}),
      ...(fact.currency ? { currency: fact.currency } : {}),
      ...(fact.fiscal_year !== null && fact.fiscal_year !== undefined ? { period: `${fact.fiscal_period ?? ""} ${fact.fiscal_year}`.trim() } : {}),
      // Each value's own date: fact_recency only dates the newest one.
      ...(typeof fact.as_of === "string" ? { as_of: fact.as_of } : {}),
      // How completely the period is covered, when it is not fully.
      ...(typeof fact.coverage_level === "string" && fact.coverage_level !== "full" ? { coverage: fact.coverage_level } : {}),
    }] : []
  ));
  if (quotes.length === 0 && facts.length === 0) return null;
  return { ...(quotes.length > 0 ? { quotes } : {}), ...(facts.length > 0 ? { facts } : {}) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// The narrative block as segments (the guarded prose, or rendered assertions
// paragraph by paragraph), with the fact bindings and sources their refs seal with.
function rewriteFirstRichTextBlockWith(
  blocks: ReadonlyArray<Record<string, unknown>>,
  rendered: ReadonlyArray<ProseSegments>,
  notes: ReadonlyArray<string>,
): ReadonlyArray<Record<string, unknown>> {
  const segments = [
    ...rendered.flatMap((entry, i) => [...(i === 0 ? [] : [{ type: "text", text: "\n\n" }]), ...entry.segments]),
    ...(notes.length > 0 ? [{ type: "text", text: `\n\n${notes.join(" ")}` }] : []),
  ];
  const factBindings = [...new Map(rendered.flatMap((entry) => entry.fact_bindings).map((binding) => [binding.fact_id, binding])).values()];
  let rewritten = false;
  return Object.freeze(blocks.map((block) => {
    if (rewritten || block.kind !== "rich_text") return block;
    rewritten = true;
    const dataRef = (block.data_ref ?? {}) as Record<string, unknown>;
    return Object.freeze({
      ...block,
      segments: Object.freeze(segments.map((segment) => Object.freeze({ ...segment }))),
      ...(factBindings.length > 0 ? { data_ref: { ...dataRef, params: { fact_bindings: factBindings } } } : {}),
      source_refs: [...new Set(rendered.flatMap((entry) => entry.source_refs))],
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

// On unless turned off (CHAT_ASSERTION_RENDERING=0, false, no or off): an
// answer is written from its checked assertions (#288).
export function assertionRenderingEnabled(env: Record<string, string | undefined>): boolean {
  return !/^(?:0|false|no|off)$/i.test(env.CHAT_ASSERTION_RENDERING?.trim() ?? "");
}

function rewriteFirstRichTextBlock(
  blocks: ReadonlyArray<Record<string, unknown>>,
  text: string,
): ReadonlyArray<Record<string, unknown>> {
  let rewritten = false;
  return Object.freeze(blocks.map((block) => {
    if (rewritten || block.kind !== "rich_text") return block;
    rewritten = true;
    return Object.freeze({
      ...block,
      segments: Object.freeze([
        Object.freeze({
          type: "text",
          text,
        }),
      ]),
    });
  }));
}

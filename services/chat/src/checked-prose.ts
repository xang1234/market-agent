// Checked prose (#800, variant B): the model writes the answer freely from the evidence
// packet, then two checks read it at once. The labeller points each number at the packet
// entry its sentence names, never seeing the entry's value, and the figure check compares
// the two (financial-core/src/figure-check.ts); the relation check reads its comparisons
// and trends. One rewrite corrects the sentences with real errors, never a last digit or
// a hedge. A figure that holds links to its sealed source; one still wrong is struck.

import { sentenceStarts } from "../../evidence/src/canonical-text.ts";
import {
  atPrecisionOf,
  DERIVATIONS,
  enumerateNumerals,
  linkedVerdict,
  linksAs,
  statedFigures,
  verdictFor,
  type Derivation,
  type FigureLabel,
  type Numeral,
  type Operand,
  type Scale,
  type Verdict,
} from "../../financial-core/src/figure-check.ts";
import type { LlmChatClient, LlmChatRequest, LlmSettingsLoaderEnv } from "../../llm/src/index.ts";
import { isRecord } from "../../shared/src/http.ts";
import { isUuid } from "./chat-ids.ts";
import type { DroppedClaims } from "./coordinator.ts";
import { claimNumeral, figureCompanies, packetForModel, packetValue, parsePacketRef, type EvidencePacket, type PacketClaim, type PacketRef } from "./evidence-packet.ts";
import { modelCall, type ModelRecord } from "./inference-judge.ts";
import { ANSWER_DEADLINES, droppedNotes, type ModelDeadlines } from "./llm-runtime.ts";
import type { Sealer, Segment } from "./prose-refs.ts";
import { statesStance } from "./stance.ts";

// The checks wait at most this long: a labeller that times out leaves the figures plain.
const CHECK_DEADLINES: ModelDeadlines = { attemptMs: 45_000, totalMs: 50_000 };
// The rewrite and its checks start only with this much of the turn left.
const REWRITE_BUDGET_MS = 35_000;

// What the lane says under the prose when a check could not run (§7 question 1: the prose
// stays, its figures plain, under a note).
const FIGURES_UNCHECKED = "The figures in this text could not be checked against the sources just now.";
const RELATIONS_UNCHECKED = "Comparisons in this text were not checked.";
const CUT_OFF = "The answer was cut off at its length limit, so it may end early.";

type ModelCallOf = (request: LlmChatRequest, deadlines: ModelDeadlines) => Promise<ModelRecord>;
// write: the draft and the rewrite, on the default purpose. check: the labeller and the
// relation check, on the check purpose (CHECK_LITELLM_MODEL), with no fallback.
export type CheckedProseModels = Readonly<{ write: ModelCallOf; check: ModelCallOf }>;

export function checkedProseModels(env: LlmSettingsLoaderEnv, createClient?: () => Promise<LlmChatClient> | LlmChatClient): CheckedProseModels {
  const call = (what: string, purpose: "default" | "check"): ModelCallOf => (request, deadlines) =>
    modelCall({ what, purpose, env, ...(createClient ? { createClient } : {}), request, deadlines });
  return { write: call("answer", "default"), check: call("check", "check") };
}

export type CheckedProseInput = Readonly<{
  question: string;
  conversation: ReadonlyArray<{ role: string; text: string }>;
  packet: EvidencePacket;
  // What is left of the turn's time, in ms.
  remainingMs: () => number;
}>;

// Runs one call under a step line the reader sees.
export type ProseStep = <T>(tool: string, label: string, run: () => Promise<T>) => Promise<T>;

type NumeralLabel = Readonly<{ kind: "name" }> | Readonly<{ kind: "figure"; label: FigureLabel<PacketRef> }>;
export type CheckedNumeral = Readonly<{ numeral: Numeral; label: NumeralLabel | null; verdict: Verdict | null }>;
export type RelationFinding = Readonly<{ quote: string; problem: string; correction: string }>;
// One sentence's text and what the checks found in it; offsets are within the text.
export type Version = Readonly<{ text: string; numerals: ReadonlyArray<CheckedNumeral>; findings: ReadonlyArray<RelationFinding>; stance: boolean }>;
type Outcome = Readonly<{ ok: true }> | Readonly<{ ok: false; error: string }>;
// A round of the two checks over some of the sentences.
export type CheckRound = Readonly<{ labelled: Outcome; related: Outcome; versions: Readonly<Record<string, Version>> }>;

// What can go back. A near figure has no kind here, so it cannot be sent.
type Problem =
  | Readonly<{ kind: "wrong_figure"; text: string; data: string }>
  | Readonly<{ kind: "untraced_figure"; text: string; what: string }>
  | Readonly<{ kind: "relation"; finding: RelationFinding }>
  | Readonly<{ kind: "stance" }>;
export type RewriteRequest = ReadonlyArray<Readonly<{ sentence: string; text: string; problems: ReadonlyArray<Problem> }>>;

export type CheckedProse = Readonly<{
  // The deployment (channel/model) that wrote the draft.
  written_by: string;
  // The draft cut into sentences s1, s2...: the text before the first, and after each.
  lead: string;
  sentences: ReadonlyArray<Readonly<{ id: string; after: string }>>;
  draft: CheckRound;
  // The draft stopped at its length limit, so the answer may end early.
  cut_off?: true;
  rewrite: Readonly<{ request: RewriteRequest; edits: Readonly<Record<string, string>> | Readonly<{ error: string }>; recheck: CheckRound | null }> | null;
  // Each sentence's kept version, in order; its text is "" when it is left out.
  final: ReadonlyArray<Version>;
}>;

export async function checkedProse(input: CheckedProseInput, models: CheckedProseModels, step: ProseStep): Promise<CheckedProse | null> {
  const { packet } = input;
  const written = await step("write_answer", "Writing the answer", () => models.write(draftRequest(input), ANSWER_DEADLINES));
  if (written.outcome !== "replied") return null;
  const { lead, parts } = cut(written.exchange.text);
  const texts = Object.fromEntries(parts.map((part) => [part.id, part.text]));
  const figures = parts.reduce((count, part) => count + answerNumerals(part.text).length, 0);
  const draft = await step("check_answer", `Checking ${figures} figure${figures === 1 ? "" : "s"} and the comparisons`, () =>
    checkRound(models, packet, input.question, lead, parts, texts, new Set(parts.map((part) => part.id))));
  const request = rewriteRequest(parts, draft);
  const sentences = parts.map(({ id, after }) => ({ id, after }));
  const head = { written_by: written.exchange.deployment, lead, sentences, draft, ...(written.exchange.truncated ? { cut_off: true as const } : {}) };
  if (request.length === 0 || input.remainingMs() < REWRITE_BUDGET_MS) {
    return { ...head, rewrite: null, final: parts.map((part) => kept(draft.versions[part.id]!)) };
  }
  const corrected = await step("correct_answer", `Correcting ${request.length} sentence${request.length === 1 ? "" : "s"}`, () =>
    models.write(rewriteMessages(input, written.exchange.text, request), ANSWER_DEADLINES));
  const edits = corrected.outcome === "replied" ? parseEdits(corrected.exchange.text, new Set(request.map((entry) => entry.sentence))) : null;
  if (edits === null) {
    const error = corrected.outcome === "replied" ? "the rewrite was unreadable" : corrected.reason;
    return { ...head, rewrite: { request, edits: { error }, recheck: null }, final: parts.map((part) => kept(draft.versions[part.id]!)) };
  }
  const edited = new Set(Object.keys(edits));
  const recheck = edited.size === 0 ? null : await step("check_corrections", "Checking the corrections", () =>
    checkRound(models, packet, input.question, lead, parts, { ...texts, ...edits }, edited, draft.labelled.ok));
  // A check that failed on the corrections but not on the draft found nothing because it
  // read nothing, so every edit keeps the checked draft; so does an edit with a numeral the
  // checks did not settle.
  const unchecked = recheck !== null && ((draft.labelled.ok && !recheck.labelled.ok) || (draft.related.ok && !recheck.related.ok));
  const final = parts.map((part) => {
    const before = draft.versions[part.id]!;
    const after = recheck?.versions[part.id];
    const unsettled = draft.labelled.ok && after?.numerals.some(isUnsettled);
    return kept(after === undefined || unchecked || unsettled || problemCount(after) > problemCount(before) ? before : after);
  });
  return { ...head, rewrite: { request, edits, recheck }, final };
}

// The packet ids of the claims the final prose quotes by marker.
export const quotedClaims = (checked: CheckedProse): string[] =>
  [...new Set(checked.final.flatMap((version) => [...version.text.matchAll(MARKER)].map((match) => match[1]!)))];

// --- sentences ---------------------------------------------------------------------

type Part = Readonly<{ id: string; text: string; after: string }>;

// The answer cut into sentences: each line of Markdown a block, each block cut where
// sentenceStarts reads a sentence end (canonical-text.ts).
function cut(text: string): { lead: string; parts: Part[] } {
  const starts: number[] = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    const indent = line.length - line.trimStart().length;
    if (line.trim() !== "") starts.push(offset + indent, ...sentenceStarts(line).map((start) => offset + start));
    offset += line.length + 1;
  }
  const parts = starts.map((start, i) => {
    const chunk = text.slice(start, starts[i + 1] ?? text.length);
    const body = chunk.trimEnd();
    return { id: `s${i + 1}`, text: body, after: chunk.slice(body.length) };
  });
  return { lead: text.slice(0, starts[0] ?? text.length), parts };
}

const joined = (lead: string, parts: ReadonlyArray<{ after: string }>, texts: ReadonlyArray<string>) =>
  lead + parts.map((part, i) => texts[i] + (texts[i] === "" ? "" : part.after)).join("");

// A claim marker the writer puts where a claim's words go: [C3].
const MARKER = /\[(C\d+)\]/gu;

// The numbers a sentence states, but the digits of a claim marker.
function answerNumerals(text: string): Numeral[] {
  const markers = [...text.matchAll(MARKER)].map((match) => [match.index, match.index + match[0].length] as const);
  return enumerateNumerals(text).filter((numeral) => !markers.some(([start, end]) => numeral.start >= start && numeral.end <= end));
}

// --- the checks ----------------------------------------------------------------------

async function checkRound(
  models: CheckedProseModels,
  packet: EvidencePacket,
  question: string,
  lead: string,
  parts: ReadonlyArray<Part>,
  texts: Readonly<Record<string, string>>,
  checked: ReadonlySet<string>,
  // False once the draft's labelling failed: its figures stay plain, so none is labelled again.
  label = true,
): Promise<CheckRound> {
  // Ids n1, n2... across the sentences checked, in order.
  const numbered = parts.flatMap((part) => (checked.has(part.id) ? answerNumerals(texts[part.id]!).map((numeral) => ({ part: part.id, numeral })) : []));
  const ids = numbered.map((_, i) => `n${i + 1}`);
  let next = 0;
  const shownText = joined(lead, parts, parts.map((part) => {
    const text = texts[part.id]!;
    if (!checked.has(part.id)) return text;
    let marked = "";
    let at = 0;
    for (const numeral of answerNumerals(text)) {
      marked += `${text.slice(at, numeral.start)}⟦${ids[next++]}:${numeral.text}⟧`;
      at = numeral.end;
    }
    return marked + text.slice(at);
  }));
  const plainText = joined(lead, parts, parts.map((part) => texts[part.id]!));
  const [labelled, related] = await Promise.all([
    numbered.length === 0 || !label ? null : models.check(labellerRequest(question, shownText, packet), CHECK_DEADLINES),
    models.check(relationRequest(question, plainText, parts.filter((part) => checked.has(part.id)).map((part) => texts[part.id]!), packet), CHECK_DEADLINES),
  ]);
  const labels = labelled === null ? new Map<string, NumeralLabel>() : labelled.outcome === "replied" ? parseLabels(labelled.exchange.text, new Set(ids), packet) : null;
  const findings = related.outcome === "replied" ? parseFindings(related.exchange.text) : null;
  const versions: Record<string, Version> = {};
  for (const part of parts.filter((entry) => checked.has(entry.id))) {
    const text = texts[part.id]!;
    versions[part.id] = {
      text,
      numerals: numbered.flatMap((entry, i) => {
        if (entry.part !== part.id) return [];
        const label = labels?.get(ids[i]!) ?? null;
        const verdict = label?.kind === "figure" ? verdictFor(entry.numeral, claimSized(label.label, packet), (ref) => packetValue(packet, ref)) : null;
        return [{ numeral: entry.numeral, label, verdict }];
      }),
      findings: (findings ?? []).filter((finding) => text.includes(finding.quote)),
      stance: statesStance(text),
    };
  }
  return {
    labelled: labelled === null || labels !== null ? { ok: true } : { ok: false, error: labelled.outcome === "replied" ? "unreadable labels" : labelled.reason },
    related: findings !== null ? { ok: true } : { ok: false, error: related.outcome === "replied" ? "unreadable findings" : related.reason },
    versions,
  };
}

// A claim's numeral gives a size and its words the sign ("Operating loss was $134 million"
// reads 134M), so a figure reported from an unsigned one is compared by size, as the seal
// compares it. ponytail: an answer's own minus ("-$134M") on one, or a derivation over such
// claims, still compares signed.
const claimSized = (label: FigureLabel<PacketRef>, packet: EvidencePacket): FigureLabel<PacketRef> =>
  label.basis === "reported" && "claim" in label.source && claimNumeral(packet, label.source)?.signed === false ? { ...label, sign: null } : label;

const isWrong = (numeral: CheckedNumeral) => numeral.verdict?.kind === "wrong";
const isUntraced = (numeral: CheckedNumeral) => numeral.label?.kind === "figure" && numeral.label.label.basis === "off_file";
// Neither a name nor a verdict: no label (the labeller left it out), or a label the figure
// check cannot evaluate. An untraced figure is settled, as a problem.
const isUnsettled = (numeral: CheckedNumeral) => numeral.label === null || (numeral.verdict?.kind === "not_checkable" && !isUntraced(numeral));
const problemCount = (version: Version) =>
  version.numerals.filter((numeral) => isWrong(numeral) || isUntraced(numeral)).length + version.findings.length + (version.stance ? 1 : 0);
// ADR 0005: a sentence still stating a stance is left out.
const kept = (version: Version): Version => (version.stance ? { text: "", numerals: [], findings: [], stance: false } : version);

function rewriteRequest(parts: ReadonlyArray<Part>, round: CheckRound): RewriteRequest {
  return parts.flatMap((part) => {
    const version = round.versions[part.id]!;
    const problems: Problem[] = [
      ...version.numerals.flatMap((entry): Problem[] => {
        if (entry.verdict?.kind === "wrong") {
          const scale = entry.label?.kind === "figure" && entry.label.label.basis !== "off_file" ? entry.label.label.scale : null;
          return [{ kind: "wrong_figure", text: entry.numeral.text, data: atPrecisionOf(entry.numeral, entry.verdict.expected, scale) }];
        }
        return entry.label?.kind === "figure" && entry.label.label.basis === "off_file" ? [{ kind: "untraced_figure", text: entry.numeral.text, what: entry.label.label.what }] : [];
      }),
      ...version.findings.map((finding): Problem => ({ kind: "relation", finding })),
      ...(version.stance ? [{ kind: "stance" } as const] : []),
    ];
    return problems.length === 0 ? [] : [{ sentence: part.id, text: version.text, problems }];
  });
}

function problemText(problem: Problem): string {
  switch (problem.kind) {
    case "wrong_figure":
      return `${problem.text} is not what the sources give: they give ${problem.data}.`;
    case "untraced_figure":
      return `${problem.text} is not in the sources read (${problem.what}): state only what they give, or leave it out.`;
    case "relation":
      return `${problem.finding.quote}: ${problem.finding.problem}. Say instead: ${problem.finding.correction}.`;
    case "stance":
      return "It states a rating or recommendation, which the answer never gives.";
  }
}

// --- prompts -----------------------------------------------------------------------

function draftRequest(input: CheckedProseInput): LlmChatRequest {
  return {
    messages: [
      {
        role: "system",
        content: [
          // The scripted replies in tests match on this opening sentence, as the replay fixture does.
          "Write a concise investment research answer for the chat user in Markdown, from evidence_packet alone.",
          "Answer as a buy-side analyst would: your takeaway first, answering the question directly; then what the figures show across every period",
          "and company shown, and what is strong or weak against the others; last, one specific counterpoint grounded in the data.",
          "State each figure as evidence_packet gives it, or computed from its figures (a growth rate, a margin, a difference), never one it does not hold.",
          "Code checks every number you write against the packet, so write no figure from your own knowledge.",
          "To quote a claim, write its id in brackets where its words go, as [C3]: the claim's own words are shown there, with its source.",
          // §7 question 3: a cause stays out by this rule alone; the relation check does not read causes against cited claims.
          "Never state a cause the evidence does not give: a cause management stated is quoted from its claim.",
          "Never write Buy, Hold, Sell, a price target or any recommendation.",
          "Say nothing about what the packet lacks: the answer's own notes say what is missing, from evidence_packet.gaps.",
          "Reply with the answer alone, a few short paragraphs or a short list, with no heading.",
        ].join("\n"),
      },
      { role: "user", content: JSON.stringify({ question: input.question, conversation: input.conversation, evidence_packet: packetForModel(input.packet) }) },
    ],
    maxTokens: 4096,
  };
}

// The packet's entries by id, with no figure's value: a labeller that saw them could point
// a number at the entry it matches instead of at what its sentence says. A claim's text is
// its value, so it is shown, with each figure it states by id (C2.1), counted here rather
// than by the labeller (#811).
function entryLines(packet: EvidencePacket): string[] {
  return [
    ...packet.figures.map((figure) => {
      const companies = [...new Set(figureCompanies(figure, packet).filter((company) => company !== undefined))];
      return `${figure.id}: ${[companies.join(" vs "), figure.segment ? `${figure.metric} (${figure.segment})` : figure.metric, figure.period].filter(Boolean).join(", ")}`;
    }),
    ...packet.claims.map((claim) => {
      const stated = statedFigures(claim.text).map((numeral, i) => `${claim.id}.${i + 1} ${JSON.stringify(numeral.text)}`);
      return `${claim.id}: ${JSON.stringify(claim.text)}${stated.length > 0 ? ` Its figures: ${stated.join(", ")}` : ""}`;
    }),
  ];
}

function labellerRequest(question: string, marked: string, packet: EvidencePacket): LlmChatRequest {
  return {
    messages: [
      {
        role: "system",
        content: [
          "You label every marked number in an equity research answer, so code can check each one against the evidence it was written from.",
          "Each number is marked ⟦id:text⟧. Put every id in exactly one place: labels or figures.",
          "A label names or counts rather than measures: a year, a fiscal year, a quarter number, a date, a count (eight quarters, three companies), a rank or list number, or part of a name.",
          "A figure states an amount, price, percentage, margin, growth rate, change or multiple. For each figure give:",
          "- basis \"reported\" when it states one evidence entry, with source that entry's id (F3, or C2.1 for a figure a claim states);",
          "- basis \"derived\" when it is computed (a margin, growth rate, share or multiple always is) from entries, with derivation and its two operands in this order:",
          "margin [profit, revenue]; share_of_total [part, total]; growth [earlier, later]; difference [first, the value subtracted from it], so a change from A to B is [B, A];",
          "ratio [numerator, denominator]; sum, one operand adding them all. An operand is the ids in add, less those in subtract, over the sum of those in over",
          "when it compares two margins or ratios (else over null). One entry is add [its id], subtract [], over null;",
          "a difference of two percents is a change in points, so a cost or remainder stated as a share of revenue (\"operating costs were 9.5% of revenue\")",
          "is a margin whose first operand adds and subtracts the amounts (gross profit, subtract operating income), never a difference of two margins;",
          "- sign \"-\" for a loss or a change stated as a decline, \"+\" for one stated as a gain, null otherwise; a level (\"fell to 60.5%\") has sign null;",
          "- scale when the number has no B, M or K of its own but its table puts it in thousands, millions or billions, else null.",
          "Point at what the sentence says, even where you think it is wrong. A figure about something no entry holds has source null and what: a few words on what it is.",
          "Reply with only a fenced block that opens with ```labels on its own line: {\"labels\": [ids], \"figures\": [{\"id\", \"basis\", \"source\", \"derivation\", \"operands\", \"sign\", \"scale\", \"what\"}]}.",
        ].join("\n"),
      },
      { role: "user", content: [`The question: ${question}`, `The answer, with its numbers marked:\n\n${marked}`, `Evidence entries (values withheld):\n${entryLines(packet).join("\n")}`].join("\n\n") },
    ],
    maxTokens: 8192,
  };
}

function relationRequest(question: string, text: string, sentences: ReadonlyArray<string>, packet: EvidencePacket): LlmChatRequest {
  return {
    messages: [
      {
        role: "system",
        content: [
          "You check the comparisons, trends and causes an equity research answer states against the evidence it was written from.",
          "List each statement in the sentences to check that the evidence contradicts: a direction (rose where it fell), an order (higher where lower),",
          "a comparison between companies or periods, or something a claim says that the answer turns around.",
          "Leave the numbers themselves alone, and anything the evidence neither supports nor contradicts.",
          "Reply with only a fenced block that opens with ```findings on its own line: a JSON array of {\"quote\", \"problem\", \"correction\"}:",
          "quote copies a few words of the sentence exactly, problem says what the evidence shows, and correction is the words to say in the quote's place.",
          "Reply [] when nothing is contradicted.",
        ].join("\n"),
      },
      { role: "user", content: JSON.stringify({ question, answer: text, sentences_to_check: sentences, evidence_packet: packetForModel(packet) }) },
    ],
    maxTokens: 4096,
  };
}

function rewriteMessages(input: CheckedProseInput, draft: string, request: RewriteRequest): LlmChatRequest {
  return {
    messages: [
      {
        role: "system",
        content: [
          "You correct the listed sentences of an equity research answer, each for the problems listed with it, from evidence_packet alone.",
          "Rewrite only those sentences, keeping their Markdown and what is right in them; a sentence that cannot be put right is left out with text \"\".",
          "Never write a figure evidence_packet does not hold or compute, a cause it does not give, or a rating or recommendation.",
          "Reply with only a fenced block that opens with ```edits on its own line: a JSON array of {\"sentence\", \"text\"}, one per sentence listed.",
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify({
          answer: draft,
          sentences: request.map((entry) => ({ id: entry.sentence, text: entry.text, problems: entry.problems.map(problemText) })),
          evidence_packet: packetForModel(input.packet),
        }),
      },
    ],
    maxTokens: 4096,
  };
}

// --- replies, read at the boundary ----------------------------------------------------

function fenced(text: string, name: string): unknown {
  const written = new RegExp(`\`\`\`${name}[ \\t]*\\r?\\n([\\s\\S]*?)(?:\`\`\`|$)`, "u").exec(text)?.[1];
  if (written === undefined) return undefined;
  try {
    return JSON.parse(written);
  } catch {
    return undefined;
  }
}

// An unknown numeral id is ignored; a source the packet does not hold makes the figure off_file.
function parseLabels(reply: string, ids: ReadonlySet<string>, packet: EvidencePacket): Map<string, NumeralLabel> | null {
  const json = fenced(reply, "labels");
  if (!isRecord(json) || !Array.isArray(json.labels) || !Array.isArray(json.figures)) return null;
  const labels = new Map<string, NumeralLabel>();
  for (const id of json.labels) if (typeof id === "string" && ids.has(id)) labels.set(id, { kind: "name" });
  for (const figure of json.figures) {
    if (isRecord(figure) && typeof figure.id === "string" && ids.has(figure.id)) labels.set(figure.id, { kind: "figure", label: figureLabel(figure, packet) });
  }
  return labels;
}

const SCALES: ReadonlyArray<Scale> = ["thousands", "millions", "billions"];

function figureLabel(figure: Record<string, unknown>, packet: EvidencePacket): FigureLabel<PacketRef> {
  const sign = figure.sign === "+" || figure.sign === "-" ? figure.sign : null;
  const scale = SCALES.find((entry) => entry === figure.scale) ?? null;
  const offFile = { basis: "off_file", what: typeof figure.what === "string" && figure.what.trim() ? figure.what.trim() : "an entry the sources do not hold" } as const;
  const ref = (id: unknown) => (typeof id === "string" ? parsePacketRef(id, packet) : null);
  if (figure.basis === "derived") {
    const derivation = DERIVATIONS.find((entry) => entry === figure.derivation);
    const refs = (value: unknown) => (Array.isArray(value) ? value.map(ref) : null);
    const operands = Array.isArray(figure.operands) ? figure.operands.map((operand) => {
      if (!isRecord(operand)) return null;
      const [add, subtract, over] = [refs(operand.add), refs(operand.subtract ?? []), operand.over == null ? null : refs(operand.over)];
      const known = (list: Array<PacketRef | null> | null): list is PacketRef[] => list !== null && list.every((entry) => entry !== null);
      return known(add) && known(subtract) && (operand.over == null || known(over)) ? { add, subtract, over: over as PacketRef[] | null } : null;
    }) : [];
    if (derivation === undefined || operands.length === 0 || operands.some((operand) => operand === null)) return offFile;
    return { basis: "derived", derivation, operands: operands as Operand<PacketRef>[], sign, scale };
  }
  const source = ref(figure.source);
  return source ? { basis: "reported", source, sign, scale } : offFile;
}

// A finding whose quote no sentence holds is dropped where it is read (checkRound).
function parseFindings(reply: string): RelationFinding[] | null {
  const json = fenced(reply, "findings");
  if (!Array.isArray(json)) return null;
  return json.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const [quote, problem, correction] = [entry.quote, entry.problem, entry.correction].map((value) => (typeof value === "string" ? value.trim() : ""));
    return quote && problem && correction ? [{ quote: quote!, problem: problem!, correction: correction! }] : [];
  });
}

// An edit naming a sentence not sent back is ignored; "" leaves the sentence out.
function parseEdits(reply: string, sent: ReadonlySet<string>): Record<string, string> | null {
  const json = fenced(reply, "edits");
  if (!Array.isArray(json)) return null;
  return Object.fromEntries(json.flatMap((entry) =>
    isRecord(entry) && typeof entry.sentence === "string" && sent.has(entry.sentence) && typeof entry.text === "string" ? [[entry.sentence, entry.text.trim()]] : []));
}

// --- segments ------------------------------------------------------------------------

type SourceRef = Readonly<{ ref_kind: "result" | "fact" | "series" | "claim"; ref_id: string; format: string; period?: string; numeral?: number }>;
export type FigureSegment = Readonly<{ type: "figure"; text: string; sources: ReadonlyArray<SourceRef>; derivation?: Derivation; operands?: ReadonlyArray<Operand<number>>; near?: true }>;
export type StruckSegment = Readonly<{ type: "struck"; text: string; reason: string; sources?: ReadonlyArray<SourceRef> }>;
export type ProseSegment = Segment | FigureSegment | StruckSegment;

/**
 * The checked prose as rich_text segments: each figure that holds linked to its sources,
 * each still wrong struck naming the data, each claim marker its claim's quote, and the
 * notes after. dropped: the claims the seal left out (#557), whose sentences go with them.
 */
export function proseSegments(checked: CheckedProse, packet: EvidencePacket, sealer: Sealer, dropped?: DroppedClaims): ProseSegment[] {
  const gone = new Set([...(dropped?.withdrawn ?? []), ...(dropped?.unchecked ?? [])]);
  const claims = new Map(packet.claims.map((claim) => [claim.id, claim]));
  const isGone = (claim: PacketClaim | undefined) => claim !== undefined && gone.has(claim.claim_id);
  // §7 question 1: when the labeller failed, every figure is plain under the note.
  const figuresChecked = checked.draft.labelled.ok;
  const segments: ProseSegment[] = [{ type: "text", text: checked.lead }];
  let untraced = 0;
  checked.final.forEach((version, i) => {
    const { text } = version;
    if (text === "" || [...text.matchAll(MARKER)].some((match) => isGone(claims.get(match[1]!)))) return;
    const spans: Array<{ start: number; end: number; segment: ProseSegment }> = [];
    const overlaps = (start: number, end: number) => spans.some((span) => span.start < end && start < span.end);
    // A contradicted comparison is struck whole, over any figure or claim inside its quote.
    // ponytail: of two overlapping quotes the first is struck alone; merge them if that shows up.
    for (const finding of version.findings) {
      const start = text.indexOf(finding.quote);
      const end = start + finding.quote.length;
      if (!overlaps(start, end)) spans.push({ start, end, segment: { type: "struck", text: finding.quote, reason: finding.correction } });
    }
    for (const match of text.matchAll(MARKER)) {
      const claim = claims.get(match[1]!);
      const end = match.index + match[0].length;
      if (claim && !overlaps(match.index, end)) spans.push({ start: match.index, end, segment: sealer.quote(claim) });
    }
    for (const entry of version.numerals) {
      if (overlaps(entry.numeral.start, entry.numeral.end)) continue;
      if (entry.label?.kind !== "figure") {
        if (entry.label === null && figuresChecked) untraced += 1;
        continue;
      }
      const shown = figuresChecked ? figureSegment(entry, entry.label.label, packet, sealer, isGone) : null;
      if (shown) spans.push({ start: entry.numeral.start, end: entry.numeral.end, segment: shown });
      else if (figuresChecked) untraced += 1;
    }
    let at = 0;
    for (const span of spans.sort((a, b) => a.start - b.start)) {
      segments.push({ type: "text", text: text.slice(at, span.start) } as const, span.segment);
      at = span.end;
    }
    segments.push({ type: "text", text: text.slice(at) + checked.sentences[i]!.after });
  });
  const notes = [
    ...(checked.cut_off ? [CUT_OFF] : []),
    ...(figuresChecked ? [] : [FIGURES_UNCHECKED]),
    ...(checked.draft.related.ok ? [] : [RELATIONS_UNCHECKED]),
    ...(untraced === 0 ? [] : [`${untraced} figure${untraced === 1 ? "" : "s"} could not be traced to the sources read.`]),
    ...(dropped ? droppedNotes(dropped) : []),
  ];
  const body = joinedText(segments);
  const last = body.at(-1);
  if (last?.type === "text") body[body.length - 1] = { type: "text", text: last.text.trimEnd() };
  return joinedText([...body, { type: "text", text: notes.map((note) => `\n\n_${note}_`).join("") }]);
}

// Adjacent text runs as one, and no empty run.
const joinedText = (segments: ReadonlyArray<ProseSegment>) => segments.reduce<ProseSegment[]>((all, segment) => {
  const last = all.at(-1);
  if (segment.type === "text" && last?.type === "text") all[all.length - 1] = { type: "text", text: last.text + segment.text };
  else if (segment.type !== "text" || segment.text !== "") all.push(segment);
  return all;
}, []);

// A figure as a sealed segment: linked when its verdict lets it and every source has a
// sealed ref, struck naming the data when it is wrong, else null (plain text). The seal
// recomputes the linked verdict from these sources (snapshot/src/figure-segments.ts), so a
// figure links only when linkedVerdict, which the seal runs, agrees.
function figureSegment(entry: CheckedNumeral, label: FigureLabel<PacketRef>, packet: EvidencePacket, sealer: Sealer, isGone: (claim: PacketClaim | undefined) => boolean): ProseSegment | null {
  if (label.basis === "off_file" || entry.verdict === null) return null;
  const refs = label.basis === "reported" ? [label.source] : uniqueRefs(label.operands.flatMap((operand) => [...operand.add, ...operand.subtract, ...(operand.over ?? [])]));
  const sources = refs.map((ref) => sourceOf(ref, packet, sealer, isGone));
  const sealed = sources.every((source) => source !== null) ? (sources as SourceRef[]) : null;
  const text = entry.numeral.text;
  if (entry.verdict.kind === "wrong") {
    const scale = label.scale;
    return { type: "struck", text, reason: `the sources give ${atPrecisionOf(entry.numeral, entry.verdict.expected, scale)}`, ...(sealed ? { sources: sealed } : {}) };
  }
  if (sealed === null) return null;
  const index = (ref: PacketRef) => refs.findIndex((entry) => sameRef(entry, ref));
  const figure: FigureSegment = {
    type: "figure",
    text,
    sources: sealed,
    ...(label.basis === "derived"
      ? { derivation: label.derivation, operands: label.operands.map((operand) => ({ add: operand.add.map(index), subtract: operand.subtract.map(index), over: operand.over === null ? null : operand.over.map(index) })) }
      : {}),
    ...(entry.verdict.kind === "near" ? { near: true as const } : {}),
  };
  const values = refs.map((ref) => packetValue(packet, ref));
  return linksAs(figure, entry.verdict) && linksAs(figure, linkedVerdict(figure, (i) => values[i])) ? figure : null;
}

const sameRef = (a: PacketRef, b: PacketRef) => ("figure" in a && "figure" in b ? a.figure === b.figure : "claim" in a && "claim" in b && a.claim === b.claim && a.numeral === b.numeral);
const uniqueRefs = (refs: ReadonlyArray<PacketRef>) => refs.filter((ref, i) => refs.findIndex((other) => sameRef(other, ref)) === i);

// A packet entry's sealed ref: an engine result, a price series, or a stored claim's k-th
// figure; null for anything the seal could not read (a non-UUID claim, a fact).
function sourceOf(ref: PacketRef, packet: EvidencePacket, sealer: Sealer, isGone: (claim: PacketClaim | undefined) => boolean): SourceRef | null {
  if ("claim" in ref) {
    const claim = packet.claims.find((entry) => entry.id === ref.claim);
    return claim && isUuid(claim.claim_id) && !isGone(claim) ? { ref_kind: "claim", ref_id: claim.claim_id, format: claim.text, numeral: ref.numeral } : null;
  }
  const figure = packet.figures.find((entry) => entry.id === ref.figure);
  if (!figure || (!figure.result_id && !figure.series_ref)) return null;
  const segment = sealer.value(figure);
  if (segment.type !== "ref" || (segment.ref_kind !== "result" && segment.ref_kind !== "series")) return null;
  return segment.ref_kind === "result" ? { ref_kind: "result", ref_id: segment.ref_id, format: segment.format, period: segment.period } : { ref_kind: "series", ref_id: segment.ref_id, format: segment.format };
}

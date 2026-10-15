// Evidence-bound assertions (#208), in shadow: the answer model lists what its
// prose asserts, each classified and citing evidence_packet ids ("F2", "C1").
// Company, metric, period and value come from the cited packet entries, never
// typed by the model, so a binding cannot name the wrong company or scale; the
// check here is that every id exists, that each kind cites what it must, and
// that the text writes each figure or claim only as its evidence's reference
// ([[F3]], prose-refs.ts) and names only its evidence's periods and companies.
// An analyst inference writes no figure at all: it says in words what the
// observations and comparisons it rests on mean, so every figure a rendered
// answer shows is a template's value from the packet. A data gap says in words
// what the shown data cannot tell, held to the inference's word rule.
//
// The report goes to evals and logs; the answer is written from the accepted
// assertions (render-assertions.ts) unless CHAT_ASSERTION_RENDERING is off,
// when it is checked in shadow and the guarded prose is shown.

import { checkComparison, type ComparisonOp } from "./comparisons.ts";
import { statesCause } from "./narrative-guard.ts";
import type { EvidencePacket } from "./evidence-packet.ts";
import { REFERENCE, referenceTable, typedDigits, yearsOf, type ReferenceTable } from "./prose-refs.ts";
import { requestedMetrics } from "./research-scope.ts";

export const ASSERTION_KINDS = ["observation", "comparison", "management_attribution", "analyst_inference", "unknown_cause", "data_gap"] as const;
export type AssertionKind = (typeof ASSERTION_KINDS)[number];

export type Assertion = {
  kind: AssertionKind;
  text: string;
  evidence: ReadonlyArray<string>;
  // An inference's supporting observations and comparisons, by their index in the list.
  supports?: ReadonlyArray<number>;
  // The company an inference is about, one its evidence covers: across
  // companies its text names none, so the label names it (#308).
  subject?: string;
  // A comparison's operation and claimed result (comparisons.ts): the high or
  // low's id, the ids highest first, or a trend's result.
  op?: ComparisonOp;
  result?: string | ReadonlyArray<string>;
};

export type AssertionReport = {
  // missing: the answer listed none; malformed: the list did not parse;
  // skipped: no figures or claims, so there was nothing to bind (the answer
  // stood on available_data, which carries no packet ids).
  status: "missing" | "malformed" | "checked" | "skipped";
  accepted: ReadonlyArray<Assertion & { index: number }>;
  rejected: ReadonlyArray<{ index: number; text?: string; reason: string }>;
  // Assertions about figures when none were shown (the answer stood on
  // available_data, which carries no packet ids): neither accepted nor rejected.
  unchecked?: number;
  // The answer was written from the accepted assertions (controlled rendering).
  rendered?: boolean;
  // Accepted observations the rendered answer leaves out, since a comparison
  // it shows writes every figure they state.
  repeated?: ReadonlyArray<number>;
};

// The answer is rendered from this list (#208), so it holds a comparison
// answer's observations, a comparison per metric, the takeaway and the
// counterpoint; at 8, counterpoints fell past the cap (2026-10-13 eval).
export const MAX_ASSERTIONS = 12;

// The check a rejection failed (rejection-check.ts, #221).
export { rejectionCheck, type RejectionCheck } from "./rejection-check.ts";

// The list closes the answer in a fenced block the reader never sees. Wherever
// it is, and closed or not, it is cut from the prose. open: the list never
// closed, so an answer cut off at the token limit inside it kept its prose
// whole (a cut after a closed list fell in the prose).
const FENCES = /[ \t]*```assertions[ \t]*\r?\n([\s\S]*?)(?:(```)|$)[ \t]*/g;

// The prose without its assertion list, and the list as written (undefined when
// there is none; null when it does not parse).
export function splitAssertions(text: string): { prose: string; list: unknown[] | null | undefined; open: boolean } {
  const matches = [...text.matchAll(FENCES)];
  if (matches.length === 0) return { prose: text, list: undefined, open: false };
  // Every block is cut, so a second (a corrected list) never shows; the first
  // is the one checked.
  const prose = text.replace(FENCES, "\n\n").replace(/(?:\r?\n){3,}/g, "\n\n").trim();
  // Closed when its closing fence matched, whatever spaces follow it.
  const open = matches.at(-1)![2] === undefined;
  try {
    const parsed: unknown = JSON.parse(matches[0]![1]!);
    return { prose, list: Array.isArray(parsed) ? parsed : null, open };
  } catch {
    return { prose, list: null, open };
  }
}

// table: the turn's references and the names its text may write (prose-refs.ts);
// from the packet alone, its names are the figures' metrics and segments.
export function checkAssertions(
  list: unknown[] | null | undefined,
  packet: EvidencePacket,
  table: ReferenceTable = referenceTable(packet, []),
): AssertionReport {
  if (packet.figures.length === 0 && packet.claims.length === 0) return { status: "skipped", accepted: [], rejected: [] };
  if (list === undefined) return { status: "missing", accepted: [], rejected: [] };
  if (list === null) return { status: "malformed", accepted: [], rejected: [] };
  const figures = new Map(packet.figures.map((figure) => [figure.id, figure]));
  const claims = new Map(packet.claims.map((claim) => [claim.id, claim]));
  const accepted: Array<Assertion & { index: number }> = [];
  const rejected: Array<{ index: number; text?: string; reason: string }> = [];
  const reject = (index: number, item: unknown, reason: string) =>
    rejected.push({ index, ...(isRecord(item) && typeof item.text === "string" ? { text: item.text } : {}), reason });

  // Inferences last, so the observations they rest on are already checked.
  const order = list.map((item, index) => ({ item, index }))
    .sort((a, b) => Number(kindOf(a.item) === "analyst_inference") - Number(kindOf(b.item) === "analyst_inference"));
  let unchecked = 0;
  // Observations that passed every check they could take, with no figures to bind.
  const uncheckedObservations = new Set<number>();
  for (const { item, index } of order) {
    if (index >= MAX_ASSERTIONS) {
      reject(index, item, `more than ${MAX_ASSERTIONS} assertions`);
      continue;
    }
    if (!isRecord(item) || typeof item.text !== "string" || item.text.trim() === "") {
      reject(index, item, "not an assertion with text");
      continue;
    }
    const kind = kindOf(item);
    if (kind === undefined) {
      reject(index, item, `unknown kind ${JSON.stringify(item.kind)}`);
      continue;
    }
    // A malformed list is the model's error to report, never cleaned up. An
    // inference cites through its supports and a data gap cites nothing, so
    // their evidence may be left out.
    const listed = item.evidence === undefined && (kind === "analyst_inference" || kind === "data_gap") ? [] : item.evidence;
    if (!Array.isArray(listed) || !listed.every((id) => typeof id === "string")) {
      reject(index, item, "evidence is not a list of packet ids");
      continue;
    }
    if (item.supports !== undefined && kind !== "analyst_inference") {
      reject(index, item, "only an analyst inference lists supports");
      continue;
    }
    if (item.subject !== undefined && kind !== "analyst_inference") {
      reject(index, item, "only an analyst inference has a subject");
      continue;
    }
    if ((item.op !== undefined || item.result !== undefined) && kind !== "comparison") {
      reject(index, item, "only a comparison has an op and a result");
      continue;
    }
    if (item.supports !== undefined && (!Array.isArray(item.supports) || !item.supports.every((n) => Number.isInteger(n)))) {
      reject(index, item, "supports is not a list of assertion indexes");
      continue;
    }
    const evidence = listed as string[];
    const twice = evidence.find((id, i) => evidence.indexOf(id) !== i);
    if (twice !== undefined) {
      reject(index, item, `evidence lists ${JSON.stringify(twice)} twice`);
      continue;
    }
    const unknown = evidence.find((id) => !figures.has(id) && !claims.has(id));
    if (unknown !== undefined) {
      reject(index, item, `unknown evidence id ${JSON.stringify(unknown)}`);
      continue;
    }
    // An inference writes no digit at all, a period's included: the periods
    // are its supports', rendered from the packet beside it. A data gap
    // describes a missing period in words ("no prior-year revenue").
    if ((kind === "analyst_inference" || kind === "data_gap") && (/\p{N}/u.test(item.text) || AMOUNT_WORD.test(item.text))) {
      reject(index, item, kind === "data_gap" ? "a data gap writes no figure; it says in words what is not shown" : "an inference rests on its supports; it writes no figure");
      continue;
    }
    // Across companies a gap names none, as an inference: its words could rank
    // them ("AMD's margin is higher than NVDA's"). Whose data is missing is
    // the server's gap notes' to say.
    if (kind === "data_gap" && packet.companies.length > 1 &&
      packet.companies.some((company) => company.length > 1 && mentions(item.text as string, company))) {
      reject(index, item, "a data gap names no company; the gap notes do");
      continue;
    }
    if (kind === "data_gap") {
      const shape = shapeError(kind, evidence, [], []);
      if (shape) reject(index, item, shape);
      else accepted.push({ index, kind, text: item.text, evidence });
      continue;
    }
    // Across companies, who leads or trails is its comparisons' checked
    // result, rendered in its label; its words name none, so they cannot
    // contradict it ("AMD leads" beside a checked NVDA-highest, #288).
    // A one-letter ticker ("A") cannot be told from the article, as in the guard.
    if (kind === "analyst_inference" && packet.companies.length > 1 &&
      packet.companies.some((company) => company.length > 1 && mentions(item.text as string, company))) {
      reject(index, item, "an inference names no company; its subject does");
      continue;
    }
    const figureIds = evidence.filter((id) => figures.has(id));
    const claimIds = evidence.filter((id) => claims.has(id));
    // What figures show is not why: a cause is a cited claim's or unknown, on
    // an answer with figures or without (#294 review).
    if ((kind === "observation" || kind === "comparison") && statesCause(item.text)) {
      reject(index, item, `an ${kind === "observation" ? "observation" : "comparison"} states no cause: give it as a management attribution or an unknown cause`);
      continue;
    }
    // About figures when none were shown: nothing to bind, unless it cites a
    // claim where only figures may stand.
    if (packet.figures.length === 0 && kind !== "management_attribution") {
      if ((kind === "observation" || kind === "comparison" || kind === "unknown_cause") && claimIds.length > 0) {
        reject(index, item, shapeError(kind, [], claimIds, [])!);
      } else if (kind === "analyst_inference" && !restsOnObservations(item.supports, uncheckedObservations)) {
        reject(index, item, "an inference binds the accepted observations it rests on");
      } else {
        unchecked++;
        if (kind === "observation") uncheckedObservations.add(index);
      }
      continue;
    }
    // An inference stands on every support it lists: its words may be about
    // what a failed one said ("the recovery" beside a rejected trend, #310).
    const failed = ((item.supports ?? []) as number[]).find((n) => n < 0 || n >= list.length || rejected.some((entry) => entry.index === n));
    if (failed !== undefined) {
      reject(index, item, `an inference rests on every support it lists; ${failed} is not accepted`);
      continue;
    }
    // A management attribution may be listed beside them, unbound.
    const supports = ((item.supports ?? []) as number[]).filter((n) =>
      accepted.some((entry) => entry.index === n && (entry.kind === "observation" || entry.kind === "comparison"))
    );
    const shape = shapeError(kind, figureIds, claimIds, supports);
    if (shape) {
      reject(index, item, shape);
      continue;
    }
    // An unknown cause is a change's: each figure it cites has its company's
    // same metric in another period with a different value beside it.
    if (kind === "unknown_cause" && !showsChange(figureIds.map((id) => figures.get(id)!), packet.figures)) {
      reject(index, item, "an unknown cause cites a change: one company's metric, two periods, two values");
      continue;
    }
    // A metric the question asked for that no reader serves is a named gap: no
    // other figure stands in for it ("free cash flow" from net income).
    // Read with the question's own metric names, so "FCF" is free cash flow.
    // A management attribution cites its claim, never a figure, so a claim
    // about the missing metric may be attributed.
    const gap = kind === "management_attribution"
      ? undefined
      : requestedMetrics(item.text).find((metric) => packet.unavailable_metrics?.includes(metric.label))?.label;
    if (gap !== undefined) {
      reject(index, item, `${gap} is not in the evidence: it is a named gap`);
      continue;
    }
    // An inference's evidence is its own plus that of the observations it rests on.
    const cited = kind === "analyst_inference"
      ? [...evidence, ...accepted.filter((entry) => supports.includes(entry.index)).flatMap((entry) => entry.evidence)]
      : evidence;
    const binding = bindingError(kind, item.text, cited, packet, table);
    if (binding) {
      reject(index, item, binding);
      continue;
    }
    if (item.subject !== undefined &&
      (typeof item.subject !== "string" || !packet.companies.includes(item.subject) || !companiesOf(cited, packet).has(item.subject))) {
      reject(index, item, "an inference's subject is a company its evidence covers");
      continue;
    }
    // A comparison's claimed result is derived from its complete eligible
    // evidence before it may stand (comparisons.ts).
    const comparison = kind === "comparison" ? checkComparison(item, figureIds, packet) : undefined;
    if (comparison && "error" in comparison) {
      reject(index, item, comparison.error);
      continue;
    }
    accepted.push({
      index,
      kind,
      text: item.text,
      evidence,
      ...(kind === "analyst_inference" ? { supports, ...(item.subject !== undefined ? { subject: item.subject as string } : {}) } : {}),
      ...(kind === "comparison" ? { op: item.op as ComparisonOp, result: item.result as string | string[] } : {}),
    });
  }
  accepted.sort((a, b) => a.index - b.index);
  rejected.sort((a, b) => a.index - b.index);
  return { status: "checked", accepted, rejected, ...(unchecked > 0 ? { unchecked } : {}) };
}

// An amount in words: a number word, then a unit ("seventy percent", "a few
// billion dollars"). An inference states none. A count ("three companies") or
// a unit with no number ("per dollar of revenue") is not an amount.
const NUMBER_WORD = String.raw`(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|dozen|few|several|half)`;
const AMOUNT_UNIT = String.raw`(?:per ?cent|percent(?:age points?)?|basis points?|bps|points?|dollars?|cents?|euros?|pounds?|pence|yen|yuan|renminbi|francs?|rupees?|thousands?|millions?|billions?|trillions?)`;
// "a billion dollars": an article counts as a number only before a scale.
const AMOUNT_WORD = new RegExp(String.raw`\b(?:${NUMBER_WORD}(?:[- ]${NUMBER_WORD})*[- ]${AMOUNT_UNIT}|an? (?:hundred|thousand|million|billion|trillion))\b`, "i");

// An inference's supports, when the observations cannot be figure-checked:
// at least one observation that passed every check it could take.
function restsOnObservations(supports: unknown, observations: ReadonlySet<number>): boolean {
  return Array.isArray(supports) && supports.some((n) => observations.has(n as number));
}

// Every cited figure: the template says each cited metric changed. The
// other period may be any shown, so the figure that moved alone will do.
function showsChange(cited: ReadonlyArray<EvidencePacket["figures"][number]>, shown: EvidencePacket["figures"]): boolean {
  return cited.length > 0 && cited.every((a) => shown.some((b) =>
    a.company === b.company && a.metric === b.metric && a.segment === b.segment && a.period !== undefined && b.period !== undefined &&
    a.period.replace(/\s+/g, "") !== b.period.replace(/\s+/g, "") && a.value !== b.value
  ));
}

// What each kind must cite.
// ponytail: a management attribution needs a claim, not proof that the claim
// states that cause; that is judged by the held-out evaluation (#221).
function shapeError(
  kind: AssertionKind,
  figureIds: ReadonlyArray<string>,
  claimIds: ReadonlyArray<string>,
  // An inference's accepted observations and comparisons.
  supports: ReadonlyArray<number>,
): string | null {
  switch (kind) {
    case "observation":
      return figureIds.length === 0 || claimIds.length > 0 ? "an observation cites figures, and only figures" : null;
    case "comparison":
      return figureIds.length < 2 || claimIds.length > 0 ? "a comparison cites two or more figures, and only figures" : null;
    case "unknown_cause":
      return figureIds.length === 0 || claimIds.length > 0 ? "an unknown cause cites the figures that changed, and no claim" : null;
    case "management_attribution":
      return claimIds.length === 0 || figureIds.length > 0 ? "a management attribution cites the claim that makes it, and only claims" : null;
    case "analyst_inference":
      return supports.length === 0 ? "an inference binds the accepted observations it rests on" : null;
    case "data_gap":
      return figureIds.length > 0 || claimIds.length > 0 ? "a data gap cites nothing; it names what is not shown" : null;
  }
}

// The text names only what its evidence holds: each reference is one its
// evidence cites; any digit it typed itself is a period label of its
// evidence's years (prose-refs.ts), so a figure or a claim's number is written
// only as its reference, and a year from elsewhere in the turn is not this
// assertion's; and every company it names is its evidence's.
function bindingError(kind: AssertionKind, text: string, cited: ReadonlyArray<string>, packet: EvidencePacket, table: ReferenceTable): string | null {
  for (const [reference, id] of text.matchAll(REFERENCE)) {
    if (!table.references.has(id!)) return `unknown reference ${reference}`;
    if (!cited.includes(id!)) return `${reference} is not in its evidence`;
  }
  const figures = packet.figures.filter((figure) => cited.includes(figure.id));
  const claims = packet.claims.filter((claim) => cited.includes(claim.id));
  // An attribution renders its claim's quote, never its own text, so a token
  // the claim writes ("MI308", "$800", whole, not "$80" of it) may stand in
  // that text too.
  const quoted = new Set(kind === "management_attribution"
    ? claims.flatMap((claim) => typedDigits(claim.text, { years: new Set(), words: new Set(), companies: [] }))
    : []);
  const [typed] = typedDigits(text, { ...table, years: yearsOf(figures, claims) }).filter((token) => !quoted.has(token));
  if (typed !== undefined) return /^(?:FY)?\d{4}$/.test(typed) ? `${typed} is not a period of its evidence` : `types ${typed}; write its reference`;
  // A claim with no company is no company's (its record named none).
  if (claims.some((claim) => claim.company === undefined)) return null;
  const own = companiesOf(cited, packet);
  // A one-letter ticker ("A") cannot be told from the article, as in the guard.
  const other = packet.companies.find((company) => company.length > 1 && !own.has(company) && mentions(text, company));
  return other === undefined ? null : `names ${other}, which its evidence does not`;
}

// The companies cited figures and claims are about; a figure with no company
// is the only company's.
function companiesOf(cited: ReadonlyArray<string>, packet: EvidencePacket): Set<string | undefined> {
  return new Set([
    ...packet.figures.filter((figure) => cited.includes(figure.id)).map((figure) => figure.company ?? packet.companies[0]),
    ...packet.claims.filter((claim) => cited.includes(claim.id)).map((claim) => claim.company),
  ]);
}

function mentions(text: string, company: string): boolean {
  const escaped = company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9])${escaped}($|[^A-Za-z0-9])`).test(text);
}

function kindOf(item: unknown): AssertionKind | undefined {
  return isRecord(item) && ASSERTION_KINDS.includes(item.kind as AssertionKind) ? item.kind as AssertionKind : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Management's own explanations and guidance from earnings releases (#205: the
// analyst could only say "the data does not show why"). An 8-K Item 2.02
// ("Results of Operations") files the earnings release and CFO commentary as
// EX-99 exhibits. A model picks the sentences in which management explains a
// result ("...a $4.5 billion charge associated with H20 excess inventory") or
// gives guidance, and each one is kept only if it is a verbatim quote of the
// exhibit text: the stored claim is the document's own words, never the model's.
//
// A batch step like 8-K enrichment (sec-8k-enrichment.ts), never the atomic
// crawl: candidates are Item 2.02 claims (material_event.guidance_update) not
// yet processed, and enriched_at marks them processed. (High-severity
// enrichment reads other predicates, so the two never share a claim.)
//
// Each verified quote becomes a claim:
// - predicate management.explanation.<metric> or guidance.<metric>, metric from
//   a closed list;
// - text the exhibit's own sentence, modality "quoted", attributed to the
//   issuer, dated by the filing;
// - the fiscal period an explanation explains (#542), when the release's own
//   dates give it;
// - a claim_evidence row locating it (exhibit, character span, quote hash).
// Chat reads these as management attributions: the only causes an answer may
// state (llm-runtime.ts). A rebind binds explanations stored with no period
// (rebindRelease).

import { createHash } from "node:crypto";

import type { IsoDate } from "../../financial-core/src/contracts.ts";
import type { LlmChatMessage, LlmChatRequest, LlmRouterResult } from "../../llm/src/router.ts";
import { runLoggedToolCall, writeToolCallLog } from "../../observability/src/tool-call.ts";
import type { JsonObject } from "../../observability/src/types.ts";
import { createClaimArgument } from "./claim-argument-repo.ts";
import { createClaimEvidence } from "./claim-evidence-repo.ts";
import { createClaim, type ClaimPeriod } from "./claim-repo.ts";
import type { SecFilingFetcher } from "./sec-edgar.ts";
import { withTransaction } from "./transaction.ts";
import type { QueryExecutor } from "./types.ts";
import { isIsoDate } from "./validators.ts";

export const RELEASE_STATEMENT_KINDS = ["explanation", "guidance"] as const;
export type ReleaseStatementKind = (typeof RELEASE_STATEMENT_KINDS)[number];

// The period a statement is about, in the release's terms, and the claim period
// it binds to at the reported quarter's end. Only a fourth-quarter release has
// a "year" sentence; anything else (year to date, a prior period) binds none.
const PERIOD_KIND_OF = { quarter: "fiscal_q", year: "fiscal_y", other: null } as const;
export type ReleaseStatementAbout = keyof typeof PERIOD_KIND_OF;
const RELEASE_STATEMENT_ABOUTS = Object.keys(PERIOD_KIND_OF) as ReadonlyArray<ReleaseStatementAbout>;

// The metric a statement concerns. "other" keeps a real explanation whose
// subject is none of these (a segment, a product line).
export const RELEASE_METRICS = [
  "revenue",
  "gross_margin",
  "operating_expenses",
  "operating_income",
  "net_income",
  "eps",
  "operating_cash_flow",
  "free_cash_flow",
  "capex",
  "other",
] as const;
export type ReleaseMetric = (typeof RELEASE_METRICS)[number];

// The claim's confidence: the words are verified, their reading as an
// explanation or guidance is the model's (as for enriched 8-K narratives).
const RELEASE_CONFIDENCE = 0.8;
const MAX_STATEMENTS = 8;
const MIN_QUOTE_CHARS = 20;
const MAX_QUOTE_CHARS = 600;
// The release and the CFO commentary together run to ~40k characters.
const MAX_PROMPT_CHARS = 60_000;
// A release reports a quarter ended at most this long before it is filed. A
// later end is not yet reported, and an earlier one is a year-ago comparison.
const MAX_REPORT_LAG_DAYS = 92;
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
// A stored claim c the extractor treats as live: citable, and not superseded.
const CURRENT_CLAIM_SQL = "c.status in ('extracted', 'corroborated') and c.superseded_at is null";

export type ExtractReleaseLlm = { complete(request: LlmChatRequest): Promise<LlmRouterResult> };

export type ExtractReleaseDeps = {
  db: QueryExecutor;
  llm: ExtractReleaseLlm;
  secClient: SecFilingFetcher;
};

export type ReleaseCandidate = {
  claimId: string;
  accession: string;
  issuerCik: number;
  issuerId: string;
  documentId: string;
  sourceId: string;
  effectiveTime: string | null;
};

// An exhibit's text, and where its HTML blocks (paragraphs, list items, table
// cells, headings) start and end in it: a heading has no full stop, so a block
// edge is a sentence edge too.
export type ReleaseExhibit = { type: string; text: string; edges: ReadonlySet<number> };
export type ReleaseStatement = { kind: ReleaseStatementKind; metric: ReleaseMetric; about: ReleaseStatementAbout; quote: string };
export type VerifiedStatement = ReleaseStatement & { exhibit: string; start: number; end: number };
// One prompt's reply: the end of the quarter the release reports, as its text
// dates it, and the statements picked from it.
export type ReleaseReply = { quarterEnd: IsoDate | null; statements: ReleaseStatement[] };

// "extracted": at least one verified statement stored. "noop": a concurrent
// run already processed the claim.
export type ExtractReleaseOutcome = "extracted" | "empty" | "unparseable" | "no_exhibits" | "noop";

// Item 2.02 claims not yet processed, with what is needed to fetch the filing.
export async function findReleaseCandidates(
  db: QueryExecutor,
  opts: { afterClaimId?: string; limit?: number } = {},
): Promise<ReleaseCandidate[]> {
  const { rows } = await db.query<{
    claim_id: string;
    accession: string;
    cik: string;
    issuer_id: string;
    document_id: string;
    source_id: string;
    effective_time: Date | string | null;
  }>(
    `select distinct on (c.claim_id)
            c.claim_id::text as claim_id,
            d.provider_doc_id as accession,
            i.cik,
            ca.subject_id::text as issuer_id,
            c.document_id::text as document_id,
            c.reported_by_source_id::text as source_id,
            c.effective_time
       from claims c
       join claim_arguments ca on ca.claim_id = c.claim_id and ca.subject_kind = 'issuer'
       join documents d on d.document_id = c.document_id
       join issuers i on i.issuer_id = ca.subject_id
      where c.predicate = 'material_event.guidance_update'
        and c.enriched_at is null
        and i.cik is not null
        and c.claim_id > $1::uuid
      order by c.claim_id
      limit $2`,
    [opts.afterClaimId ?? ZERO_UUID, opts.limit ?? 100],
  );
  return rows.flatMap((row) => {
    const issuerCik = Number(row.cik);
    if (!Number.isInteger(issuerCik) || issuerCik <= 0) return [];
    return [{
      claimId: row.claim_id,
      accession: row.accession,
      issuerCik,
      issuerId: row.issuer_id,
      documentId: row.document_id,
      sourceId: row.source_id,
      effectiveTime: row.effective_time == null ? null : new Date(row.effective_time).toISOString(),
    }];
  });
}

// The EX-99 exhibits of a full EDGAR submission (.txt), each as plain text.
export function releaseExhibits(submission: string): ReleaseExhibit[] {
  const exhibits: ReleaseExhibit[] = [];
  for (const [, document] of submission.matchAll(/<DOCUMENT>([\s\S]*?)<\/DOCUMENT>/g)) {
    const type = /<TYPE>([^\n<]+)/.exec(document!)?.[1]?.trim() ?? "";
    if (!/^EX-99(?:\.\d+)?$/i.test(type)) continue;
    const body = /<TEXT>([\s\S]*)<\/TEXT>/.exec(document!)?.[1] ?? "";
    const blocks = (MARKUP.test(body) ? body.split(BLOCK_BREAK) : plainTextBlocks(body))
      .map(canonicalText)
      .filter((block) => block !== "");
    const edges = new Set<number>();
    let at = 0;
    for (const block of blocks) {
      edges.add(at);
      at += block.length;
      edges.add(at);
      at += 1; // the space joining blocks
    }
    const text = blocks.join(" ");
    if (text !== "") exhibits.push({ type: type.toUpperCase(), text, edges });
  }
  return exhibits;
}

// A closing block tag, or a line break (with any attributes).
const BLOCK_BREAK = /<(?:\/(?:div|p|li|tr|td|th|h[1-6]|table|ul|ol)\s*|br\b[^>]*)>/i;
const MARKUP = /<\/?(?:html|body|div|p|br|table|font|span)\b/i;

// A plain-text exhibit's blocks: its paragraphs (between blank lines), with a
// heading line ("OUTLOOK": letters, none lower-case) a block of its own. A
// sentence wrapped across lines stays one block. ponytail: a mixed-case
// heading line ("Outlook") is read as the start of its paragraph.
function plainTextBlocks(body: string): string[] {
  return body.replace(/\r\n?/g, "\n").split(/\n[ \t]*\n/).flatMap((paragraph) => {
    const blocks: string[] = [];
    let lines: string[] = [];
    for (const line of paragraph.split("\n")) {
      if (!/[A-Z]/.test(line) || /[a-z]/.test(line)) {
        lines.push(line);
        continue;
      }
      blocks.push(lines.join("\n"), line);
      lines = [];
    }
    return [...blocks, lines.join("\n")];
  });
}

// Exhibit HTML (or text) as comparable text: tags dropped, entities decoded,
// typographic quotes and dashes made plain, whitespace collapsed. Quotes are
// matched in this form, and stored from it.
export function canonicalText(markup: string): string {
  return plainPunctuation(decodeEntities(
    markup
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )).replace(/\s+/g, " ").trim();
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', mdash: "-", ndash: "-", hellip: "...",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }
    return NAMED_ENTITIES[name.toLowerCase()] ?? entity;
  });
}

function plainPunctuation(text: string): string {
  return text
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/ /g, " ");
}

// The model's reply, or null when it is not the expected shape. A malformed
// statement makes the whole reply unparseable, so the filing is read again
// rather than marked done without it. A quarter_end that is no date, or an
// about that is none of the three, only binds nothing: a date-format slip
// would otherwise cost the release its statements on every drain.
export function parseReleaseReply(text: string): ReleaseReply | null {
  const { quarter_end: quarterEnd, statements: items } = replyObject(text) ?? {};
  if (!Array.isArray(items)) return null;
  const statements: ReleaseStatement[] = [];
  for (const item of items.slice(0, MAX_STATEMENTS)) {
    const { kind, metric, about, quote } = (item ?? {}) as Record<string, unknown>;
    if (
      typeof quote !== "string" ||
      !(RELEASE_STATEMENT_KINDS as ReadonlyArray<unknown>).includes(kind) ||
      !(RELEASE_METRICS as ReadonlyArray<unknown>).includes(metric)
    ) {
      return null;
    }
    statements.push({ kind: kind as ReleaseStatementKind, metric: metric as ReleaseMetric, about: statementAbout(about), quote });
  }
  return { quarterEnd: isIsoDate(quarterEnd) ? quarterEnd : null, statements };
}

// A rebind reply: the quarter's end, and what each of `count` listed
// statements is about, by its number; null when the reply is no JSON object.
export function parseRebindReply(text: string, count: number): { quarterEnd: IsoDate | null; abouts: ReleaseStatementAbout[] } | null {
  const reply = replyObject(text);
  if (reply === null) return null;
  const abouts = isObject(reply.about) ? reply.about : {};
  return {
    quarterEnd: isIsoDate(reply.quarter_end) ? reply.quarter_end : null,
    abouts: Array.from({ length: count }, (_, n) => statementAbout(abouts[String(n + 1)])),
  };
}

// The JSON object in a model's reply, which may fence it; null if none.
function replyObject(text: string): Record<string, unknown> | null {
  try {
    const reply: unknown = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    return isObject(reply) ? reply : null;
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function statementAbout(about: unknown): ReleaseStatementAbout {
  return (RELEASE_STATEMENT_ABOUTS as ReadonlyArray<unknown>).includes(about) ? about as ReleaseStatementAbout : "other";
}

// Note one reading of what a sentence is about: readings that disagree leave
// it about none.
function noteAbout(abouts: Map<string, ReleaseStatementAbout | null>, sentence: string, about: ReleaseStatementAbout): void {
  const prior = abouts.get(sentence);
  abouts.set(sentence, prior === undefined || prior === about ? about : null);
}

// The end of the quarter a release reports: the one every prompt that names an
// end agrees on, before the filing date and at most MAX_REPORT_LAG_DAYS before
// it. Otherwise null, and no claim from the release is bound. A check on the
// model's reading, never a lookup: it can only unbind.
export function reportedQuarterEnd(ends: ReadonlyArray<IsoDate | null>, filedOn: IsoDate | null): IsoDate | null {
  const [end, ...others] = new Set(ends.filter((named) => named !== null));
  if (end === undefined || others.length > 0 || filedOn === null) return null;
  const lagDays = (Date.parse(filedOn) - Date.parse(end)) / 86_400_000;
  return lagDays > 0 && lagDays <= MAX_REPORT_LAG_DAYS ? end : null;
}

// The period an explanation explains: its quarter or, in a fourth-quarter
// release, its year, both ending at the reported quarter's end. Guidance, and
// anything about another period, explains none.
export function explainedPeriod(quarterEnd: IsoDate | null, statement: Pick<ReleaseStatement, "kind" | "about">): ClaimPeriod | null {
  const kind = PERIOD_KIND_OF[statement.about];
  return quarterEnd === null || kind === null || statement.kind !== "explanation" ? null : { kind, end: quarterEnd };
}

// A statement whose quote is in an exhibit, verbatim (in canonical form) and
// as whole sentences, with where it is; null for a quote the exhibits do not
// hold, a clause cut from a sentence ("decline due to weaker demand" out of
// "Revenue did not decline due to weaker demand"), or one too short or long.
// The stored text is the exhibit's, not the model's.
export function verifyStatement(statement: ReleaseStatement, exhibits: ReadonlyArray<ReleaseExhibit>): VerifiedStatement | null {
  const quote = canonicalText(statement.quote);
  if (quote.length < MIN_QUOTE_CHARS || quote.length > MAX_QUOTE_CHARS) return null;
  for (const exhibit of exhibits) {
    for (let start = exhibit.text.indexOf(quote); start >= 0; start = exhibit.text.indexOf(quote, start + 1)) {
      const end = start + quote.length;
      if (startsSentence(exhibit, start) && endsSentence(exhibit, end)) {
        return { ...statement, quote: exhibit.text.slice(start, end), exhibit: exhibit.type, start, end };
      }
    }
  }
  return null;
}

// What a sentence starts with: a capital, a figure, a quote, a bracket or a
// bullet. A full stop before anything else ("the U.S. due to") is an
// abbreviation's. ponytail: a sentence opening lower-case ("iPhone revenue")
// counts only at a block edge.
const SENTENCE_START = /^["'($•[0-9A-Z]/;

// A block ending in a colon, semicolon, comma or dash, or in a word that joins
// it to more ("but", "and", "of"), runs on into the next ("This is not company
// guidance -", "due to stronger demand,", "This is not company guidance but"):
// no sentence ends at it, or starts after it.
const CONTINUES = /(?:[:;,-]|\b(?:and|but|or|nor|yet|so|while|whereas|although|though|because|as|than|that|which|with|without|of|to|for|from|in|on|at|by|the|a|an))\s*$/i;

// Whether a block edge (the block before ending at `before`, the next starting
// at `after`) is between sentences: not after a block that runs on, nor before
// one that starts as no sentence does ("... guidance but" / "revenue is ...").
function blockBreak(text: string, before: number, after: number): boolean {
  return !CONTINUES.test(text.slice(Math.max(0, before - 16), before)) &&
    (after >= text.length || SENTENCE_START.test(text.slice(after)));
}

// An abbreviation's full stop, which ends no sentence even before a capital
// ("the U.S. Data Center market"): initials ("U.S.", "e.g.", "J.") or a word
// shortened by convention ("Inc.", "approx.", "Dec."). ponytail: a sentence that ends
// in one ("...sales in the U.S.") counts only at a block edge.
const INITIALS = /(?:^|[\s("'])(?:(?:[A-Za-z]\.){2,}|[A-Z]\.)$/;
const SHORTENED = /(?:^|[\s("'])(?:inc|corp|co|ltd|no|nos|approx|vs|mr|ms|dr|jr|sr|st|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\.$/i;

// Whether the text before `at` ends a sentence with one of `marks` (and a
// closing quote or bracket), not with an abbreviation's full stop.
function endMarkBefore(text: string, at: number, marks: RegExp): boolean {
  const head = text.slice(Math.max(0, at - 16), at);
  if (!marks.test(head)) return false;
  const stop = head.replace(/["')]$/, "");
  return !(stop.endsWith(".") && (INITIALS.test(stop) || SHORTENED.test(stop)));
}

// A sentence starts where a block starts, or after a sentence's end (a full
// stop, question or exclamation mark, or a bullet) with what a sentence starts
// with. Not after a colon or semicolon: what follows one is part of a sentence
// ("This is not company guidance: Revenue is expected to...").
function startsSentence(exhibit: ReleaseExhibit, start: number): boolean {
  if (exhibit.edges.has(start)) return start === 0 || blockBreak(exhibit.text, start, start);
  return /\s/.test(exhibit.text[start - 1] ?? "") &&
    endMarkBefore(exhibit.text, start - 1, /[.!?•]["')]?$/) &&
    SENTENCE_START.test(exhibit.text.slice(start));
}

// A sentence ends where a block ends, or with its own end mark (and a closing
// quote or bracket), at the end of the text or before the next sentence.
function endsSentence(exhibit: ReleaseExhibit, end: number): boolean {
  if (exhibit.edges.has(end)) return blockBreak(exhibit.text, end, end + 1);
  if (!endMarkBefore(exhibit.text, end, /[.!?]["')]?$/)) return false;
  return end === exhibit.text.length || (exhibit.text[end] === " " && SENTENCE_START.test(exhibit.text.slice(end + 1)));
}

// The exhibits as prompts of at most MAX_PROMPT_CHARS each, so a long release
// is read whole across several calls rather than losing its tail. An exhibit
// longer than one is split between blocks, or sentences (ponytail: a single
// sentence longer than a prompt is cut where the prompt ends).
export function releasePrompts(exhibits: ReadonlyArray<ReleaseExhibit>): string[] {
  const pieces = exhibits.flatMap((exhibit) => {
    const label = `[${exhibit.type}]\n`;
    const budget = MAX_PROMPT_CHARS - label.length;
    const edges = [...exhibit.edges].sort((a, b) => a - b);
    const parts: string[] = [];
    for (let from = 0; from < exhibit.text.length;) {
      let to = Math.min(exhibit.text.length, from + budget);
      if (to < exhibit.text.length) {
        // Between blocks; else, in one block longer than a prompt, after the
        // last sentence that ends within it.
        const edge = edges.findLast((at) => at > from && at <= to && endsSentence(exhibit, at));
        if (edge !== undefined) to = edge;
        else for (let at = to; at > from; at--) if (endsSentence(exhibit, at)) { to = at; break; }
      }
      parts.push(label + exhibit.text.slice(from, to).trim());
      from = to;
    }
    return parts;
  });
  const prompts: string[] = [];
  for (const piece of pieces) {
    const last = prompts.length - 1;
    if (last >= 0 && prompts[last]!.length + 2 + piece.length <= MAX_PROMPT_CHARS) prompts[last] += `\n\n${piece}`;
    else prompts.push(piece);
  }
  return prompts;
}

// How a reply names the release's quarter and what a statement is about, in
// the extraction prompt and the rebind prompt alike.
const QUARTER_END_RULE = [
  "quarter_end is the last day of the quarter whose results the release reports, as the release's own dated headings or tables give it",
  '("three months ended June 28, 2025" gives 2025-06-28). It is null when the text gives no such date.',
];
const ABOUT_RULE = [
  'about is the period a statement is about: "quarter" for that quarter\'s result; "year" for the fiscal year that quarter ends,',
  'which only a fourth-quarter release reports; "other" for anything else, such as year to date or a prior period. Guidance is always "other".',
  'If a statement does not make clear whether it is about the quarter or the year, use "other".',
];

function buildMessages(text: string): LlmChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "You read a company's earnings release and CFO commentary from an SEC 8-K, and pick the sentences in which",
        "management (1) explains why a reported result changed, or (2) gives guidance for a coming period.",
        'Reply with minified JSON only: {"quarter_end":"<YYYY-MM-DD>"|null,"statements":[{"kind":"explanation"|"guidance","metric":"<metric>","about":"quarter"|"year"|"other","quote":"<sentence>"}]}',
        ...QUARTER_END_RULE,
        `metric is one of: ${RELEASE_METRICS.join(", ")} (other when the subject is none of these).`,
        ...ABOUT_RULE,
        "quote is copied EXACTLY from the text, character for character: one or two whole sentences, no paraphrase,",
        "no ellipsis, nothing added. A quote that is not in the text is discarded.",
        "An explanation names a cause (a charge, a product, a mix shift, pricing, a ramp), not just the figure.",
        "Skip boilerplate: forward-looking-statement disclaimers, non-GAAP definitions, table rows.",
        `At most ${MAX_STATEMENTS} statements, the most informative first. If there are none, reply with "statements":[] and quarter_end as above.`,
      ].join("\n"),
    },
    { role: "user", content: text },
  ];
}

function buildRebindMessages(text: string, statements: ReadonlyArray<string>): LlmChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "You read a company's earnings release and CFO commentary from an SEC 8-K, and a numbered list of statements quoted from it",
        "in which management explains why a reported result changed.",
        'Reply with minified JSON only: {"quarter_end":"<YYYY-MM-DD>"|null,"about":{"<number>":"quarter"|"year"|"other"}}, with an about for each listed statement.',
        ...QUARTER_END_RULE,
        ...ABOUT_RULE,
      ].join("\n"),
    },
    { role: "user", content: `Statements:\n${statements.map((statement, n) => `${n + 1}. ${statement}`).join("\n") || "none"}\n\n${text}` },
  ];
}

// A filing's EX-99 exhibits, fetched from EDGAR.
async function fetchReleaseExhibits(secClient: SecFilingFetcher, cik: number, accession: string): Promise<ReleaseExhibit[]> {
  const fetched = await secClient.fetchFiling({ cik, accession_number: accession, document: `${accession}.txt` });
  return releaseExhibits(new TextDecoder("utf-8").decode(fetched.bytes));
}

// One model call, recorded for audit, a failed one too (as digests: that it
// ran, not what it said). Low reasoning: it picks sentences, and the quote
// check does the rest; a large model's default reasoning took 4 minutes on one
// release in a probe.
async function completeLogged(deps: ExtractReleaseDeps, toolName: string, args: JsonObject, messages: LlmChatMessage[]): Promise<{ model: string; text: string }> {
  return runLoggedToolCall(deps.db, {
    tool_name: toolName,
    args,
    invoke: async () => {
      const reply = await deps.llm.complete({ messages, temperature: 0, maxTokens: 3_000, reasoning: "low" });
      return { model: reply.deployment.model, text: reply.text };
    },
  });
}

// Extract one candidate's statements and store the verified ones. Transport
// errors propagate, so a drain fails-and-retries the item later. The stored
// claims, the enriched_at stamp and the audit row are one transaction, and the
// stamp is rowCount-guarded: a concurrent run makes this one a "noop".
export async function extractReleaseStatements(
  deps: ExtractReleaseDeps,
  candidate: ReleaseCandidate,
): Promise<ExtractReleaseOutcome> {
  const exhibits = await fetchReleaseExhibits(deps.secClient, candidate.issuerCik, candidate.accession);
  let model: string | null = null;
  // Every prompt is read.
  const proposed: ReleaseStatement[] = [];
  const ends: Array<IsoDate | null> = [];
  let unparseable = false;
  const prompts = releasePrompts(exhibits);
  for (const [index, prompt] of prompts.entries()) {
    const completion = await completeLogged(
      deps,
      "extract_earnings_release.prompt",
      { claim_id: candidate.claimId, accession: candidate.accession, prompt: index + 1, prompts: prompts.length },
      buildMessages(prompt),
    );
    model = completion.model;
    const reply = parseReleaseReply(completion.text);
    // A prompt none of whose quotes is in the filing has its text unread, as
    // one answered badly does, whatever the others found.
    if (reply === null || (reply.statements.length > 0 && !reply.statements.some((statement) => verifyStatement(statement, exhibits)))) {
      unparseable = true;
    }
    proposed.push(...(reply?.statements ?? []));
    ends.push(reply?.quarterEnd ?? null);
  }
  const quarterEnd = reportedQuarterEnd(ends, candidate.effectiveTime?.slice(0, 10) ?? null);
  // A claim is its natural key: the document, predicate and sentence. A
  // sentence picked twice for the same metric is one claim; for two metrics, a
  // claim for each. Its period is the sentence's: explanation picks of it that
  // disagree on what it is about bind none of its claims.
  const found = proposed.flatMap((statement) => verifyStatement(statement, exhibits) ?? []);
  const abouts = new Map<string, ReleaseStatementAbout | null>();
  for (const pick of found) if (pick.kind === "explanation") noteAbout(abouts, pick.quote, pick.about);
  const verified = new Map<string, VerifiedStatement & { predicate: string; period: ClaimPeriod | null }>();
  for (const pick of found) {
    const predicate = `${pick.kind === "explanation" ? "management.explanation" : "guidance"}.${pick.metric}`;
    const key = JSON.stringify([predicate, pick.quote]);
    if (verified.has(key)) continue;
    const period = explainedPeriod(quarterEnd, { kind: pick.kind, about: abouts.get(pick.quote) ?? "other" });
    verified.set(key, { ...pick, predicate, period });
  }
  // A prompt answered badly, or with no quote that is in the filing, leaves its
  // text unread: nothing is stored or stamped, so the next drain reads the
  // filing again (as after a transport error); the attempt is still recorded
  // for audit. Only replies of no statements make it "empty". ponytail: one the
  // model always answers badly is retried every run.
  if (unparseable) {
    await writeToolCallLog(deps.db, {
      tool_name: "extract_earnings_release",
      args: { claim_id: candidate.claimId, accession: candidate.accession, model },
      result: { outcome: "unparseable", exhibits: exhibits.map((exhibit) => exhibit.type), proposed: proposed.length },
      status: "partial",
    });
    return "unparseable";
  }
  const outcome: ExtractReleaseOutcome = exhibits.length === 0
    ? "no_exhibits"
    : verified.size > 0
    ? "extracted"
    : "empty";

  let applied = false;
  await withTransaction(deps.db, async (tx) => {
    const stamped = await tx.db.query(
      `update claims set enriched_at = now() where claim_id = $1 and enriched_at is null`,
      [candidate.claimId],
    );
    if ((stamped.rowCount ?? 0) === 0) return;
    applied = true;
    // Another Item 2.02 claim of the same document, read at once, waits here
    // until this one commits, so its lookups below see the claims stored now.
    await tx.db.query(`select 1 from documents where document_id = $1 for no key update`, [candidate.documentId]);
    const claimIds: string[] = [];
    for (const statement of verified.values()) {
      const { rows: existing } = await tx.db.query<{ claim_id: string }>(
        `select c.claim_id::text as claim_id from claims c
          where c.document_id = $1 and c.predicate = $2 and c.text_canonical = $3 and ${CURRENT_CLAIM_SQL}`,
        [candidate.documentId, statement.predicate, statement.quote],
      );
      // Stored by an earlier read of the document (another of its Item 2.02
      // claims): its period is filled if unbound, bound now and never
      // backdated, and its id stays, so citations of it do.
      if (existing.length > 0) {
        if (statement.period) {
          await tx.db.query(
            `update claims set period_kind = $2, period_end = $3::date, period_bound_at = now()
              where claim_id = any($1::uuid[]) and period_end is null`,
            [existing.map((row) => row.claim_id), statement.period.kind, statement.period.end],
          );
        }
        claimIds.push(...existing.map((row) => row.claim_id));
        continue;
      }
      const claim = await createClaim(tx.db, {
        document_id: candidate.documentId,
        predicate: statement.predicate,
        text_canonical: statement.quote,
        polarity: "neutral",
        modality: "quoted",
        reported_by_source_id: candidate.sourceId,
        attributed_to_type: "issuer",
        attributed_to_id: candidate.issuerId,
        effective_time: candidate.effectiveTime,
        confidence: RELEASE_CONFIDENCE,
        status: "extracted",
        period: statement.period,
      });
      await createClaimArgument(tx.db, { claim_id: claim.claim_id, subject_kind: "issuer", subject_id: candidate.issuerId, role: "subject" });
      await createClaimEvidence(tx.db, {
        claim_id: claim.claim_id,
        document_id: candidate.documentId,
        locator: { exhibit: statement.exhibit, start: statement.start, end: statement.end, text_basis: "sec_exhibit_canonical_text.v1" },
        excerpt_hash: createHash("sha256").update(statement.quote).digest("hex"),
        confidence: 1,
      });
      claimIds.push(claim.claim_id);
    }
    // An audit row, as for 8-K enrichment: tool_call_logs stores digests of
    // args and result, so it records that the call ran, not what it said.
    await writeToolCallLog(tx.db, {
      tool_name: "extract_earnings_release",
      args: { claim_id: candidate.claimId, accession: candidate.accession, model },
      result: {
        outcome,
        exhibits: exhibits.map((exhibit) => exhibit.type),
        proposed: proposed.length,
        verified: verified.size,
        quarter_end: quarterEnd,
        claim_ids: claimIds,
      },
      status: outcome === "extracted" ? "ok" : "skipped",
    });
  });
  return applied ? outcome : "noop";
}

export type ExtractReleaseDrainResult = Record<ExtractReleaseOutcome | "failed", number>;

// Drain the backlog by a claim_id keyset, advancing past failures so one bad
// filing never blocks the rest; a failed claim stays a candidate for next time.
export async function runReleaseExtractionDrain(
  deps: ExtractReleaseDeps,
  opts: { pageSize?: number; onClaim?: (candidate: ReleaseCandidate, result: ExtractReleaseOutcome | { error: unknown }) => void } = {},
): Promise<ExtractReleaseDrainResult> {
  const result: ExtractReleaseDrainResult = { extracted: 0, empty: 0, unparseable: 0, no_exhibits: 0, noop: 0, failed: 0 };
  let cursor = ZERO_UUID;
  for (;;) {
    const page = await findReleaseCandidates(deps.db, { afterClaimId: cursor, limit: opts.pageSize ?? 100 });
    if (page.length === 0) break;
    for (const candidate of page) {
      cursor = candidate.claimId;
      try {
        const outcome = await extractReleaseStatements(deps, candidate);
        result[outcome] += 1;
        opts.onClaim?.(candidate, outcome);
      } catch (error) {
        result.failed += 1;
        opts.onClaim?.(candidate, { error });
      }
    }
  }
  return result;
}

// A release read before #542, or by a reply with no usable quarter end, holds
// explanations bound to no period. A rebind reads it again and asks only for
// the quarter's end and what each of those stored sentences is about, then
// fills their periods in place: never a new claim, so citations of them stay.
// Each explanation a rebind reads is stamped enriched_at (unused on these
// claims otherwise), bound or not, so a release is read once even if it can
// never bind; clearRebindMarks makes the unbound ones candidates again.
export type RebindCandidate = {
  documentId: string;
  accession: string;
  issuerCik: number;
  effectiveTime: string | null;
  // The release's current explanation sentences, unbound and not yet read by
  // a rebind.
  sentences: string[];
};

// "bound": at least one claim bound. "unbound": read, none bound (no quarter
// end, or no statement about the quarter or the year). "unparseable": a reply
// that is no JSON object, so the release is left for the next rebind. "noop": a
// concurrent rebind already read it.
export type RebindOutcome = "bound" | "unbound" | "unparseable" | "noop";
export type RebindDrainResult = Record<RebindOutcome | "failed", number>;

export async function findRebindCandidates(
  db: QueryExecutor,
  opts: { afterDocumentId?: string; limit?: number } = {},
): Promise<RebindCandidate[]> {
  const { rows } = await db.query<{
    document_id: string;
    accession: string;
    cik: string;
    effective_time: Date | string | null;
    sentences: string[];
  }>(
    `select c.document_id::text as document_id,
            d.provider_doc_id as accession,
            i.cik,
            min(c.effective_time) as effective_time,
            array_agg(distinct c.text_canonical order by c.text_canonical) as sentences
       from claims c
       join claim_arguments ca on ca.claim_id = c.claim_id and ca.subject_kind = 'issuer'
       join documents d on d.document_id = c.document_id
       join issuers i on i.issuer_id = ca.subject_id
      where c.predicate like 'management.explanation.%'
        and ${CURRENT_CLAIM_SQL}
        and c.period_end is null
        and c.enriched_at is null
        and i.cik is not null
        and c.document_id > $1::uuid
      group by c.document_id, d.provider_doc_id, i.cik
      order by c.document_id
      limit $2`,
    [opts.afterDocumentId ?? ZERO_UUID, opts.limit ?? 100],
  );
  return rows.flatMap((row) => {
    const issuerCik = Number(row.cik);
    if (!Number.isInteger(issuerCik) || issuerCik <= 0) return [];
    return [{
      documentId: row.document_id,
      accession: row.accession,
      issuerCik,
      effectiveTime: row.effective_time == null ? null : new Date(row.effective_time).toISOString(),
      sentences: row.sentences,
    }];
  });
}

// Rebind one release. Each prompt lists the stored sentences its text holds,
// so each is read in context; its quarter's end and the sentences' periods
// follow the extraction's rules (reportedQuarterEnd, explainedPeriod, and
// readings of a sentence that disagree bind it to none). Transport errors
// propagate, so a drain fails-and-retries the release later. The periods and
// the marks are one update, guarded by the marks: a concurrent rebind makes
// this one a "noop".
export async function rebindRelease(deps: ExtractReleaseDeps, candidate: RebindCandidate): Promise<RebindOutcome> {
  const exhibits = await fetchReleaseExhibits(deps.secClient, candidate.issuerCik, candidate.accession);
  const prompts = releasePrompts(exhibits);
  let model: string | null = null;
  const ends: Array<IsoDate | null> = [];
  const abouts = new Map<string, ReleaseStatementAbout | null>();
  let unparseable = false;
  for (const [index, prompt] of prompts.entries()) {
    const listed = candidate.sentences.filter((sentence) => prompt.includes(sentence));
    const completion = await completeLogged(
      deps,
      "rebind_earnings_release.prompt",
      { document_id: candidate.documentId, accession: candidate.accession, prompt: index + 1, prompts: prompts.length },
      buildRebindMessages(prompt, listed),
    );
    model = completion.model;
    const reply = parseRebindReply(completion.text, listed.length);
    if (reply === null) {
      unparseable = true;
      continue;
    }
    ends.push(reply.quarterEnd);
    listed.forEach((sentence, n) => noteAbout(abouts, sentence, reply.abouts[n]!));
  }
  const args = { document_id: candidate.documentId, accession: candidate.accession, model };
  if (unparseable) {
    await writeToolCallLog(deps.db, { tool_name: "rebind_earnings_release", args, result: { outcome: "unparseable" }, status: "partial" });
    return "unparseable";
  }
  const quarterEnd = reportedQuarterEnd(ends, candidate.effectiveTime?.slice(0, 10) ?? null);
  const periods = candidate.sentences.map((sentence) => explainedPeriod(quarterEnd, { kind: "explanation", about: abouts.get(sentence) ?? "other" }));
  return withTransaction(deps.db, async (tx) => {
    const { rows } = await tx.db.query<{ claim_id: string; bound: boolean }>(
      `update claims c
          set enriched_at = now(),
              period_kind = l.kind,
              period_end = l.end_date,
              period_bound_at = case when l.kind is null then null else now() end
         from unnest($2::text[], $3::text[], $4::date[]) as l(sentence, kind, end_date)
        where c.document_id = $1
          and c.text_canonical = l.sentence
          and c.predicate like 'management.explanation.%'
          and ${CURRENT_CLAIM_SQL}
          and c.period_end is null
          and c.enriched_at is null
      returning c.claim_id::text as claim_id, c.period_end is not null as bound`,
      [candidate.documentId, candidate.sentences, periods.map((period) => period?.kind ?? null), periods.map((period) => period?.end ?? null)],
    );
    if (rows.length === 0) return "noop";
    const outcome = rows.some((row) => row.bound) ? "bound" : "unbound";
    await writeToolCallLog(tx.db, {
      tool_name: "rebind_earnings_release",
      args,
      result: { outcome, quarter_end: quarterEnd, claim_ids: rows.map((row) => row.claim_id), bound: rows.filter((row) => row.bound).length },
      status: outcome === "bound" ? "ok" : "skipped",
    });
    return outcome;
  });
}

// Drain the rebind backlog by a document_id keyset, as the extraction drain
// does, reading at most `limit` releases.
export async function runRebindDrain(
  deps: ExtractReleaseDeps,
  opts: { limit?: number; pageSize?: number; onRelease?: (candidate: RebindCandidate, result: RebindOutcome | { error: unknown }) => void } = {},
): Promise<RebindDrainResult> {
  const result: RebindDrainResult = { bound: 0, unbound: 0, unparseable: 0, noop: 0, failed: 0 };
  let cursor = ZERO_UUID;
  for (let left = opts.limit ?? Infinity; left > 0;) {
    const page = await findRebindCandidates(deps.db, { afterDocumentId: cursor, limit: Math.min(opts.pageSize ?? 100, left) });
    if (page.length === 0) break;
    for (const candidate of page) {
      cursor = candidate.documentId;
      left -= 1;
      try {
        const outcome = await rebindRelease(deps, candidate);
        result[outcome] += 1;
        opts.onRelease?.(candidate, outcome);
      } catch (error) {
        result.failed += 1;
        opts.onRelease?.(candidate, { error });
      }
    }
  }
  return result;
}

// Clear the marks on current explanations a rebind read but could not bind, so
// the next rebind reads them again (--rebind --retry), as after a prompt
// change. Returns how many.
export async function clearRebindMarks(db: QueryExecutor): Promise<number> {
  const { rowCount } = await db.query(
    `update claims c set enriched_at = null
      where c.predicate like 'management.explanation.%'
        and ${CURRENT_CLAIM_SQL}
        and c.period_end is null
        and c.enriched_at is not null`,
  );
  return rowCount ?? 0;
}

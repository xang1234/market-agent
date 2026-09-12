import type { EvidencePacket } from "./ports.ts";
import type { AnalystOutput, Brief, Citation, CriterionOutcome, Dimension, RawCitation, SkepticOutput } from "./types.ts";

const MAX_RESPONSE_CHARS = 100_000;
const MAX_TEXT_CHARS = 2_000;
const MAX_CITATIONS = 12;
const MAX_QUESTIONS = 8;
const MAX_COUNTERARGUMENTS = 8;
const MAX_NUMERIC_TOKENS = 1_000;
const MAX_ABSOLUTE_EXPONENT = 10_000;
const CALENDAR_DATE_TOKEN = /(?<![A-Za-z0-9.,+-])\d{4}-\d{1,2}-\d{1,2}(?=$|[Tt]|[^A-Za-z0-9,.]|\.(?!\d))/gu;
const NUMERIC_CANDIDATE = /(?<![A-Za-z0-9.,+-])[+-]?(?:\d(?:[\d,.]*\d)?|\.\d+(?:[\d,.]*\d)?)(?:[eE][+-]?\d*)?(?![A-Za-z0-9])/gu;
const NUMERIC_LITERAL = /^([+-]?)(?:(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?|\.(\d+))(?:[eE]([+-]?\d+))?$/u;

type RawRole = AnalystOutput<RawCitation> | SkepticOutput<RawCitation>;

export function validateAnalystOutput(value: unknown, brief: Brief, packet: EvidencePacket): AnalystOutput<RawCitation> {
  const record = roleRecord(value, "Analyst output", false);
  return Object.freeze({
    exposure: parseDimension(record.exposure, "Analyst output.exposure", packet),
    business_quality: parseDimension(record.business_quality, "Analyst output.business_quality", packet),
    valuation_context: parseDimension(record.valuation_context, "Analyst output.valuation_context", packet),
    criteria: parseCriteria(record.criteria, "Analyst output.criteria", brief, packet),
    unresolved_questions: parseQuestions(record.unresolved_questions, "Analyst output.unresolved_questions"),
    next_action: text(record.next_action, "Analyst output.next_action", 1, MAX_TEXT_CHARS),
  });
}

export function validateSkepticOutput(value: unknown, brief: Brief, packet: EvidencePacket): SkepticOutput<RawCitation> {
  const record = roleRecord(value, "Skeptic output", true);
  return Object.freeze({
    exposure: parseDimension(record.exposure, "Skeptic output.exposure", packet),
    business_quality: parseDimension(record.business_quality, "Skeptic output.business_quality", packet),
    valuation_context: parseDimension(record.valuation_context, "Skeptic output.valuation_context", packet),
    criteria: parseCriteria(record.criteria, "Skeptic output.criteria", brief, packet),
    counterarguments: parseCounterarguments(record.counterarguments, packet),
    unresolved_questions: parseQuestions(record.unresolved_questions, "Skeptic output.unresolved_questions"),
    next_action: text(record.next_action, "Skeptic output.next_action", 1, MAX_TEXT_CHARS),
  });
}

export function citationMapKey(citation: RawCitation): string {
  return citation.kind === "excerpt"
    ? `excerpt:${citation.id}:${citation.quote}`
    : `${citation.kind}:${citation.id}`;
}

export function normalizeRoleCitations<T extends RawRole>(role: T, citations: ReadonlyMap<string, Citation>): T extends SkepticOutput<RawCitation> ? SkepticOutput<Citation> : AnalystOutput<Citation> {
  const normalize = (citation: RawCitation): Citation => {
    if (citation.kind !== "excerpt") return citation;
    const replacement = citations.get(citationMapKey(citation));
    if (replacement === undefined) throw new Error("excerpt citation has no persisted quote claim");
    return replacement;
  };
  const dimension = (value: Dimension<RawCitation>): Dimension<Citation> => ({ ...value, citations: value.citations.map(normalize) });
  const criterion = (value: CriterionOutcome<RawCitation>): CriterionOutcome<Citation> => ({ ...value, citations: value.citations.map(normalize) });
  const normalized = {
    ...role,
    exposure: dimension(role.exposure),
    business_quality: dimension(role.business_quality),
    valuation_context: dimension(role.valuation_context),
    criteria: role.criteria.map(criterion),
    ...(isSkeptic(role) ? { counterarguments: role.counterarguments.map((item) => ({ ...item, citations: item.citations.map(normalize) })) } : {}),
  };
  return normalized as unknown as T extends SkepticOutput<RawCitation> ? SkepticOutput<Citation> : AnalystOutput<Citation>;
}

function roleRecord(value: unknown, label: string, skeptic: boolean): Record<string, unknown> {
  if (typeof value === "string" && value.length > MAX_RESPONSE_CHARS) throw new Error(`${label} exceeds the response size limit`);
  const record = object(value, label);
  const allowed = skeptic
    ? ["exposure", "business_quality", "valuation_context", "criteria", "counterarguments", "unresolved_questions", "next_action"]
    : ["exposure", "business_quality", "valuation_context", "criteria", "unresolved_questions", "next_action"];
  rejectUnknown(record, allowed, label);
  for (const key of allowed) if (!(key in record)) throw new Error(`${label}.${key} is required`);
  return record;
}

function parseDimension(value: unknown, label: string, packet: EvidencePacket): Dimension<RawCitation> {
  const record = object(value, label);
  rejectUnknown(record, ["level", "explanation", "citations"], label);
  if (record.level !== "strong" && record.level !== "mixed" && record.level !== "weak" && record.level !== "unknown") {
    throw new Error(`${label}.level is invalid`);
  }
  const citations = parseCitations(record.citations, `${label}.citations`, packet);
  if (record.level !== "unknown" && citations.length === 0) throw new Error(`${label} requires evidence citations`);
  const explanation = text(record.explanation, `${label}.explanation`, 1, MAX_TEXT_CHARS);
  assertNumbersSupported(explanation, citations, packet, `${label}.explanation`);
  return Object.freeze({ level: record.level, explanation, citations });
}

function parseCriteria(value: unknown, label: string, brief: Brief, packet: EvidencePacket): CriterionOutcome<RawCitation>[] {
  if (!Array.isArray(value) || value.length !== brief.criteria.length) throw new Error(`${label} must return every criterion exactly once`);
  const expected = new Set(brief.criteria.map((criterion) => criterion.criterion_id));
  const seen = new Set<string>();
  return value.map((item, index) => {
    const itemLabel = `${label}[${index}]`;
    const record = object(item, itemLabel);
    rejectUnknown(record, ["criterion_id", "outcome", "explanation", "citations"], itemLabel);
    if (typeof record.criterion_id !== "string" || !expected.has(record.criterion_id) || seen.has(record.criterion_id)) {
      throw new Error(`${itemLabel}.criterion_id is missing, unsupported, or duplicated`);
    }
    seen.add(record.criterion_id);
    if (record.outcome !== "pass" && record.outcome !== "fail" && record.outcome !== "unknown") throw new Error(`${itemLabel}.outcome is invalid`);
    const citations = parseCitations(record.citations, `${itemLabel}.citations`, packet);
    if (record.outcome !== "unknown" && citations.length === 0) throw new Error(`${itemLabel} requires evidence citations`);
    const explanation = text(record.explanation, `${itemLabel}.explanation`, 1, MAX_TEXT_CHARS);
    assertNumbersSupported(explanation, citations, packet, `${itemLabel}.explanation`);
    return Object.freeze({ criterion_id: record.criterion_id, outcome: record.outcome, explanation, citations });
  });
}

function parseCounterarguments(value: unknown, packet: EvidencePacket): SkepticOutput<RawCitation>["counterarguments"] {
  if (!Array.isArray(value) || value.length > MAX_COUNTERARGUMENTS) throw new Error("Skeptic output.counterarguments is invalid");
  return value.map((item, index) => {
    const label = `Skeptic output.counterarguments[${index}]`;
    const record = object(item, label);
    rejectUnknown(record, ["text", "citations"], label);
    const citations = parseCitations(record.citations, `${label}.citations`, packet);
    if (citations.length === 0) throw new Error(`${label} requires evidence citations`);
    const content = text(record.text, `${label}.text`, 1, MAX_TEXT_CHARS);
    assertNumbersSupported(content, citations, packet, `${label}.text`);
    return Object.freeze({ text: content, citations });
  });
}

function parseQuestions(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_QUESTIONS) throw new Error(`${label} is invalid`);
  return value.map((item, index) => text(item, `${label}[${index}]`, 1, 500));
}

function parseCitations(value: unknown, label: string, packet: EvidencePacket): RawCitation[] {
  if (!Array.isArray(value) || value.length > MAX_CITATIONS) throw new Error(`${label} is invalid`);
  const claims = new Set(packet.claims.map((claim) => claim.claim_id));
  const facts = new Set(packet.facts.map((fact) => fact.fact_id));
  const excerpts = new Map(packet.excerpts.map((excerpt) => [excerpt.excerpt_id, excerpt]));
  const seen = new Set<string>();
  return value.map((item, index) => {
    const citationLabel = `${label}[${index}]`;
    const record = object(item, citationLabel);
    if (record.kind === "claim" || record.kind === "fact") {
      rejectUnknown(record, ["kind", "id"], citationLabel);
      if (typeof record.id !== "string" || !(record.kind === "claim" ? claims : facts).has(record.id)) {
        throw new Error(`${citationLabel} cites evidence outside the supplied packet`);
      }
      const citation: Citation = { kind: record.kind, id: record.id };
      if (seen.has(citationMapKey(citation))) throw new Error(`${citationLabel} duplicates a citation`);
      seen.add(citationMapKey(citation));
      return citation;
    }
    rejectUnknown(record, ["kind", "id", "quote"], citationLabel);
    if (record.kind !== "excerpt" || typeof record.id !== "string" || typeof record.quote !== "string") {
      throw new Error(`${citationLabel} is invalid`);
    }
    const excerpt = excerpts.get(record.id);
    const quote = record.quote;
    const normalizedQuote = normalizeText(quote);
    if (excerpt === undefined || quote !== normalizedQuote || normalizedQuote.length < 20 || normalizedQuote.length > 1_000 || !normalizeText(excerpt.text).includes(normalizedQuote)) {
      throw new Error(`${citationLabel} quote does not match the supplied excerpt`);
    }
    const citation: RawCitation = { kind: "excerpt", id: record.id, quote };
    if (seen.has(citationMapKey(citation))) throw new Error(`${citationLabel} duplicates a citation`);
    seen.add(citationMapKey(citation));
    return citation;
  });
}

function assertNumbersSupported(content: string, citations: RawCitation[], packet: EvidencePacket, label: string): void {
  const numbers = numericTokens(content);
  if (numbers.length === 0) return;
  const supported = new Set(citations.flatMap((citation) => supportedNumericTokens(citation, packet)));
  for (const number of numbers) if (!supported.has(number)) throw new Error(`${label} contains an unsupported numerical assertion`);
}

function supportedNumericTokens(citation: RawCitation, packet: EvidencePacket): string[] {
  if (citation.kind === "excerpt") return numericTokens(citation.quote);
  if (citation.kind === "claim") {
    return packet.claims.filter((claim) => claim.claim_id === citation.id).flatMap((claim) => numericTokens(claim.text_canonical));
  }
  return packet.facts.filter((fact) => fact.fact_id === citation.id).flatMap((fact) => [
    canonicalNumber(fact.value_num),
    canonicalNumber(fact.value_num * fact.scale),
    ...structuredNumericTokens(fact.period_start),
    ...structuredNumericTokens(fact.period_end),
    ...structuredNumericTokens(fact.as_of),
    ...(fact.fiscal_year === null ? [] : [canonicalNumber(fact.fiscal_year)]),
    ...structuredNumericTokens(fact.fiscal_period),
  ].filter((token): token is string => token !== null));
}

function numericTokens(value: string): string[] {
  const dateStarts = new Set<number>();
  const tokens: string[] = [];
  for (const match of value.matchAll(CALENDAR_DATE_TOKEN)) {
    const index = match.index;
    if (index === undefined) continue;
    dateStarts.add(index);
    addNumericToken(tokens, `date:${match[0]}`);
  }
  for (const match of value.matchAll(NUMERIC_CANDIDATE)) {
    const index = match.index;
    if (index !== undefined && dateStarts.has(index)) continue;
    const numeric = canonicalNumericLiteral(match[0]);
    if (numeric === null) throw new Error("contains an unsupported numerical literal");
    addNumericToken(tokens, numeric);
  }
  return tokens;
}

function structuredNumericTokens(value: string | null): string[] {
  return value === null ? [] : numericTokens(value);
}

function canonicalNumber(value: number): string | null {
  return Number.isFinite(value) ? canonicalNumericLiteral(String(Object.is(value, -0) ? 0 : value)) : null;
}

function canonicalNumericLiteral(literal: string): string | null {
  const match = NUMERIC_LITERAL.exec(literal);
  if (match === null) return null;
  const exponent = boundedExponent(match[5]);
  if (exponent === null) return null;
  const integer = match[2] ?? "";
  const fraction = match[3] ?? match[4] ?? "";
  const digits = `${integer}${fraction}`.replaceAll(",", "").replace(/^0+/u, "");
  if (digits.length === 0) return "number:0e0";
  const significant = digits.replace(/0+$/u, "");
  const trailingZeros = digits.length - significant.length;
  const power = exponent - fraction.length + trailingZeros;
  if (!Number.isSafeInteger(power) || Math.abs(power) > MAX_ABSOLUTE_EXPONENT) return null;
  return `number:${match[1] === "-" ? "-" : ""}${significant}e${power}`;
}

function boundedExponent(value: string | undefined): number | null {
  if (value === undefined) return 0;
  const negative = value.startsWith("-");
  const digits = value.replace(/^[+-]?0*/u, "") || "0";
  const limit = String(MAX_ABSOLUTE_EXPONENT);
  if (digits.length > limit.length || (digits.length === limit.length && digits > limit)) return null;
  let magnitude = 0;
  for (const digit of digits) magnitude = magnitude * 10 + digit.charCodeAt(0) - 48;
  return negative ? -magnitude : magnitude;
}

function addNumericToken(tokens: string[], token: string): void {
  if (tokens.length >= MAX_NUMERIC_TOKENS) throw new Error("contains too many numerical literals");
  tokens.push(token);
}

function normalizeText(value: string): string { return value.replace(/\s+/gu, " ").trim(); }
function text(value: unknown, label: string, min: number, max: number): string {
  if (typeof value !== "string" || value !== value.trim() || value.length < min || value.length > max) throw new Error(`${label} is invalid`);
  return value;
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function rejectUnknown(value: Record<string, unknown>, allowed: string[], label: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${label}.${key} is not allowed`);
}
function isSkeptic(role: RawRole): role is SkepticOutput<RawCitation> { return "counterarguments" in role; }

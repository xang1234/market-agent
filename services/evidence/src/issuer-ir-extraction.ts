import type { SubjectRef } from "../../shared/src/subject-ref.ts";
import type { JsonObject } from "../../tools/src/registry.ts";
import type { ClaimInput } from "./claim-repo.ts";
import type { EventInput } from "./event-repo.ts";
import type { IrAssetKind, IrDocumentAssetRow } from "./issuer-ir-registry.ts";

export type IssuerIrExtractionInput = {
  text: string;
  document_id: string;
  source_id: string;
  subject_ref: SubjectRef;
  asset?: Pick<IrDocumentAssetRow, "asset_kind" | "issuer_attested" | "fetched_at">;
  effective_time?: string | null;
};

export type IssuerIrExtractionResult = Readonly<{
  claims: ReadonlyArray<ClaimInput>;
  events: ReadonlyArray<EventInput>;
  candidate_facts: ReadonlyArray<JsonObject>;
  sentiment: ReadonlyArray<JsonObject>;
}>;

const KPI_RE = /\b(revenue|sales|margin|operating income|eps|earnings per share|free cash flow|cash flow|arr|bookings|backlog)\b/i;
const GUIDANCE_RE = /\b(guidance|outlook|forecast|expects?|raise[sd]?|lift(?:ed|s)?|lower(?:ed|s)?|cut|reduce[sd]?|increase[sd]?)\b/i;
const SEGMENT_RE = /\b(segment|cloud|software|services|geograph(?:y|ic)|region|product line)\b/i;
const POSITIVE_TONE_RE = /\b(confident|optimistic|strong demand|momentum|resilient|accelerat(?:e|ed|ing))\b/i;
const NEGATIVE_TONE_RE = /\b(cautious|challenging|headwind|uncertain|soft demand|pressure|declin(?:e|ed|ing))\b/i;

export function extractIssuerIrEvidence(input: IssuerIrExtractionInput): IssuerIrExtractionResult {
  const text = normalizeDocumentText(input.text);
  const sentences = sentenceCandidates(text);
  const claims: ClaimInput[] = [];
  const events: EventInput[] = [];
  const candidateFacts: JsonObject[] = [];
  const sentiment: JsonObject[] = [];
  const effectiveTime = input.effective_time ?? input.asset?.fetched_at ?? null;

  const guidance = firstMatching(sentences, (sentence) => GUIDANCE_RE.test(sentence));
  if (guidance) {
    claims.push(claim(input, {
      predicate: "guidance.change",
      text: guidance,
      polarity: lowered(guidance) ? "negative" : "positive",
      confidence: input.asset?.issuer_attested === false ? 0.78 : 0.88,
      effectiveTime,
    }));
    events.push(Object.freeze({
      event_type: "guidance_update",
      occurred_at: effectiveTime ?? new Date().toISOString(),
      status: "reported",
      source_claim_ids: [],
      source_ids: [input.source_id],
      payload_json: {
        extractor: "issuer_ir_rules_v1",
        evidence_text: guidance,
        asset_kind: input.asset?.asset_kind ?? null,
      },
    }));
  }

  const kpi = firstMatching(sentences, (sentence) => KPI_RE.test(sentence));
  if (kpi) {
    claims.push(claim(input, {
      predicate: "kpi.commentary",
      text: kpi,
      polarity: lowered(kpi) ? "negative" : "positive",
      confidence: input.asset?.issuer_attested === false ? 0.74 : 0.84,
      effectiveTime,
    }));
    candidateFacts.push(Object.freeze({
      item_type: "issuer_ir_kpi_commentary",
      text: kpi,
      confidence: input.asset?.issuer_attested === false ? 0.74 : 0.84,
      subject_ref: input.subject_ref,
    }) as JsonObject);
  }

  const segment = firstMatching(sentences, (sentence) => SEGMENT_RE.test(sentence));
  if (segment && segment !== kpi) {
    claims.push(claim(input, {
      predicate: "segment.commentary",
      text: segment,
      polarity: lowered(segment) ? "negative" : "neutral",
      confidence: input.asset?.issuer_attested === false ? 0.72 : 0.82,
      effectiveTime,
    }));
  }

  const toneSentence = firstMatching(sentences, (sentence) => POSITIVE_TONE_RE.test(sentence) || NEGATIVE_TONE_RE.test(sentence));
  if (toneSentence) {
    const polarity = NEGATIVE_TONE_RE.test(toneSentence) ? "negative" : "positive";
    claims.push(claim(input, {
      predicate: "management.tone",
      text: toneSentence,
      polarity,
      confidence: input.asset?.issuer_attested === false ? 0.68 : 0.78,
      effectiveTime,
    }));
    sentiment.push(Object.freeze({
      item_type: "issuer_ir_management_tone",
      polarity,
      text: toneSentence,
      confidence: input.asset?.issuer_attested === false ? 0.68 : 0.78,
      subject_ref: input.subject_ref,
    }) as JsonObject);
  }

  if (input.asset?.asset_kind === "press_release" && /earnings|results/i.test(text)) {
    events.push(Object.freeze({
      event_type: "earnings_release",
      occurred_at: effectiveTime ?? new Date().toISOString(),
      status: "reported",
      source_claim_ids: [],
      source_ids: [input.source_id],
      payload_json: {
        extractor: "issuer_ir_rules_v1",
        asset_kind: input.asset.asset_kind,
      },
    }));
  }

  return Object.freeze({
    claims: Object.freeze(dedupeClaims(claims)),
    events: Object.freeze(events),
    candidate_facts: Object.freeze(candidateFacts),
    sentiment: Object.freeze(sentiment),
  });
}

export function normalizeDocumentText(text: string): string {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function documentTextFromBytes(bytes: Uint8Array, _assetKind?: IrAssetKind): string {
  return normalizeDocumentText(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
}

function claim(
  input: IssuerIrExtractionInput,
  fields: {
    predicate: string;
    text: string;
    polarity: ClaimInput["polarity"];
    confidence: number;
    effectiveTime: string | null;
  },
): ClaimInput {
  return Object.freeze({
    document_id: input.document_id,
    predicate: fields.predicate,
    text_canonical: fields.text,
    polarity: fields.polarity,
    modality: "asserted",
    reported_by_source_id: input.source_id,
    attributed_to_type: input.subject_ref.kind,
    attributed_to_id: input.subject_ref.id,
    effective_time: fields.effectiveTime,
    confidence: fields.confidence,
    status: "extracted",
  });
}

function sentenceCandidates(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 20)
    .slice(0, 80);
}

function firstMatching(sentences: readonly string[], predicate: (sentence: string) => boolean): string | null {
  return sentences.find(predicate) ?? null;
}

function lowered(text: string): boolean {
  return /\b(lower(?:ed|s)?|cut|reduce[sd]?|declin(?:e|ed|ing)|headwind|pressure)\b/i.test(text);
}

function dedupeClaims(claims: readonly ClaimInput[]): ClaimInput[] {
  const seen = new Set<string>();
  const out: ClaimInput[] = [];
  for (const item of claims) {
    const key = `${item.predicate}:${item.text_canonical}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

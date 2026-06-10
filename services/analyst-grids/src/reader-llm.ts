import {
  CLAIM_MODALITIES,
  CLAIM_POLARITIES,
  type ClaimModality,
  type ClaimPolarity,
} from "../../evidence/src/claim-repo.ts";

export const MAX_ANSWER_CHARS = 140;
export const MAX_DOC_CHARS = 12_000;

export type ReaderDocText = { document_id: string; doc_kind: string; text: string };

export type ParsedReaderClaim = {
  document_id: string;
  predicate: string;
  text_canonical: string;
  polarity: ClaimPolarity;
  modality: ClaimModality;
  confidence: number;
};

export type ParsedReaderResponse =
  | { kind: "answered"; answer: string; claims: ParsedReaderClaim[] }
  | { kind: "not_discussed" };

const SYSTEM_PROMPT = [
  "You are a financial research reader. You receive a research question and",
  "excerpts of source documents about one company. Extract only what the",
  "documents support — never outside knowledge. Respond with EXACTLY one JSON",
  'object: {"answer": string (<=140 chars), "claims": [{"document_id",',
  '"predicate", "text_canonical", "polarity": "positive"|"negative"|"neutral"|"mixed",',
  '"modality": "asserted"|"estimated"|"speculative"|"rumored"|"quoted",',
  '"confidence": number 0..1}], "not_discussed": boolean}.',
  "If the documents do not address the question, set not_discussed=true and claims=[].",
  "Every claim's document_id must be one of the provided documents.",
].join(" ");

export function buildReaderMessages(
  question: string,
  docs: ReadonlyArray<ReaderDocText>,
): Array<{ role: "system" | "user"; content: string }> {
  const docSections = docs
    .map(
      (doc) =>
        `--- DOCUMENT ${doc.document_id} (${doc.doc_kind}) ---\n${doc.text.slice(0, MAX_DOC_CHARS)}`,
    )
    .join("\n\n");
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `QUESTION: ${question}\n\n${docSections}` },
  ];
}

export function parseReaderResponse(
  raw: string,
  allowedDocumentIds: ReadonlySet<string>,
): ParsedReaderResponse {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null)
    throw new Error("reader response must be a JSON object");
  const body = parsed as { answer?: unknown; claims?: unknown; not_discussed?: unknown };
  if (body.not_discussed === true) return { kind: "not_discussed" };
  if (typeof body.answer !== "string" || body.answer.trim().length === 0) {
    throw new Error("reader response missing answer");
  }
  if (!Array.isArray(body.claims)) throw new Error("reader response missing claims array");
  const claims = body.claims.map((claim, index) =>
    parseClaim(claim, index, allowedDocumentIds),
  );
  if (claims.length === 0) return { kind: "not_discussed" };
  return { kind: "answered", answer: body.answer.trim().slice(0, MAX_ANSWER_CHARS), claims };
}

function parseClaim(
  value: unknown,
  index: number,
  allowed: ReadonlySet<string>,
): ParsedReaderClaim {
  if (typeof value !== "object" || value === null)
    throw new Error(`claims[${index}] must be an object`);
  const claim = value as Record<string, unknown>;
  if (typeof claim.document_id !== "string" || !allowed.has(claim.document_id)) {
    throw new Error(`claims[${index}]: unknown document_id`);
  }
  if (typeof claim.predicate !== "string" || claim.predicate.length === 0)
    throw new Error(`claims[${index}]: predicate required`);
  if (typeof claim.text_canonical !== "string" || claim.text_canonical.length === 0)
    throw new Error(`claims[${index}]: text_canonical required`);
  if (!(CLAIM_POLARITIES as readonly string[]).includes(claim.polarity as string))
    throw new Error(`claims[${index}]: invalid polarity`);
  if (!(CLAIM_MODALITIES as readonly string[]).includes(claim.modality as string))
    throw new Error(`claims[${index}]: invalid modality`);
  if (
    typeof claim.confidence !== "number" ||
    !Number.isFinite(claim.confidence) ||
    claim.confidence < 0 ||
    claim.confidence > 1
  ) {
    throw new Error(`claims[${index}]: confidence must be in [0,1]`);
  }
  return {
    document_id: claim.document_id,
    predicate: claim.predicate,
    text_canonical: claim.text_canonical,
    polarity: claim.polarity as ClaimPolarity,
    modality: claim.modality as ClaimModality,
    confidence: claim.confidence,
  };
}

import { randomUUID } from "node:crypto";
import { createClaim } from "../../evidence/src/claim-repo.ts";
import { writeToolCallLog } from "../../observability/src/tool-call.ts";
import { buildClaimBackedSealInput } from "../../analyze/src/block-seal-input.ts";
import { selectReaderDocuments, READER_DOCUMENTS_PER_CELL } from "./reader-documents.ts";
import { buildReaderMessages, parseReaderResponse, type ReaderDocText } from "./reader-llm.ts";
import type { GridColumnProducer, GridCellResult } from "./column-catalog.ts";
import { EMPTY_DISPLAY, GridValidationError } from "./types.ts";

export const READER_TOOL_NAME = "grid_reader_question";
export const PROMPT_MIN = 8;
export const PROMPT_MAX = 300;

// The single params contract for reader_question columns, enforced at grid
// create time (validateColumnSpecs) and again at run time (the producer) —
// one parser, so a spec that validates always runs, and vice versa.
export function parseReaderQuestionParams(params: unknown): { prompt: string } {
  const prompt = (params as { prompt?: unknown } | null | undefined)?.prompt;
  if (typeof prompt !== "string") {
    throw new GridValidationError("reader_question requires params.prompt (string)");
  }
  const trimmed = prompt.trim();
  if (trimmed.length < PROMPT_MIN || trimmed.length > PROMPT_MAX) {
    throw new GridValidationError(`params.prompt must be ${PROMPT_MIN}-${PROMPT_MAX} characters`);
  }
  return { prompt: trimmed };
}

const NO_COVERAGE = (flag: string): GridCellResult => ({
  status: "no_coverage",
  display: EMPTY_DISPLAY,
  coverageFlag: flag,
});

export const readerQuestionProducer: GridColumnProducer = async (deps, ctx) => {
  if (ctx.subject.kind !== "issuer") return NO_COVERAGE("issuer_only");
  const reader = deps.reader;
  if (!reader) throw new Error("reader_question: reader deps not configured");
  const { prompt } = parseReaderQuestionParams(ctx.params);

  const docs = await selectReaderDocuments(
    deps.db,
    ctx.subject.id,
    ctx.userId,
    READER_DOCUMENTS_PER_CELL,
  );
  if (docs.length === 0) return NO_COVERAGE("no_documents");

  const texts: ReaderDocText[] = [];
  for (const doc of docs) {
    const text = await reader.loadDocumentText(doc.raw_blob_id);
    if (text !== null && text.trim().length > 0) {
      texts.push({ document_id: doc.document_id, doc_kind: doc.doc_kind, text });
    }
  }
  if (texts.length === 0) return NO_COVERAGE("no_document_text");

  const completion = await reader.llm.complete({
    messages: buildReaderMessages(prompt, texts),
    temperature: 0,
    maxTokens: 1500,
  });
  const parsed = parseReaderResponse(
    completion.text,
    new Set(texts.map((t) => t.document_id)),
  );
  if (parsed.kind === "not_discussed") {
    return { status: "missing_data", display: EMPTY_DISPLAY, coverageFlag: "no_relevant_claims" };
  }

  const docById = new Map(docs.map((doc) => [doc.document_id, doc]));
  const claimRows = [];
  // Claims and the tool-call log are intentionally append-only and committed
  // per-statement: if a later step (or the seal) fails, orphaned rows remain
  // inert — nothing surfaces a claim without a sealed snapshot citing it.
  for (const claim of parsed.claims) {
    const doc = docById.get(claim.document_id)!;
    claimRows.push(
      await createClaim(deps.db, {
        document_id: claim.document_id,
        predicate: claim.predicate,
        text_canonical: claim.text_canonical,
        polarity: claim.polarity,
        modality: claim.modality,
        reported_by_source_id: doc.source_id,
        confidence: claim.confidence,
        status: "extracted",
      }),
    );
  }

  // The audited result: answer + the claim ids it rests on. writeToolCallLog
  // hashes it canonically (hashJsonValue) and returns the persisted hash, so
  // the manifest entry and the tool_call_logs row agree by construction.
  const logged = await writeToolCallLog(deps.db, {
    tool_name: READER_TOOL_NAME,
    args: {
      subject_id: ctx.subject.id,
      prompt,
      document_ids: texts.map((t) => t.document_id),
    },
    result: {
      answer: parsed.answer,
      claim_ids: claimRows.map((c) => c.claim_id),
    },
    status: "ok",
  });
  if (logged.result_hash === null) {
    throw new Error("reader_question: tool call log returned no result_hash");
  }

  const sourceRefs = [
    ...new Set([
      ...claimRows.map((c) => c.reported_by_source_id),
      ...texts.map((t) => docById.get(t.document_id)!.source_id),
    ]),
  ];
  const blockId = randomUUID();
  const block = {
    id: blockId,
    kind: "rich_text" as const,
    snapshot_id: ctx.snapshotId,
    as_of: ctx.asOf,
    source_refs: sourceRefs,
    data_ref: {
      kind: "rich_text",
      id: blockId,
      params: { column_key: "reader_question" },
    },
    segments: [
      { type: "text", text: parsed.answer },
      ...claimRows.map((c) => ({ type: "ref", ref_kind: "claim", ref_id: c.claim_id })),
    ],
  };

  const seal = buildClaimBackedSealInput({
    block,
    claims: claimRows.map((c) => ({
      claim_id: c.claim_id,
      source_id: c.reported_by_source_id,
    })),
    documents: texts.map((t) => {
      const doc = docById.get(t.document_id)!;
      return { document_id: doc.document_id, source_id: doc.source_id };
    }),
    subjectRefs: [{ kind: ctx.subject.kind, id: ctx.subject.id }],
    toolCalls: [{ tool_call_id: logged.tool_call_id, result_hash: logged.result_hash }],
    modelVersion: completion.deployment ? `reader:${completion.deployment.model}` : null,
  });

  return {
    status: "ok",
    display: { value: parsed.answer, tone: null },
    primaryRef: { kind: "claim", id: claimRows[0].claim_id },
    seal,
  };
};

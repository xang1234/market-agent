import { randomUUID } from "node:crypto";
import { createClaim } from "../../evidence/src/claim-repo.ts";
import { writeToolCallLog } from "../../observability/src/tool-call.ts";
import { buildClaimBackedSealInput } from "../../snapshot/src/seal-input.ts";
import { selectReaderDocuments, READER_DOCUMENTS_PER_CELL } from "./reader-documents.ts";
import { buildReaderMessages, parseReaderResponse, type ReaderDocText, type ParsedReaderResponse } from "./reader-llm.ts";
import type { GridColumnProducer, GridCellResult, ReaderLlm } from "./column-catalog.ts";
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

const READER_MAX_ATTEMPTS = 2;

// One reader cell in six intermittently failed with 'Unterminated string in JSON': the dev
// channel truncates the response provider-side (~930 chars) despite maxTokens being
// forwarded. The cut is non-deterministic (temperature 0, but provider-side), so a single
// fresh retry absorbs it. Only a JSON.parse SyntaxError (the truncation symptom) is
// retried — a shape/validation failure throws a plain Error and is deterministic at
// temperature 0, so re-asking wouldn't change it. Returns the deployment so the caller can
// stamp the seal's model_version. (fra-iuv9)
async function completeAndParseReader(
  llm: ReaderLlm,
  messages: ReturnType<typeof buildReaderMessages>,
  allowedDocumentIds: ReadonlySet<string>,
): Promise<{ parsed: ParsedReaderResponse; deployment?: { channel: string; model: string } }> {
  for (let attempt = 1; ; attempt += 1) {
    const completion = await llm.complete({
      messages,
      temperature: 0,
      // Headroom for the JSON claims array — 1500 truncated real responses mid-string
      // once documents carried actual prose.
      maxTokens: 4000,
    });
    try {
      return { parsed: parseReaderResponse(completion.text, allowedDocumentIds), deployment: completion.deployment };
    } catch (err) {
      if (attempt >= READER_MAX_ATTEMPTS || !(err instanceof SyntaxError)) throw err;
    }
  }
}

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

  // Blob fetches are independent; load in parallel. Promise.all preserves doc
  // order, so the prompt's document sections stay in ranked order.
  const texts = (
    await Promise.all(
      docs.map(async (doc): Promise<ReaderDocText | null> => {
        const text = await reader.loadDocumentText(doc.raw_blob_id);
        if (text === null || text.trim().length === 0) return null;
        return { document_id: doc.document_id, doc_kind: doc.doc_kind, text };
      }),
    )
  ).filter((t): t is ReaderDocText => t !== null);
  if (texts.length === 0) return NO_COVERAGE("no_document_text");

  const { parsed, deployment } = await completeAndParseReader(
    reader.llm,
    buildReaderMessages(prompt, texts),
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
    modelVersion: deployment ? `reader:${deployment.model}` : null,
  });

  return {
    status: "ok",
    display: { value: parsed.answer, tone: null },
    primaryRef: { kind: "claim", id: claimRows[0].claim_id },
    seal,
  };
};

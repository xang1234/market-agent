// Reader-audience extraction tool handlers (fra-wmx).
//
// These are the production-side stubs that fra-wmx wires into the
// reader-tool dispatcher. They:
//   - Look up the document via getDocument (the existence/visibility check
//     belongs in evidence, not in tools, so the dispatcher stays
//     extraction-agnostic).
//   - Throw ReaderToolError(NOT_FOUND) for unknown documents.
//   - Return the structured shape declared by the registry —
//     {items: [], source_ids: [doc.source_id]} — with empty items.
//
// Real extraction logic (LLM, rules) lands in downstream beads:
//   fra-6j0.3 (entity linking & mentions),
//   fra-6j0.4 (claim/event/impact graph & clustering),
//   fra-cdu.1 (segment refinement).
//
// The structural contract (input/output shapes, error code mapping) is
// pinned here so those downstream implementations can be slotted in
// without renegotiating the wire shape.

import {
  READER_TOOL_NAMES,
  ReaderToolError,
  type ReaderToolName,
  type ReaderToolHandler,
  type ReaderToolHandlerMap,
} from "../../../tools/src/reader-tool-dispatcher.ts";
import type { JsonObject } from "../../../tools/src/registry.ts";
import {
  fetchEvidenceDocumentMetadata,
  searchEvidenceDocuments,
} from "../document-research.ts";
import {
  DOCUMENT_KINDS,
  getDocument,
  type DocumentKind,
  type DocumentRow,
} from "../document-repo.ts";
import {
  deleteMentionsForDocumentExcept,
  listMentionsForDocument,
  type MentionRow,
} from "../mention-repo.ts";
import type { QueryExecutor } from "../types.ts";
import {
  isEphemeralRawBlobId,
  type ObjectStore,
} from "../object-store.ts";
import {
  emptyIssuerIrExtractionResult,
  extractIssuerIrEvidence,
  issuerIrTextFromBytes,
} from "../issuer-ir-extraction.ts";
import { getIrDocumentAssetForDocument } from "../issuer-ir-registry.ts";
import { withTransaction } from "../transaction.ts";
import {
  linkDocumentMentions,
  type DetectedMentionCandidate,
  type ResolveMention,
  type SkippedMention,
} from "./entity-linker.ts";
import { extractNonGaapReconciliations } from "./non-gaap-reconciliation-extractor.ts";
import { extractXbrlExtensionSegments } from "./xbrl-segment-extractor.ts";

export type EvidenceReaderToolDeps = {
  db: QueryExecutor;
  objectStore?: ObjectStore;
  extractMentionCandidates?: (document: DocumentRow) => Promise<readonly DetectedMentionCandidate[]>;
  resolveMention?: ResolveMention;
};

export function createEvidenceReaderToolHandlers(
  deps: EvidenceReaderToolDeps,
): Required<ReaderToolHandlerMap> {
  // `Required<>` so callers (and tests) can index by tool name without
  // an undefined check — the dispatcher already requires every entry.
  const handlers = {} as { [K in ReaderToolName]: ReaderToolHandler<K> };
  for (const name of READER_TOOL_NAMES) {
    if (name === "search_raw_documents") {
      handlers[name] = makeSearchRawDocumentsHandler(deps);
    } else if (name === "fetch_raw_document") {
      handlers[name] = makeFetchRawDocumentHandler(deps);
    } else if (name === "extract_mentions") {
      handlers[name] = makeExtractMentionsHandler(deps);
    } else if (name === "extract_claims" || name === "extract_events" || name === "classify_sentiment") {
      handlers[name] = makeIssuerIrExtractionHandler(deps, name);
    } else if (name === "extract_candidate_facts") {
      handlers[name] = makeExtractCandidateFactsHandler(deps);
    } else {
      handlers[name] = makeStubHandler(deps);
    }
  }
  return handlers;
}

function makeSearchRawDocumentsHandler(deps: EvidenceReaderToolDeps): ReaderToolHandler<"search_raw_documents"> {
  return async (input) => {
    let result;
    try {
      result = await searchEvidenceDocuments(deps.db, {
        query: input.query,
        subjectRefs: input.subject_refs?.map((ref) => ({ kind: ref.kind, id: ref.id })),
        canonicalUrl: input.canonical_url ?? input.url,
        domain: input.domain,
        kind: parseDocumentKind(input.kind),
        publishedFrom: input.range?.start,
        publishedTo: input.range?.end,
        limit: input.limit,
      });
    } catch (error) {
      if (isDocumentResearchInputError(error)) {
        throw new ReaderToolError("INVALID_ARGUMENT", errorMessage(error));
      }
      throw error;
    }
    return {
      documents: result.documents.map(jsonRecord),
    };
  };
}

function makeFetchRawDocumentHandler(deps: EvidenceReaderToolDeps): ReaderToolHandler<"fetch_raw_document"> {
  return async (input) => {
    let document;
    try {
      document = await fetchEvidenceDocumentMetadata(deps.db, {
        documentId: input.document_id,
      });
    } catch (error) {
      if (isDocumentResearchInputError(error)) {
        throw new ReaderToolError("INVALID_ARGUMENT", errorMessage(error));
      }
      throw error;
    }
    if (!document) {
      throw new ReaderToolError(
        "NOT_FOUND",
        `document_id "${input.document_id}" not found`,
      );
    }
    return {
      document: jsonRecord(document),
    };
  };
}

function makeStubHandler(deps: EvidenceReaderToolDeps): ReaderToolHandler {
  return async (input) => {
    const document = await getDocument(deps.db, input.document_id);
    if (!document) {
      throw new ReaderToolError(
        "NOT_FOUND",
        `document_id "${input.document_id}" not found`,
      );
    }

    return {
      items: [],
      source_ids: [document.source_id],
    };
  };
}

function makeExtractMentionsHandler(deps: EvidenceReaderToolDeps): ReaderToolHandler {
  return async (input) => {
    const hasExtractor = Boolean(deps.extractMentionCandidates);
    const hasResolver = Boolean(deps.resolveMention);
    if (hasExtractor !== hasResolver) {
      throw new Error("extract_mentions requires both extractMentionCandidates and resolveMention to be configured");
    }

    const document = await getDocument(deps.db, input.document_id);
    if (!document) {
      throw new ReaderToolError(
        "NOT_FOUND",
        `document_id "${input.document_id}" not found`,
      );
    }

    let skipped: readonly SkippedMention[] = [];
    if (deps.extractMentionCandidates && deps.resolveMention) {
      const candidates = await deps.extractMentionCandidates(document);
      const linked = await withTransaction(deps.db, async (tx) => {
        const linkedMentions = await linkDocumentMentions({
          db: tx.db,
          document_id: document.document_id,
          candidates,
          resolveMention: deps.resolveMention!,
        });
        await deleteMentionsForDocumentExcept(
          tx.db,
          document.document_id,
          linkedMentions.mentions.map((mention) => ({
            subject_kind: mention.subject_ref.kind,
            subject_id: mention.subject_ref.id,
            prominence: mention.prominence,
          })),
        );
        return linkedMentions;
      });
      skipped = linked.skipped;
    }
    const mentions = deps.extractMentionCandidates && deps.resolveMention
      ? await listMentionsForDocument(deps.db, document.document_id)
      : [];

    return {
      items: [...mentions.map(mentionToToolItem), ...skipped.map(skippedMentionToToolItem)],
      source_ids: [document.source_id],
    };
  };
}

function makeExtractCandidateFactsHandler(deps: EvidenceReaderToolDeps): ReaderToolHandler {
  return async (input) => {
    const document = await getDocument(deps.db, input.document_id);
    if (!document) {
      throw new ReaderToolError(
        "NOT_FOUND",
        `document_id "${input.document_id}" not found`,
      );
    }

    if (document.kind !== "filing") {
      const ir = await issuerIrExtractionForDocument(deps, document);
      if (ir) {
        return {
          items: ir.candidate_facts,
          source_ids: [document.source_id],
        };
      }
      return {
        items: [],
        source_ids: [document.source_id],
      };
    }
    if (!deps.objectStore) {
      return {
        items: [],
        source_ids: [document.source_id],
      };
    }
    if (isEphemeralRawBlobId(document.raw_blob_id)) {
      throw new ReaderToolError(
        "POLICY_BLOCKED",
        `document_id "${input.document_id}" has no retained raw filing bytes`,
      );
    }

    let blob;
    try {
      blob = await deps.objectStore.get(document.raw_blob_id);
    } catch (error) {
      throw new ReaderToolError(
        "UPSTREAM_UNAVAILABLE",
        `raw_blob_id "${document.raw_blob_id}" could not be read from object store: ${errorMessage(error)}`,
      );
    }
    if (!blob) {
      throw new ReaderToolError(
        "UPSTREAM_UNAVAILABLE",
        `raw_blob_id "${document.raw_blob_id}" not found in object store`,
      );
    }

    const text = new TextDecoder().decode(blob.bytes);
    const asOf = new Date().toISOString();
    const extractedXbrl = extractXbrlExtensionSegments({
      xbrl: text,
      source_id: document.source_id,
      as_of: asOf,
      definition_as_of: documentDefinitionAsOf(document),
    });
    const extractedNonGaap = extractNonGaapReconciliations({
      html: text,
      source_id: document.source_id,
      as_of: asOf,
    });

    return {
      items: [...extractedXbrl.items, ...extractedNonGaap.items],
      source_ids: [document.source_id],
    };
  };
}

function makeIssuerIrExtractionHandler(
  deps: EvidenceReaderToolDeps,
  name: "extract_claims" | "extract_events" | "classify_sentiment",
): ReaderToolHandler {
  return async (input) => {
    const document = await getDocument(deps.db, input.document_id);
    if (!document) {
      throw new ReaderToolError(
        "NOT_FOUND",
        `document_id "${input.document_id}" not found`,
      );
    }
    const ir = await issuerIrExtractionForDocument(deps, document);
    if (!ir) {
      return {
        items: [],
        source_ids: [document.source_id],
      };
    }
    const items = name === "extract_claims"
      ? ir.claims.map((claim) => ({
        item_type: "issuer_ir_claim",
        predicate: claim.predicate,
        text_canonical: claim.text_canonical,
        polarity: claim.polarity,
        confidence: claim.confidence,
      }))
      : name === "extract_events"
      ? ir.events.map((event) => ({
        item_type: "issuer_ir_event",
        event_type: event.event_type,
        occurred_at: event.occurred_at,
        status: event.status,
        payload_json: event.payload_json,
      }))
      : ir.sentiment;
    return {
      items,
      source_ids: [document.source_id],
    };
  };
}

async function issuerIrExtractionForDocument(
  deps: EvidenceReaderToolDeps,
  document: DocumentRow,
): Promise<ReturnType<typeof extractIssuerIrEvidence> | null> {
  if (!deps.objectStore || !["press_release", "transcript", "research_note"].includes(document.kind)) {
    return null;
  }
  const asset = await getIrDocumentAssetForDocument(deps.db, document.document_id);
  if (!asset) return null;
  if (isEphemeralRawBlobId(document.raw_blob_id)) {
    throw new ReaderToolError(
      "POLICY_BLOCKED",
      `document_id "${document.document_id}" has no retained issuer IR bytes`,
    );
  }
  let blob;
  try {
    blob = await deps.objectStore.get(document.raw_blob_id);
  } catch (error) {
    throw new ReaderToolError(
      "UPSTREAM_UNAVAILABLE",
      `raw_blob_id "${document.raw_blob_id}" could not be read from object store: ${errorMessage(error)}`,
    );
  }
  if (!blob) {
    throw new ReaderToolError(
      "UPSTREAM_UNAVAILABLE",
      `raw_blob_id "${document.raw_blob_id}" not found in object store`,
    );
  }
  const text = issuerIrTextFromBytes({
    bytes: blob.bytes,
    contentType: asset.content_type,
  });
  if (text.status !== "available") {
    return emptyIssuerIrExtractionResult();
  }
  return extractIssuerIrEvidence({
    text: text.text,
    document_id: document.document_id,
    source_id: document.source_id,
    subject_ref: { kind: "issuer", id: asset.issuer_id },
    asset,
    effective_time: document.published_at,
  });
}

function mentionToToolItem(mention: MentionRow) {
  return {
    mention_id: mention.mention_id,
    document_id: mention.document_id,
    subject_ref: mention.subject_ref,
    prominence: mention.prominence,
    mention_count: mention.mention_count,
    confidence: mention.confidence,
  };
}

function skippedMentionToToolItem(skipped: SkippedMention) {
  return {
    item_type: "skipped_mention",
    text: skipped.text,
    reason: skipped.reason,
    resolver_envelope: skipped.envelope,
  };
}

function jsonRecord(value: Record<string, unknown>): JsonObject {
  return Object.freeze({ ...value }) as JsonObject;
}

function parseDocumentKind(value: string | undefined): DocumentKind | undefined {
  if (value === undefined) return undefined;
  if ((DOCUMENT_KINDS as ReadonlyArray<string>).includes(value)) {
    return value as DocumentKind;
  }
  throw new ReaderToolError(
    "INVALID_ARGUMENT",
    `kind: must be one of ${DOCUMENT_KINDS.join(", ")}`,
  );
}

function documentDefinitionAsOf(document: DocumentRow): string | undefined {
  if (!document.published_at) return undefined;
  const publishedAt: unknown = document.published_at;
  if (publishedAt instanceof Date) {
    return publishedAt.toISOString().slice(0, 10);
  }
  return String(publishedAt).slice(0, 10);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isDocumentResearchInputError(error: unknown): boolean {
  return error instanceof Error &&
    /^(searchEvidenceDocuments|query|canonical_url|domain|kind|publishedFrom|publishedTo|limit|subjectRefs|document_id|user_id):/.test(error.message);
}

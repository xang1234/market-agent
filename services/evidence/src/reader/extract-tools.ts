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
  READER_EXTRACTION_TOOL_NAMES,
  ReaderToolError,
  type ReaderExtractionToolName,
  type ReaderToolHandler,
  type ReaderToolHandlerMap,
} from "../../../tools/src/reader-tool-dispatcher.ts";
import { getDocument, type DocumentRow } from "../document-repo.ts";
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
  const handlers = {} as { [K in ReaderExtractionToolName]: ReaderToolHandler };
  for (const name of READER_EXTRACTION_TOOL_NAMES) {
    handlers[name] = name === "extract_mentions"
      ? makeExtractMentionsHandler(deps)
      : name === "extract_candidate_facts"
        ? makeExtractCandidateFactsHandler(deps)
      : makeStubHandler(deps);
  }
  return handlers;
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
      const linked = await withTransaction(deps.db, async () => {
        const linkedMentions = await linkDocumentMentions({
          db: deps.db,
          document_id: document.document_id,
          candidates,
          resolveMention: deps.resolveMention!,
        });
        await deleteMentionsForDocumentExcept(
          deps.db,
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

    if (!deps.objectStore || document.kind !== "filing") {
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

    const blob = await deps.objectStore.get(document.raw_blob_id);
    if (!blob) {
      throw new ReaderToolError(
        "UPSTREAM_UNAVAILABLE",
        `raw_blob_id "${document.raw_blob_id}" not found in object store`,
      );
    }

    const text = new TextDecoder().decode(blob.bytes);
    const extractedXbrl = extractXbrlExtensionSegments({
      xbrl: text,
      source_id: document.source_id,
      as_of: new Date().toISOString(),
      definition_as_of: documentDefinitionAsOf(document),
    });
    const extractedNonGaap = extractNonGaapReconciliations({
      html: text,
      source_id: document.source_id,
      as_of: new Date().toISOString(),
    });

    return {
      items: [...extractedXbrl.items, ...extractedNonGaap.items],
      source_ids: [document.source_id],
    };
  };
}

async function withTransaction<T>(db: QueryExecutor, action: () => Promise<T>): Promise<T> {
  await db.query("begin");
  try {
    const result = await action();
    await db.query("commit");
    return result;
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
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

function documentDefinitionAsOf(document: DocumentRow): string | undefined {
  if (!document.published_at) return undefined;
  const publishedAt: unknown = document.published_at;
  if (publishedAt instanceof Date) {
    return publishedAt.toISOString().slice(0, 10);
  }
  return String(publishedAt).slice(0, 10);
}

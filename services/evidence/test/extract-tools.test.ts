import test from "node:test";
import assert from "node:assert/strict";

import {
  READER_EXTRACTION_TOOL_NAMES,
  ReaderToolError,
  createReaderToolDispatcher,
} from "../../tools/src/reader-tool-dispatcher.ts";
import { loadToolRegistry } from "../../tools/src/registry.ts";

import { createEvidenceReaderToolHandlers } from "../src/reader/extract-tools.ts";
import type { QueryExecutor } from "../src/types.ts";

const SAMPLE_DOC_UUID = "70a0cc2e-e198-4b59-a5c9-9bd2da4a359b";
const SAMPLE_SOURCE_UUID = "11111111-1111-4111-a111-111111111111";

function fakeDocumentRow(overrides: Partial<{ document_id: string; source_id: string }> = {}) {
  return {
    document_id: overrides.document_id ?? SAMPLE_DOC_UUID,
    source_id: overrides.source_id ?? SAMPLE_SOURCE_UUID,
    provider_doc_id: null,
    kind: "article",
    parent_document_id: null,
    conversation_id: null,
    title: "stub",
    author: null,
    published_at: new Date("2026-05-03T00:00:00.000Z"),
    lang: null,
    content_hash: "sha256:abc",
    raw_blob_id: "sha256:abc",
    parse_status: "pending",
    deleted_at: null,
    created_at: new Date("2026-05-03T00:00:00.000Z"),
    updated_at: new Date("2026-05-03T00:00:00.000Z"),
  };
}

function recordingDb(opts: { documentExists: boolean }) {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      queries.push({ text, values });
      return {
        rows: (opts.documentExists ? [fakeDocumentRow()] : []) as unknown as R[],
        command: "SELECT",
        rowCount: opts.documentExists ? 1 : 0,
        oid: 0,
        fields: [],
      };
    },
  };
  return { db, queries };
}

// ---- factory shape ---------------------------------------------------------

test("createEvidenceReaderToolHandlers returns one handler per dispatcher-wired tool name", () => {
  // The factory must produce exactly the dispatcher's required set —
  // missing one would fail dispatcher construction at startup;
  // surplus would fail the dispatcher's "unknown name" guard.
  const { db } = recordingDb({ documentExists: true });
  const handlers = createEvidenceReaderToolHandlers({ db });
  const handlerNames = Object.keys(handlers).sort();
  assert.deepEqual(handlerNames, [...READER_EXTRACTION_TOOL_NAMES].sort());
});

test("createEvidenceReaderToolHandlers slots into createReaderToolDispatcher without complaint", () => {
  // Wiring smoke test: the factory's output is exactly what the
  // dispatcher's construction guard accepts.
  const { db } = recordingDb({ documentExists: true });
  const dispatcher = createReaderToolDispatcher({
    registry: loadToolRegistry(),
    handlers: createEvidenceReaderToolHandlers({ db }),
  });
  assert.deepEqual(
    [...dispatcher.registeredToolNames()].sort(),
    [...READER_EXTRACTION_TOOL_NAMES].sort(),
  );
});

// ---- per-handler behaviour: existing document ------------------------------

for (const toolName of READER_EXTRACTION_TOOL_NAMES) {
  test(`${toolName} stub returns empty items + the document's source_id when the document exists`, async () => {
    // Stub contract: surface the structured shape the registry
    // promises (items, source_ids) so downstream consumers can be
    // built against a real wire shape immediately. Real extraction
    // logic (LLM, rules) lands as separate beads — this is the
    // wiring, not the smarts.
    const { db, queries } = recordingDb({ documentExists: true });
    const handlers = createEvidenceReaderToolHandlers({ db });
    const handler = handlers[toolName];
    assert.ok(handler, `${toolName}: handler must exist`);

    const out = await handler({ document_id: SAMPLE_DOC_UUID });

    assert.deepEqual([...out.items], []);
    assert.deepEqual([...out.source_ids], [SAMPLE_SOURCE_UUID]);
    assert.equal(queries.length, 1, `${toolName}: must issue exactly one document lookup`);
    assert.match(queries[0]!.text, /from documents/, `${toolName}: must look up by documents table`);
  });
}

// ---- per-handler behaviour: missing document -------------------------------

for (const toolName of READER_EXTRACTION_TOOL_NAMES) {
  test(`${toolName} stub throws ReaderToolError(NOT_FOUND) when the document doesn't exist`, async () => {
    const { db } = recordingDb({ documentExists: false });
    const handlers = createEvidenceReaderToolHandlers({ db });
    const handler = handlers[toolName];
    assert.ok(handler, `${toolName}: handler must exist`);

    await assert.rejects(
      () => handler({ document_id: SAMPLE_DOC_UUID }),
      (err: unknown) => {
        assert.ok(err instanceof ReaderToolError, `${toolName}: must throw ReaderToolError`);
        assert.equal(err.code, "NOT_FOUND");
        assert.match(err.message, /document_id/);
        return true;
      },
    );
  });
}

// ---- end-to-end via dispatcher --------------------------------------------

test("dispatcher + handler factory: success path returns the structured shape on a real document", async () => {
  const { db } = recordingDb({ documentExists: true });
  const dispatcher = createReaderToolDispatcher({
    registry: loadToolRegistry(),
    handlers: createEvidenceReaderToolHandlers({ db }),
  });

  const result = await dispatcher.dispatch({
    bundle_id: "document_research",
    audience: "reader",
    tool_name: "extract_mentions",
    arguments: { document_id: SAMPLE_DOC_UUID },
  });

  assert.equal(result.ok, true);
  if (result.ok === true) {
    assert.equal(result.tool_name, "extract_mentions");
    assert.deepEqual([...result.result.items], []);
    assert.deepEqual([...result.result.source_ids], [SAMPLE_SOURCE_UUID]);
  }
});

test("dispatcher + handler factory: NOT_FOUND from handler surfaces as a NOT_FOUND tool_error", async () => {
  const { db } = recordingDb({ documentExists: false });
  const dispatcher = createReaderToolDispatcher({
    registry: loadToolRegistry(),
    handlers: createEvidenceReaderToolHandlers({ db }),
  });

  const result = await dispatcher.dispatch({
    bundle_id: "document_research",
    audience: "reader",
    tool_name: "extract_claims",
    arguments: { document_id: SAMPLE_DOC_UUID },
  });

  assert.equal(result.ok, false);
  if (result.ok === false && result.kind === "tool_error") {
    assert.equal(result.tool_name, "extract_claims");
    assert.equal(result.error_code, "NOT_FOUND");
  }
});

test("dispatcher + handler factory: analyst attempting an extract tool is rejected before any DB query", async () => {
  // The bead's headline contract: analyst-audience tools cannot be
  // called on raw document bytes. Pinning that the DB is never
  // touched on the rejected path is what makes this an I4 invariant
  // test, not just a status-code test.
  const { db, queries } = recordingDb({ documentExists: true });
  const dispatcher = createReaderToolDispatcher({
    registry: loadToolRegistry(),
    handlers: createEvidenceReaderToolHandlers({ db }),
  });

  const result = await dispatcher.dispatch({
    bundle_id: "document_research",
    audience: "analyst",
    tool_name: "extract_mentions",
    arguments: { document_id: SAMPLE_DOC_UUID },
  });

  assert.equal(result.ok, false);
  if (result.ok === false && result.kind === "authorization") {
    assert.equal(result.authorization.ok, false);
    if (result.authorization.ok === false) {
      assert.equal(result.authorization.reason, "audience_mismatch");
    }
  }
  assert.equal(queries.length, 0, "analyst-rejected dispatch must not touch the DB");
});

test("extract_mentions persists resolved candidates and returns mention items", async () => {
  const document = fakeDocumentRow();
  const mentionId = "22222222-2222-4222-a222-222222222222";
  const issuerId = "33333333-3333-4333-a333-333333333333";
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const insertedMentions: Record<string, unknown>[] = [];
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      queries.push({ text, values });
      if (/from documents/.test(text)) {
        return {
          rows: [document] as unknown as R[],
          command: "SELECT",
          rowCount: 1,
          oid: 0,
          fields: [],
        };
      }
      if (/^(begin|commit|rollback)$/i.test(text)) {
        return { rows: [] as R[], command: text.toUpperCase(), rowCount: null, oid: 0, fields: [] };
      }
      if (/delete from mentions/.test(text)) {
        return { rows: [] as R[], command: "DELETE", rowCount: 0, oid: 0, fields: [] };
      }
      if (/from mentions/.test(text)) {
        return {
          rows: insertedMentions as R[],
          command: "SELECT",
          rowCount: insertedMentions.length,
          oid: 0,
          fields: [],
        };
      }
      const row = {
        mention_id: mentionId,
        document_id: SAMPLE_DOC_UUID,
        subject_kind: values?.[1],
        subject_id: values?.[2],
        prominence: values?.[3],
        mention_count: values?.[4],
        confidence: values?.[5],
        created_at: new Date("2026-05-03T00:00:00.000Z"),
      };
      insertedMentions.push(row);
      return {
        rows: [row] as R[],
        command: "INSERT",
        rowCount: 1,
        oid: 0,
        fields: [],
      };
    },
  };
  const handlers = createEvidenceReaderToolHandlers({
    db,
    extractMentionCandidates: async (doc) => {
      assert.equal(doc.document_id, SAMPLE_DOC_UUID);
      return [
        {
          text: "Apple",
          prominence: "headline",
          mention_count: 2,
          confidence: 0.8,
        },
      ];
    },
    resolveMention: async (text) => {
      assert.equal(text, "Apple");
      return {
        outcome: "resolved",
        subject_ref: { kind: "issuer", id: issuerId },
        display_name: "Apple Inc.",
        confidence: 0.95,
        canonical_kind: "issuer",
      };
    },
  });

  const out = await handlers.extract_mentions({ document_id: SAMPLE_DOC_UUID });

  assert.deepEqual([...out.source_ids], [SAMPLE_SOURCE_UUID]);
  assert.deepEqual(out.items, [
    {
      mention_id: mentionId,
      document_id: SAMPLE_DOC_UUID,
      subject_ref: { kind: "issuer", id: issuerId },
      prominence: "headline",
      mention_count: 2,
      confidence: 0.8,
    },
  ]);
  assert.equal(queries.filter((query) => /insert into mentions/.test(query.text)).length, 1);
});

test("extract_mentions rejects partial mention-linking dependency wiring before querying", async () => {
  const queries: string[] = [];
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string) {
      queries.push(text);
      return { rows: [] as R[], command: "SELECT", rowCount: 0, oid: 0, fields: [] };
    },
  };
  const handlers = createEvidenceReaderToolHandlers({
    db,
    extractMentionCandidates: async () => [],
  });

  await assert.rejects(
    handlers.extract_mentions({ document_id: SAMPLE_DOC_UUID }),
    /extract_mentions requires both extractMentionCandidates and resolveMention/,
  );
  assert.equal(queries.length, 0);
});

test("extract_mentions links and deletes stale mentions in one transaction", async () => {
  const mentionId = "22222222-2222-4222-a222-222222222222";
  const issuerId = "33333333-3333-4333-a333-333333333333";
  const queries: string[] = [];
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      queries.push(text);
      if (/from documents/.test(text)) {
        return { rows: [fakeDocumentRow()] as unknown as R[], command: "SELECT", rowCount: 1, oid: 0, fields: [] };
      }
      if (/^begin$/i.test(text) || /^commit$/i.test(text)) {
        return { rows: [] as R[], command: text.toUpperCase(), rowCount: null, oid: 0, fields: [] };
      }
      if (/insert into mentions/.test(text)) {
        return {
          rows: [{
            mention_id: mentionId,
            document_id: SAMPLE_DOC_UUID,
            subject_kind: values?.[1],
            subject_id: values?.[2],
            prominence: values?.[3],
            mention_count: values?.[4],
            confidence: values?.[5],
            created_at: new Date("2026-05-03T00:00:00.000Z"),
          }] as R[],
          command: "INSERT",
          rowCount: 1,
          oid: 0,
          fields: [],
        };
      }
      if (/delete from mentions/.test(text)) {
        return { rows: [] as R[], command: "DELETE", rowCount: 0, oid: 0, fields: [] };
      }
      if (/from mentions/.test(text)) {
        return {
          rows: [{
            mention_id: mentionId,
            document_id: SAMPLE_DOC_UUID,
            subject_kind: "issuer",
            subject_id: issuerId,
            prominence: "headline",
            mention_count: 1,
            confidence: 0.8,
            created_at: new Date("2026-05-03T00:00:00.000Z"),
          }] as R[],
          command: "SELECT",
          rowCount: 1,
          oid: 0,
          fields: [],
        };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
  const handlers = createEvidenceReaderToolHandlers({
    db,
    extractMentionCandidates: async () => [
      { text: "Apple", prominence: "headline", mention_count: 1, confidence: 0.8 },
    ],
    resolveMention: async () => ({
      outcome: "resolved",
      subject_ref: { kind: "issuer", id: issuerId },
      display_name: "Apple Inc.",
      confidence: 0.9,
      canonical_kind: "issuer",
    }),
  });

  await handlers.extract_mentions({ document_id: SAMPLE_DOC_UUID });

  const beginIndex = queries.findIndex((query) => /^begin$/i.test(query));
  const insertIndex = queries.findIndex((query) => /insert into mentions/.test(query));
  const deleteIndex = queries.findIndex((query) => /delete from mentions/.test(query));
  const commitIndex = queries.findIndex((query) => /^commit$/i.test(query));
  assert.ok(beginIndex >= 0);
  assert.ok(beginIndex < insertIndex);
  assert.ok(insertIndex < deleteIndex);
  assert.ok(deleteIndex < commitIndex);
});

test("extract_mentions rolls back when stale mention deletion fails", async () => {
  const issuerId = "33333333-3333-4333-a333-333333333333";
  const queries: string[] = [];
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      queries.push(text);
      if (/from documents/.test(text)) {
        return { rows: [fakeDocumentRow()] as unknown as R[], command: "SELECT", rowCount: 1, oid: 0, fields: [] };
      }
      if (/^begin$/i.test(text) || /^rollback$/i.test(text)) {
        return { rows: [] as R[], command: text.toUpperCase(), rowCount: null, oid: 0, fields: [] };
      }
      if (/insert into mentions/.test(text)) {
        return {
          rows: [{
            mention_id: "22222222-2222-4222-a222-222222222222",
            document_id: SAMPLE_DOC_UUID,
            subject_kind: values?.[1],
            subject_id: values?.[2],
            prominence: values?.[3],
            mention_count: values?.[4],
            confidence: values?.[5],
            created_at: new Date("2026-05-03T00:00:00.000Z"),
          }] as R[],
          command: "INSERT",
          rowCount: 1,
          oid: 0,
          fields: [],
        };
      }
      if (/delete from mentions/.test(text)) {
        throw new Error("delete failed");
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
  const handlers = createEvidenceReaderToolHandlers({
    db,
    extractMentionCandidates: async () => [
      { text: "Apple", prominence: "headline", mention_count: 1, confidence: 0.8 },
    ],
    resolveMention: async () => ({
      outcome: "resolved",
      subject_ref: { kind: "issuer", id: issuerId },
      display_name: "Apple Inc.",
      confidence: 0.9,
      canonical_kind: "issuer",
    }),
  });

  await assert.rejects(
    handlers.extract_mentions({ document_id: SAMPLE_DOC_UUID }),
    /delete failed/,
  );
  assert.equal(queries.some((query) => /^rollback$/i.test(query)), true);
  assert.equal(queries.some((query) => /^commit$/i.test(query)), false);
});

test("extract_mentions reruns extraction and does not return stale stored mentions", async () => {
  const existingMentionId = "22222222-2222-4222-a222-222222222222";
  const newMentionId = "44444444-4444-4444-a444-444444444444";
  const existingIssuerId = "33333333-3333-4333-a333-333333333333";
  const newListingId = "55555555-5555-4555-a555-555555555555";
  let storedMentions: Record<string, unknown>[] = [
    {
      mention_id: existingMentionId,
      document_id: SAMPLE_DOC_UUID,
      subject_kind: "issuer",
      subject_id: existingIssuerId,
      prominence: "headline",
      mention_count: 1,
      confidence: 0.7,
      created_at: new Date("2026-05-03T00:00:00.000Z"),
    },
  ];
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  let extractorCalls = 0;
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      queries.push({ text, values });
      if (/from documents/.test(text)) {
        return {
          rows: [fakeDocumentRow()] as unknown as R[],
          command: "SELECT",
          rowCount: 1,
          oid: 0,
          fields: [],
        };
      }
      if (/^(begin|commit|rollback)$/i.test(text)) {
        return { rows: [] as R[], command: text.toUpperCase(), rowCount: null, oid: 0, fields: [] };
      }
      if (/delete from mentions/.test(text)) {
        storedMentions = storedMentions.filter((mention) => mention.mention_id === newMentionId);
        return { rows: [] as R[], command: "DELETE", rowCount: 1, oid: 0, fields: [] };
      }
      if (/from mentions/.test(text)) {
        const rows = storedMentions;
        return { rows: rows as R[], command: "SELECT", rowCount: rows.length, oid: 0, fields: [] };
      }
      const row = {
        mention_id: newMentionId,
        document_id: SAMPLE_DOC_UUID,
        subject_kind: values?.[1],
        subject_id: values?.[2],
        prominence: values?.[3],
        mention_count: values?.[4],
        confidence: values?.[5],
        created_at: new Date("2026-05-03T00:00:00.000Z"),
      };
      storedMentions.push(row);
      return {
        rows: [row] as R[],
        command: "INSERT",
        rowCount: 1,
        oid: 0,
        fields: [],
      };
    },
  };
  const handlers = createEvidenceReaderToolHandlers({
    db,
    extractMentionCandidates: async () => {
      extractorCalls += 1;
      return [{ text: "AAPL", prominence: "body", mention_count: 1, confidence: 0.8 }];
    },
    resolveMention: async () => ({
      outcome: "resolved",
      subject_ref: { kind: "listing", id: newListingId },
      display_name: "AAPL",
      confidence: 0.9,
      canonical_kind: "listing",
    }),
  });

  const out = await handlers.extract_mentions({ document_id: SAMPLE_DOC_UUID });

  assert.equal(extractorCalls, 1);
  assert.equal(queries.filter((query) => /insert into mentions/.test(query.text)).length, 1);
  assert.equal(queries.filter((query) => /delete from mentions/.test(query.text)).length, 1);
  assert.deepEqual(out.items.map((item) => item.mention_id), [newMentionId]);
});

test("extract_mentions returns skipped ambiguous candidates as observable items", async () => {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      queries.push({ text, values });
      if (/from documents/.test(text)) {
        return {
          rows: [fakeDocumentRow()] as unknown as R[],
          command: "SELECT",
          rowCount: 1,
          oid: 0,
          fields: [],
        };
      }
      if (/^(begin|commit|rollback)$/i.test(text)) {
        return { rows: [] as R[], command: text.toUpperCase(), rowCount: null, oid: 0, fields: [] };
      }
      if (/delete from mentions/.test(text)) {
        return { rows: [] as R[], command: "DELETE", rowCount: 0, oid: 0, fields: [] };
      }
      if (/from mentions/.test(text)) {
        return { rows: [] as R[], command: "SELECT", rowCount: 0, oid: 0, fields: [] };
      }
      throw new Error("skipped candidate must not insert a mention row");
    },
  };
  const handlers = createEvidenceReaderToolHandlers({
    db,
    extractMentionCandidates: async () => [
      { text: "Apple", prominence: "headline", mention_count: 1, confidence: 0.8 },
    ],
    resolveMention: async () => ({
      outcome: "ambiguous",
      ambiguity_axis: "issuer_vs_listing",
      candidates: [
        {
          subject_ref: { kind: "issuer", id: "33333333-3333-4333-a333-333333333333" },
          display_name: "Apple Inc.",
          confidence: 0.8,
        },
        {
          subject_ref: { kind: "listing", id: "55555555-5555-4555-a555-555555555555" },
          display_name: "AAPL",
          confidence: 0.7,
        },
      ],
    }),
  });

  const out = await handlers.extract_mentions({ document_id: SAMPLE_DOC_UUID });

  assert.deepEqual(out.items, [
    {
      item_type: "skipped_mention",
      text: "Apple",
      reason: "ambiguous",
      resolver_envelope: {
        outcome: "ambiguous",
        ambiguity_axis: "issuer_vs_listing",
        candidates: [
          {
            subject_ref: { kind: "issuer", id: "33333333-3333-4333-a333-333333333333" },
            display_name: "Apple Inc.",
            confidence: 0.8,
          },
          {
            subject_ref: { kind: "listing", id: "55555555-5555-4555-a555-555555555555" },
            display_name: "AAPL",
            confidence: 0.7,
          },
        ],
      },
    },
  ]);
});

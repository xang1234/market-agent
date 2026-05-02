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

import test from "node:test";
import assert from "node:assert/strict";
import type { QueryResult } from "pg";

import { readerQuestionProducer, READER_TOOL_NAME } from "../src/reader-question-column.ts";
import { hashJsonValue } from "../../observability/src/tool-call.ts";
import type { GridColumnContext, GridColumnDeps, ReaderColumnDeps } from "../src/column-catalog.ts";

// ─── Fixed UUIDs (valid v4: third group [89abAB]xxx) ─────────────────────────
const ISSUER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SNAPSHOT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SOURCE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const DOC_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const CLAIM_ID = "ffffffff-ffff-4fff-afff-ffffffffffff";
const TOOL_CALL_ID = "11111111-1111-4111-a111-111111111111";

const AS_OF = "2026-06-11T00:00:00.000Z";

// ─── Fake db builder ──────────────────────────────────────────────────────────
// Routes by SQL text; call makeRows to configure what each route returns.
type RowFactory = { rows: unknown[] };

function makeDb(
  routes: Record<string, RowFactory>,
): GridColumnDeps["db"] {
  return {
    async query<R extends Record<string, unknown>>(
      text: string,
      _values?: unknown[],
    ): Promise<QueryResult<R>> {
      for (const [fragment, route] of Object.entries(routes)) {
        if (text.includes(fragment)) {
          return {
            rows: route.rows as R[],
            rowCount: route.rows.length,
            command: "",
            oid: 0,
            fields: [],
          };
        }
      }
      return { rows: [] as R[], rowCount: 0, command: "", oid: 0, fields: [] };
    },
  };
}

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function docRow() {
  return {
    document_id: DOC_ID,
    source_id: SOURCE_ID,
    raw_blob_id: "blob-001",
    doc_kind: "filing",
    published_at: "2026-06-01T00:00:00.000Z",
    created_at: "2026-06-01T00:00:00.000Z",
  };
}

function claimRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    claim_id: CLAIM_ID,
    document_id: DOC_ID,
    predicate: "revenue_growth",
    text_canonical: "Revenue grew 10% YoY.",
    polarity: "positive",
    modality: "asserted",
    reported_by_source_id: SOURCE_ID,
    attributed_to_type: null,
    attributed_to_id: null,
    effective_time: null,
    confidence: 0.9,
    status: "extracted",
    created_at: "2026-06-11T00:00:00.000Z",
    updated_at: "2026-06-11T00:00:00.000Z",
    ...overrides,
  };
}

// What the real writeToolCallLog would persist for the happy-path tool result:
// the canonical hashJsonValue of {answer, claim_ids}, echoed back via RETURNING.
const EXPECTED_RESULT_HASH = hashJsonValue({
  answer: "Revenue grew 10% YoY.",
  claim_ids: [CLAIM_ID],
});

function toolCallLogRow(resultHash: string | null = EXPECTED_RESULT_HASH) {
  return {
    tool_call_id: TOOL_CALL_ID,
    created_at: new Date("2026-06-11T00:00:00.000Z"),
    result_hash: resultHash,
  };
}

function validLlmAnswer(docId = DOC_ID) {
  return JSON.stringify({
    answer: "Revenue grew 10% YoY.",
    claims: [
      {
        document_id: docId,
        predicate: "revenue_growth",
        text_canonical: "Revenue grew 10% YoY.",
        polarity: "positive",
        modality: "asserted",
        confidence: 0.9,
      },
    ],
    not_discussed: false,
  });
}

function makeReader(opts: {
  llmText?: string;
  blobText?: string | null;
  deployment?: { channel: string; model: string };
}): ReaderColumnDeps {
  return {
    llm: {
      async complete() {
        return { text: opts.llmText ?? validLlmAnswer(), deployment: opts.deployment };
      },
    },
    loadDocumentText: async (_blobId: string) => opts.blobText ?? "Some document text.",
  };
}

function happyDb() {
  return makeDb({
    "from mentions": { rows: [docRow()] },
    "insert into claims": { rows: [claimRow()] },
    "insert into tool_call_logs": { rows: [toolCallLogRow()] },
  });
}

function baseCtx(overrides: Partial<GridColumnContext> = {}): GridColumnContext {
  return {
    subject: { kind: "issuer", id: ISSUER_ID },
    period: null,
    snapshotId: SNAPSHOT_ID,
    asOf: AS_OF,
    userId: USER_ID,
    params: { prompt: "Any revenue growth?" },
    ...overrides,
  };
}

// ─── Test 1: happy path ───────────────────────────────────────────────────────
test("reader_question — happy path: ok status, display.value, primaryRef claim, sealed manifest", async () => {
  const db = happyDb();
  const reader = makeReader({});
  const result = await readerQuestionProducer({ db, reader }, baseCtx());

  assert.equal(result.status, "ok");
  assert.equal(result.display.value, "Revenue grew 10% YoY.");
  assert.equal(result.primaryRef?.kind, "claim");
  assert.equal(result.primaryRef?.id, CLAIM_ID);
  assert.ok(result.seal, "expected a seal input");

  const { manifest } = result.seal!;
  // claim_refs
  assert.deepEqual([...manifest.claim_refs], [CLAIM_ID]);
  // document_refs
  assert.deepEqual([...manifest.document_refs], [DOC_ID]);
  // tool_call_ids
  assert.deepEqual([...manifest.tool_call_ids], [TOOL_CALL_ID]);

  // tool_call_result_hashes[0].result_hash starts with "sha256:"
  const hashes = [...manifest.tool_call_result_hashes] as Array<{
    tool_call_id: string;
    result_hash: string;
  }>;
  assert.equal(hashes.length, 1);
  assert.ok(
    hashes[0].result_hash.startsWith("sha256:"),
    `result_hash must start with "sha256:", got: ${hashes[0].result_hash}`,
  );

  // The manifest carries the hash returned by writeToolCallLog verbatim — the
  // producer never re-hashes (hashing is tested in services/observability).
  assert.equal(hashes[0].result_hash, EXPECTED_RESULT_HASH);
});

test("reader_question — tool call log returning no result_hash rejects", async () => {
  const db = makeDb({
    "from mentions": { rows: [docRow()] },
    "insert into claims": { rows: [claimRow()] },
    "insert into tool_call_logs": { rows: [toolCallLogRow(null)] },
  });
  const reader = makeReader({});
  await assert.rejects(
    () => readerQuestionProducer({ db, reader }, baseCtx()),
    /no result_hash/,
  );
});

// ─── Test 2: non-issuer subject → no_coverage "issuer_only" ──────────────────
test("reader_question — non-issuer subject returns no_coverage / issuer_only", async () => {
  const db = happyDb();
  const reader = makeReader({});
  const result = await readerQuestionProducer(
    { db, reader },
    baseCtx({ subject: { kind: "instrument", id: ISSUER_ID } }),
  );

  assert.equal(result.status, "no_coverage");
  assert.equal(result.coverageFlag, "issuer_only");
  assert.equal(result.seal, undefined);
});

// ─── Test 3: no eligible documents → no_coverage "no_documents" ──────────────
test("reader_question — no documents returns no_coverage / no_documents", async () => {
  const db = makeDb({
    "from mentions": { rows: [] },
    "insert into claims": { rows: [] },
    "insert into tool_call_logs": { rows: [] },
  });
  const reader = makeReader({});
  const result = await readerQuestionProducer({ db, reader }, baseCtx());

  assert.equal(result.status, "no_coverage");
  assert.equal(result.coverageFlag, "no_documents");
  assert.equal(result.seal, undefined);
});

// ─── Test 4: docs found but all text is null/empty → no_coverage "no_document_text" ──
test("reader_question — all document texts null/empty returns no_coverage / no_document_text", async () => {
  const db = makeDb({
    "from mentions": { rows: [docRow()] },
    "insert into claims": { rows: [] },
    "insert into tool_call_logs": { rows: [] },
  });
  // loadDocumentText always returns null
  const reader: ReaderColumnDeps = {
    llm: { async complete() { return { text: "" }; } },
    loadDocumentText: async () => null,
  };
  const result = await readerQuestionProducer({ db, reader }, baseCtx());

  assert.equal(result.status, "no_coverage");
  assert.equal(result.coverageFlag, "no_document_text");
  assert.equal(result.seal, undefined);
});

test("reader_question — all document texts whitespace-only returns no_coverage / no_document_text", async () => {
  const db = makeDb({
    "from mentions": { rows: [docRow()] },
    "insert into claims": { rows: [] },
    "insert into tool_call_logs": { rows: [] },
  });
  const reader: ReaderColumnDeps = {
    llm: { async complete() { return { text: "" }; } },
    loadDocumentText: async () => "   \n   ",
  };
  const result = await readerQuestionProducer({ db, reader }, baseCtx());

  assert.equal(result.status, "no_coverage");
  assert.equal(result.coverageFlag, "no_document_text");
});

// ─── Test 5: not_discussed response → missing_data "no_relevant_claims" ──────
test("reader_question — not_discussed LLM response returns missing_data / no_relevant_claims", async () => {
  const db = makeDb({
    "from mentions": { rows: [docRow()] },
    "insert into claims": { rows: [] },
    "insert into tool_call_logs": { rows: [] },
  });
  const reader = makeReader({
    llmText: JSON.stringify({ answer: "", claims: [], not_discussed: true }),
  });
  const result = await readerQuestionProducer({ db, reader }, baseCtx());

  assert.equal(result.status, "missing_data");
  assert.equal(result.coverageFlag, "no_relevant_claims");
  assert.equal(result.seal, undefined);
});

// ─── Test 6a: missing reader deps → rejects ───────────────────────────────────
test("reader_question — missing reader deps rejects with descriptive error", async () => {
  const db = happyDb();
  await assert.rejects(
    () => readerQuestionProducer({ db }, baseCtx()),
    /reader deps not configured/,
  );
});

// ─── Test 6b: invalid params → rejects via the shared parser ─────────────────
// Run-time enforcement mirrors create-time validateColumnSpecs exactly: both
// call parseReaderQuestionParams.
test("reader_question — missing params.prompt rejects", async () => {
  const db = happyDb();
  const reader = makeReader({});
  await assert.rejects(
    () => readerQuestionProducer({ db, reader }, baseCtx({ params: null })),
    /requires params\.prompt/,
  );
});

test("reader_question — blank params.prompt rejects", async () => {
  const db = happyDb();
  const reader = makeReader({});
  await assert.rejects(
    () => readerQuestionProducer({ db, reader }, baseCtx({ params: { prompt: "   " } })),
    /must be 8-300 characters/,
  );
});

test("reader_question — non-string params.prompt rejects", async () => {
  const db = happyDb();
  const reader = makeReader({});
  await assert.rejects(
    () =>
      readerQuestionProducer({ db, reader }, baseCtx({ params: { prompt: 42 } })),
    /requires params\.prompt/,
  );
});

// ─── Test 7: malformed LLM JSON → propagates (throws) ────────────────────────
test("reader_question — malformed LLM JSON propagates as rejection", async () => {
  const db = makeDb({
    "from mentions": { rows: [docRow()] },
    "insert into claims": { rows: [] },
    "insert into tool_call_logs": { rows: [] },
  });
  const reader = makeReader({ llmText: "not valid json at all" });
  await assert.rejects(() => readerQuestionProducer({ db, reader }, baseCtx()));
});

test("reader_question — LLM JSON with unknown claim document_id propagates as rejection", async () => {
  const db = makeDb({
    "from mentions": { rows: [docRow()] },
    "insert into claims": { rows: [] },
    "insert into tool_call_logs": { rows: [] },
  });
  const badJson = JSON.stringify({
    answer: "ok",
    claims: [
      {
        document_id: "99999999-9999-4999-a999-999999999999",
        predicate: "p",
        text_canonical: "t",
        polarity: "neutral",
        modality: "asserted",
        confidence: 0.5,
      },
    ],
    not_discussed: false,
  });
  const reader = makeReader({ llmText: badJson });
  await assert.rejects(
    () => readerQuestionProducer({ db, reader }, baseCtx()),
    /unknown document_id/,
  );
});

// ─── Test: seal carries model_version from deployment ────────────────────────
test("reader_question — deployment model is surfaced in manifest model_version", async () => {
  const db = happyDb();
  const reader = makeReader({ deployment: { channel: "prod", model: "claude-3-7-sonnet" } });
  const result = await readerQuestionProducer({ db, reader }, baseCtx());

  assert.equal(result.status, "ok");
  assert.equal(result.seal?.manifest.model_version, "reader:claude-3-7-sonnet");
});

test("reader_question — no deployment yields null model_version", async () => {
  const db = happyDb();
  const reader = makeReader({ deployment: undefined });
  const result = await readerQuestionProducer({ db, reader }, baseCtx());

  assert.equal(result.status, "ok");
  assert.equal(result.seal?.manifest.model_version, null);
});

// ─── Test: tool_name in the manifest tool_call_ids ────────────────────────────
test("reader_question — READER_TOOL_NAME constant is 'grid_reader_question'", () => {
  assert.equal(READER_TOOL_NAME, "grid_reader_question");
});

// ─── fra-iuv9: retry once on truncated (provider-cut) LLM JSON ────────────────
// An LLM that returns the given texts in order (repeating the last), counting calls —
// lets a test return a truncated response first and a complete one on the retry.
function makeReaderSeq(texts: string[]): { reader: ReaderColumnDeps; calls: () => number } {
  let i = 0;
  const reader: ReaderColumnDeps = {
    llm: {
      async complete() {
        const text = texts[Math.min(i, texts.length - 1)]!;
        i += 1;
        return { text };
      },
    },
    loadDocumentText: async () => "Some document text.",
  };
  return { reader, calls: () => i };
}

// JSON cut mid-string (the provider-side truncation symptom): JSON.parse → SyntaxError.
const TRUNCATED_JSON = '{"answer": "Revenue grew 10% YoY.", "claims": [{"document_id": "incomplete';

test("reader_question — retries once and succeeds when the first response is truncated", async () => {
  const { reader, calls } = makeReaderSeq([TRUNCATED_JSON, validLlmAnswer()]);
  const result = await readerQuestionProducer({ db: happyDb(), reader }, baseCtx());
  assert.equal(result.status, "ok", "the retry's complete response parses");
  assert.equal(calls(), 2, "exactly one retry");
});

test("reader_question — does NOT retry a deterministic shape/validation error", async () => {
  // Valid JSON, but missing the answer field — a temp-0 model would return it again, so
  // retrying only wastes a call. Bubbles immediately.
  const { reader, calls } = makeReaderSeq(['{"claims": []}', validLlmAnswer()]);
  await assert.rejects(() => readerQuestionProducer({ db: happyDb(), reader }, baseCtx()), /missing answer/);
  assert.equal(calls(), 1, "no retry on a non-syntax (deterministic) parse failure");
});

test("reader_question — a persistently truncated response fails after one retry", async () => {
  const { reader, calls } = makeReaderSeq([TRUNCATED_JSON]); // every attempt truncated
  await assert.rejects(() => readerQuestionProducer({ db: happyDb(), reader }, baseCtx()));
  assert.equal(calls(), 2, "two attempts, then give up → error cell");
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  sealSnapshot,
  sealSnapshotWithPool,
  snapshotTransactionClient,
} from "../src/snapshot-sealer.ts";
import type { QueryExecutor, SnapshotManifestDraft } from "../src/manifest-staging.ts";

const snapshotId = "00000000-0000-4000-8000-000000000001";
const listingId = "00000000-0000-4000-8000-000000000002";
const documentId = "00000000-0000-4000-8000-000000000003";
const sourceId = "00000000-0000-4000-8000-000000000004";
const toolCallId = "00000000-0000-4000-8000-000000000005";
const extraToolCallId = "00000000-0000-4000-8000-000000000006";

const manifest: SnapshotManifestDraft = Object.freeze({
  subject_refs: Object.freeze([{ kind: "listing", id: listingId }]),
  fact_refs: Object.freeze([]),
  claim_refs: Object.freeze([]),
  event_refs: Object.freeze([]),
  document_refs: Object.freeze([documentId]),
  series_specs: Object.freeze([]),
  source_ids: Object.freeze([sourceId]),
  tool_call_ids: Object.freeze([toolCallId]),
  tool_call_result_hashes: Object.freeze([
    Object.freeze({ tool_call_id: toolCallId, result_hash: `sha256:${"1".repeat(64)}` }),
  ]),
  as_of: "2026-04-29T00:00:00.000Z",
  basis: "split_adjusted",
  normalization: "raw",
  coverage_start: "2026-04-01T00:00:00.000Z",
  allowed_transforms: Object.freeze({
    series: Object.freeze([
      Object.freeze({
        range: Object.freeze({
          start: "2026-04-01T00:00:00Z",
          end: "2026-04-29T00:00:00Z",
        }),
        interval: "1d",
      }),
    ]),
  }),
  model_version: "snapshot-test-v1",
  parent_snapshot: null,
});

test("sealSnapshot persists a verified snapshot inside one transaction", async () => {
  const { db, queries } = recordingDb();

  const result = await sealSnapshot(snapshotTransactionClient(db), validSealInput());

  assert.equal(result.ok, true);
  assert.equal(result.snapshot.snapshot_id, snapshotId);
  assert.deepEqual(queries.map((query) => normalizedSql(query.text)), [
    "select from tool_call_logs",
    "begin",
    "insert into snapshots",
    "commit",
  ]);
  assert.match(queries[2].text, /\bdocument_refs\b/);
  assert.match(queries[2].text, /\btool_call_result_hashes\b/);
  assert.deepEqual(jsonValueAt(queries[2].values, 5), [documentId]);
  assert.deepEqual(jsonValueAt(queries[2].values, 6), []);
  assert.deepEqual(jsonValueAt(queries[2].values, 9), [
    { tool_call_id: toolCallId, result_hash: `sha256:${"1".repeat(64)}` },
  ]);
});

test("sealSnapshot rejects missing tool-call audit rows before starting a transaction", async () => {
  const { db, queries } = recordingDb({ toolCallRows: [] });

  const result = await sealSnapshot(snapshotTransactionClient(db), validSealInput());

  assert.equal(result.ok, false);
  assert.equal(result.verification.failures[0]?.reason_code, "tool_call_log_audit_failed");
  assert.deepEqual(result.verification.failures[0]?.details, {
    missing_tool_call_ids: [toolCallId],
    mismatched_tool_call_ids: [],
    extra_tool_call_ids: [],
    duplicate_tool_call_ids: [],
    missing_hash_tool_call_ids: [],
    missing_provenance: false,
  });
  assert.deepEqual(queries.map((query) => normalizedSql(query.text)), [
    "select from tool_call_logs",
    "insert into verifier_fail_logs",
  ]);
});

test("sealSnapshot rejects extra and duplicate tool-call result hashes before starting a transaction", async () => {
  const { db, queries } = recordingDb();

  const result = await sealSnapshot(snapshotTransactionClient(db), {
    ...validSealInput(),
    manifest: {
      ...manifest,
      tool_call_result_hashes: [
        { tool_call_id: toolCallId, result_hash: `sha256:${"1".repeat(64)}` },
        { tool_call_id: toolCallId, result_hash: `sha256:${"1".repeat(64)}` },
        { tool_call_id: extraToolCallId, result_hash: `sha256:${"2".repeat(64)}` },
      ],
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.verification.failures[0]?.reason_code, "tool_call_log_audit_failed");
  assert.deepEqual(result.verification.failures[0]?.details, {
    missing_tool_call_ids: [],
    mismatched_tool_call_ids: [],
    extra_tool_call_ids: [extraToolCallId],
    duplicate_tool_call_ids: [toolCallId],
    missing_hash_tool_call_ids: [],
    missing_provenance: false,
  });
  assert.deepEqual(queries.map((query) => normalizedSql(query.text)), [
    "select from tool_call_logs",
    "insert into verifier_fail_logs",
  ]);
});

test("sealSnapshot rejects missing tool-call result hashes before starting a transaction", async () => {
  const { db, queries } = recordingDb();

  const result = await sealSnapshot(snapshotTransactionClient(db), {
    ...validSealInput(),
    manifest: {
      ...manifest,
      tool_call_result_hashes: [],
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.verification.failures[0]?.reason_code, "tool_call_log_audit_failed");
  assert.deepEqual(result.verification.failures[0]?.details, {
    missing_tool_call_ids: [],
    mismatched_tool_call_ids: [],
    extra_tool_call_ids: [],
    duplicate_tool_call_ids: [],
    missing_hash_tool_call_ids: [toolCallId],
    missing_provenance: false,
  });
  assert.deepEqual(queries.map((query) => normalizedSql(query.text)), [
    "select from tool_call_logs",
    "insert into verifier_fail_logs",
  ]);
});

test("sealSnapshot rejects evidence refs without tool-call provenance before starting a transaction", async () => {
  const { db, queries } = recordingDb();

  const result = await sealSnapshot(snapshotTransactionClient(db), {
    ...validSealInput(),
    manifest: {
      ...manifest,
      tool_call_ids: [],
      tool_call_result_hashes: [],
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.verification.failures[0]?.reason_code, "tool_call_log_audit_failed");
  assert.deepEqual(result.verification.failures[0]?.details, {
    missing_tool_call_ids: [],
    mismatched_tool_call_ids: [],
    extra_tool_call_ids: [],
    duplicate_tool_call_ids: [],
    missing_hash_tool_call_ids: [],
    missing_provenance: true,
  });
  assert.deepEqual(queries.map((query) => normalizedSql(query.text)), [
    "insert into verifier_fail_logs",
  ]);
});

test("sealSnapshot rolls back when persistence fails after transaction start", async () => {
  const { db, queries } = recordingDb({ failOnSnapshotInsert: true });

  await assert.rejects(
    () => sealSnapshot(snapshotTransactionClient(db), validSealInput()),
    /simulated snapshot insert crash/,
  );

  assert.deepEqual(queries.map((query) => normalizedSql(query.text)), [
    "select from tool_call_logs",
    "begin",
    "insert into snapshots",
    "rollback",
  ]);
});

test("sealSnapshot rejects malformed allowed_transforms before starting a transaction", async () => {
  const { db, queries } = recordingDb();

  const result = await sealSnapshot(snapshotTransactionClient(db), {
    ...validSealInput(),
    manifest: {
      ...manifest,
      allowed_transforms: { series: {} },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.verification.failures[0]?.reason_code, "invalid_verifier_input");
  assert.deepEqual(queries.map((query) => normalizedSql(query.text)), [
    "insert into verifier_fail_logs",
  ]);
});

test("sealSnapshot rejects omitted allowed_transforms before starting a transaction", async () => {
  const { db, queries } = recordingDb();
  const { allowed_transforms: _omitted, ...manifestWithoutTransforms } = manifest;

  const result = await sealSnapshot(snapshotTransactionClient(db), {
    ...validSealInput(),
    manifest: manifestWithoutTransforms as SnapshotManifestDraft,
  });

  assert.equal(result.ok, false);
  assert.equal(result.verification.failures[0]?.reason_code, "invalid_verifier_input");
  assert.deepEqual(queries.map((query) => normalizedSql(query.text)), [
    "insert into verifier_fail_logs",
  ]);
});

test("sealSnapshot writes verifier failure logs for rejected seals", async () => {
  const { db, queries } = recordingDb();

  const result = await sealSnapshot(snapshotTransactionClient(db), {
    ...validSealInput(),
    documents: [],
  });

  assert.equal(result.ok, false);
  assert.equal(result.verification.failures.some((failure) => failure.reason_code === "missing_document_ref"), true);
  assert.deepEqual(queries.map((query) => normalizedSql(query.text)), [
    "insert into verifier_fail_logs",
  ]);
});

test("sealSnapshot rejects unmarked executors before starting a transaction", async () => {
  const { db, queries } = recordingDb();

  await assert.rejects(
    () => sealSnapshot(db, validSealInput()),
    /requires a pinned transaction client/i,
  );

  assert.deepEqual(queries, []);
});

test("snapshotTransactionClient rejects pool-like executors before starting a transaction", () => {
  const { db, queries } = recordingDb();
  const poolLike = Object.assign(db, {
    totalCount: 0,
    async connect() {
      throw new Error("sealSnapshot must not acquire clients itself");
    },
  });

  assert.throws(
    () => snapshotTransactionClient(poolLike),
    /requires a pinned transaction client/i,
  );

  assert.deepEqual(queries, []);
});

test("snapshotTransactionClient rejects query-plus-connect pool wrappers", () => {
  const { db, queries } = recordingDb();
  const poolWrapper = Object.assign(db, {
    async connect() {
      throw new Error("sealSnapshot must not acquire clients through wrapper pools");
    },
  });

  assert.throws(
    () => snapshotTransactionClient(poolWrapper),
    /requires a pinned transaction client/i,
  );

  assert.deepEqual(queries, []);
});

test("snapshotTransactionClient rejects query-only pool wrappers before starting a transaction", () => {
  const { db, queries } = recordingDb();
  const queryOnlyWrapper = {
    query: db.query.bind(db),
  };

  assert.throws(
    () => snapshotTransactionClient(queryOnlyWrapper),
    /requires an acquired transaction client/i,
  );

  assert.deepEqual(queries, []);
});

test("sealSnapshotWithPool pins the seal transaction to one acquired client", async () => {
  const { db: client, queries } = recordingDb();
  let connectCount = 0;
  let releaseCount = 0;
  const pool = {
    async connect() {
      connectCount += 1;
      return Object.assign(client, {
        release() {
          releaseCount += 1;
        },
      });
    },
    async query() {
      throw new Error("pool.query must not be used for transaction statements");
    },
  };

  const result = await sealSnapshotWithPool(pool, validSealInput());

  assert.equal(result.ok, true);
  assert.equal(connectCount, 1);
  assert.equal(releaseCount, 1);
  assert.deepEqual(queries.map((query) => normalizedSql(query.text)), [
    "select from tool_call_logs",
    "begin",
    "insert into snapshots",
    "commit",
  ]);
});

test("sealSnapshotWithPool releases the client as broken when rollback fails", async () => {
  const { db: client } = recordingDb({
    failOnSnapshotInsert: true,
    failOnRollback: true,
  });
  let releaseError: Error | undefined;
  const pool = {
    async connect() {
      return Object.assign(client, {
        release(error?: Error) {
          releaseError = error;
        },
      });
    },
  };

  await assert.rejects(
    () => sealSnapshotWithPool(pool, validSealInput()),
    /simulated snapshot insert crash/,
  );

  assert.ok(releaseError);
  assert.match(String((releaseError as { rollback_error?: unknown }).rollback_error), /simulated rollback crash/);
});

function validSealInput() {
  return {
    snapshot_id: snapshotId,
    manifest,
    blocks: [],
    documents: [{ document_id: documentId, source_id: sourceId }],
    sources: [{ source_id: sourceId }],
  };
}

function recordingDb(
  options: {
    failOnSnapshotInsert?: boolean;
    failOnRollback?: boolean;
    toolCallRows?: Array<{ tool_call_id: string; result_hash: string | null }>;
  } = {},
) {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const toolCallRows = options.toolCallRows ?? [
    { tool_call_id: toolCallId, result_hash: `sha256:${"1".repeat(64)}` },
  ];
  const db: QueryExecutor & { release(): void } = {
    release() {
      // Test clients model an acquired pool client; release behavior is asserted
      // explicitly in sealSnapshotWithPool tests.
    },
    async query<R extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      values?: unknown[],
    ) {
      queries.push({ text, values });
      const normalized = normalizedSql(text);

      if (normalized === "rollback" && options.failOnRollback) {
        throw new Error("simulated rollback crash");
      }

      if (["begin", "commit", "rollback"].includes(normalized)) {
        return { rows: [] as R[] };
      }

      if (normalized === "select from tool_call_logs") {
        return { rows: toolCallRows as R[] };
      }

      if (normalized === "insert into snapshots") {
        if (options.failOnSnapshotInsert) {
          throw new Error("simulated snapshot insert crash");
        }

        return {
          rows: [
            {
              snapshot_id: snapshotId,
              created_at: "2026-04-29T00:00:01.000Z",
              subject_refs: jsonValueAt(values, 1),
              fact_refs: jsonValueAt(values, 2),
              claim_refs: jsonValueAt(values, 3),
              event_refs: jsonValueAt(values, 4),
              document_refs: jsonValueAt(values, 5),
              series_specs: jsonValueAt(values, 6),
              source_ids: jsonValueAt(values, 7),
              tool_call_ids: jsonValueAt(values, 8),
              tool_call_result_hashes: jsonValueAt(values, 9),
              as_of: values?.[10],
              basis: values?.[11],
              normalization: values?.[12],
              coverage_start: values?.[13],
              allowed_transforms: jsonValueAt(values, 14),
              model_version: values?.[15],
              parent_snapshot: values?.[16],
            },
          ] as R[],
        };
      }

      if (normalized === "insert into verifier_fail_logs") {
        return { rows: [] as R[] };
      }

      throw new Error(`unexpected query: ${text}`);
    },
  };
  return { db, queries };
}

function normalizedSql(text: string): string {
  const compact = text.trim().replace(/\s+/g, " ").toLowerCase();
  if (compact === "begin" || compact === "commit" || compact === "rollback") return compact;
  if (compact.startsWith("select tool_call_id::text as tool_call_id, result_hash from tool_call_logs")) {
    return "select from tool_call_logs";
  }
  if (compact.startsWith("insert into snapshots")) return "insert into snapshots";
  if (compact.startsWith("insert into verifier_fail_logs")) return "insert into verifier_fail_logs";
  return compact;
}

function jsonValueAt(values: unknown[] | undefined, index: number): unknown {
  const value = values?.[index];
  assert.equal(typeof value, "string");
  return JSON.parse(value);
}

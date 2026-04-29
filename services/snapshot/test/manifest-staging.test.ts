import assert from "node:assert/strict";
import test from "node:test";

import {
  auditManifestToolCallLog,
  stageSnapshotManifest,
  type SnapshotManifestDraft,
} from "../src/manifest-staging.ts";

const listingId = "00000000-0000-4000-8000-000000000001";
const firstFactId = "00000000-0000-4000-8000-000000000101";
const secondFactId = "00000000-0000-4000-8000-000000000102";
const claimId = "00000000-0000-4000-8000-000000000201";
const eventId = "00000000-0000-4000-8000-000000000301";
const firstSourceId = "00000000-0000-4000-8000-000000000401";
const secondSourceId = "00000000-0000-4000-8000-000000000402";
const firstToolCallId = "00000000-0000-4000-8000-000000000501";
const secondToolCallId = "00000000-0000-4000-8000-000000000502";
const threadId = "00000000-0000-4000-8000-000000000601";
const agentId = "00000000-0000-4000-8000-000000000701";

test("stageSnapshotManifest collects refs from tool-call outputs with audit ids", () => {
  const manifest = stageSnapshotManifest({
    subject_refs: [{ kind: "listing", id: listingId }],
    as_of: "2026-04-29T00:00:00Z",
    basis: "split_adjusted",
    normalization: "raw",
    coverage_start: "2026-04-01T00:00:00+00:00",
    allowed_transforms: {
      ranges: [{ start: "2026-04-01T00:00:00Z", end: "2026-04-29T00:00:00Z" }],
    },
    tool_calls: [
      {
        tool_call_id: firstToolCallId,
        subject_refs: [{ kind: "listing", id: listingId }],
        fact_refs: [firstFactId, secondFactId],
        claim_refs: [claimId],
        source_ids: [firstSourceId],
        series_specs: [
          {
            subject_ref: { kind: "listing", id: listingId },
            interval: "1d",
            range: { start: "2026-04-01T00:00:00Z", end: "2026-04-29T00:00:00Z" },
          },
        ],
      },
      {
        tool_call_id: secondToolCallId,
        fact_refs: [firstFactId],
        event_refs: [eventId],
        source_ids: [firstSourceId, secondSourceId],
        series_specs: [
          {
            range: { end: "2026-04-29T00:00:00Z", start: "2026-04-01T00:00:00Z" },
            interval: "1d",
            subject_ref: { id: listingId, kind: "listing" },
          },
        ],
      },
    ],
  });

  assert.deepEqual(manifest, {
    subject_refs: [{ kind: "listing", id: listingId }],
    fact_refs: [firstFactId, secondFactId],
    claim_refs: [claimId],
    event_refs: [eventId],
    series_specs: [
      {
        subject_ref: { kind: "listing", id: listingId },
        interval: "1d",
        range: { start: "2026-04-01T00:00:00Z", end: "2026-04-29T00:00:00Z" },
      },
    ],
    source_ids: [firstSourceId, secondSourceId],
    tool_call_ids: [firstToolCallId, secondToolCallId],
    as_of: "2026-04-29T00:00:00.000Z",
    basis: "split_adjusted",
    normalization: "raw",
    coverage_start: "2026-04-01T00:00:00.000Z",
    allowed_transforms: {
      ranges: [{ start: "2026-04-01T00:00:00Z", end: "2026-04-29T00:00:00Z" }],
    },
    model_version: null,
    parent_snapshot: null,
  } satisfies SnapshotManifestDraft);
});

test("stageSnapshotManifest rejects referenced manifest content without a valid tool_call_id", () => {
  assert.throws(
    () =>
      stageSnapshotManifest({
        subject_refs: [{ kind: "listing", id: listingId }],
        as_of: "2026-04-29T00:00:00Z",
        basis: "reported",
        normalization: "raw",
        tool_calls: [{ tool_call_id: "", fact_refs: [firstFactId] }],
      }),
    /tool_call_id: must be a UUID v4/,
  );
});

test("stageSnapshotManifest rejects subject refs with non-UUID ids", () => {
  assert.throws(
    () =>
      stageSnapshotManifest({
        subject_refs: [{ kind: "listing", id: "XNAS:AAPL" }],
        as_of: "2026-04-29T00:00:00Z",
        basis: "reported",
        normalization: "raw",
        tool_calls: [],
      }),
    /subject_refs\[0\]\.id: must be a UUID v4/,
  );
});

test("stageSnapshotManifest rejects non-array subject refs with a clear error", () => {
  assert.throws(
    () =>
      stageSnapshotManifest({
        subject_refs: null,
        as_of: "2026-04-29T00:00:00Z",
        basis: "reported",
        normalization: "raw",
        tool_calls: [],
      } as never),
    /subject_refs: must be an array/,
  );
});

test("auditManifestToolCallLog reports missing staged tool calls", async () => {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const db = {
    async query<R extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      values?: unknown[],
    ) {
      queries.push({ text, values });
      return {
        rows: [{ tool_call_id: firstToolCallId }] as R[],
        rowCount: 1,
        command: "SELECT",
        oid: 0,
        fields: [],
      };
    },
  };

  const result = await auditManifestToolCallLog(db, {
    tool_call_ids: [firstToolCallId, secondToolCallId],
  });

  assert.deepEqual(result, {
    ok: false,
    missing_tool_call_ids: [secondToolCallId],
  });
  assert.match(queries[0].text, /tool_call_logs/);
  assert.deepEqual(queries[0].values, [
    [firstToolCallId, secondToolCallId],
    ["ok"],
  ]);
});

test("auditManifestToolCallLog scopes audit to successful thread and agent calls", async () => {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const db = {
    async query<R extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      values?: unknown[],
    ) {
      queries.push({ text, values });
      return {
        rows: [{ tool_call_id: firstToolCallId }] as R[],
        rowCount: 1,
        command: "SELECT",
        oid: 0,
        fields: [],
      };
    },
  };

  const result = await auditManifestToolCallLog(
    db,
    { tool_call_ids: [firstToolCallId, secondToolCallId] },
    { thread_id: threadId, agent_id: agentId },
  );

  assert.deepEqual(result, {
    ok: false,
    missing_tool_call_ids: [secondToolCallId],
  });
  assert.match(queries[0].text, /status = any\(\$2::text\[\]\)/);
  assert.match(queries[0].text, /thread_id = \$3::uuid/);
  assert.match(queries[0].text, /agent_id = \$4::uuid/);
  assert.deepEqual(queries[0].values, [
    [firstToolCallId, secondToolCallId],
    ["ok"],
    threadId,
    agentId,
  ]);
});

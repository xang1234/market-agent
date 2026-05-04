import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult } from "pg";

import {
  FindingGenerationValidationError,
  generateFinding,
  type GenerateFindingInput,
} from "../src/finding-generator.ts";

const FINDING_ID = "11111111-1111-4111-8111-111111111111";
const AGENT_ID = "22222222-2222-4222-8222-222222222222";
const SNAPSHOT_ID = "33333333-3333-4333-8333-333333333333";
const SUBJECT_ID = "44444444-4444-4444-8444-444444444444";
const CLAIM_CLUSTER_ID = "55555555-5555-4555-8555-555555555555";
const SOURCE_ID = "66666666-6666-4666-8666-666666666666";
const CREATED_AT = "2026-05-04T00:00:00.000Z";

type Captured = { text: string; values?: unknown[] };

type QueryExecutor = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
};

function fakeDb(
  responder: (text: string, values?: unknown[]) => unknown[],
): { db: QueryExecutor; queries: Captured[] } {
  const queries: Captured[] = [];
  return {
    queries,
    db: {
      async query<R extends Record<string, unknown> = Record<string, unknown>>(
        text: string,
        values?: unknown[],
      ): Promise<QueryResult<R>> {
        queries.push({ text, values });
        return { rows: responder(text, values) as R[], rowCount: 1, command: "", oid: 0, fields: [] };
      },
    },
  };
}

function validInput(overrides: Partial<GenerateFindingInput> = {}): GenerateFindingInput {
  return {
    finding_id: FINDING_ID,
    agent_id: AGENT_ID,
    snapshot_id: SNAPSHOT_ID,
    snapshot_manifest: {
      snapshot_id: SNAPSHOT_ID,
      source_ids: [SOURCE_ID],
      as_of: CREATED_AT,
    },
    subject_refs: [{ kind: "issuer", id: SUBJECT_ID }],
    claim_cluster_ids: [CLAIM_CLUSTER_ID],
    headline: "Primary evidence supports near-term demand impact",
    severity_input: {
      evidence: {
        trust_tier: "primary",
        corroborating_source_count: 2,
        confidence: 0.9,
      },
      impact: {
        direction: "positive",
        channel: "demand",
        horizon: "near_term",
        confidence: 0.9,
      },
      thesis_relevance: 0.8,
    },
    source_refs: [SOURCE_ID],
    ...overrides,
  };
}

test("generateFinding scores, builds summary blocks, and inserts a snapshot-bound finding", async () => {
  const { db, queries } = fakeDb((_text, values) => [
    {
      finding_id: FINDING_ID,
      agent_id: values?.[1],
      snapshot_id: values?.[2],
      subject_refs: JSON.parse(values?.[3] as string),
      claim_cluster_ids: JSON.parse(values?.[4] as string),
      severity: values?.[5],
      headline: values?.[6],
      summary_blocks: JSON.parse(values?.[7] as string),
      created_at: CREATED_AT,
    },
  ]);

  const row = await generateFinding(db, validInput());

  assert.equal(row.finding_id, FINDING_ID);
  assert.equal(row.snapshot_id, SNAPSHOT_ID);
  assert.equal(row.severity, "high");
  assert.equal(row.summary_blocks[0].kind, "finding_card");
  assert.equal(row.summary_blocks[0].data_ref.kind, "finding_card");
  assert.equal(row.summary_blocks[0].snapshot_id, SNAPSHOT_ID);
  assert.equal(row.summary_blocks[0].finding_id, FINDING_ID);
  assert.equal(Object.isFrozen(row), true);
  assert.match(queries[0].text, /insert into findings/);
  assert.match(queries[0].text, /snapshot_id/);
  assert.equal(queries[0].values?.[0], FINDING_ID);
  assert.equal(queries[0].values?.[1], AGENT_ID);
  assert.equal(queries[0].values?.[2], SNAPSHOT_ID);
  assert.equal(queries[0].values?.[5], "high");
});

test("generateFinding rejects invalid input before issuing SQL", async () => {
  const { db, queries } = fakeDb(() => []);

  await assert.rejects(
    generateFinding(db, validInput({ snapshot_id: "not-a-uuid" })),
    (error: Error) =>
      error instanceof FindingGenerationValidationError && /snapshot_id.*UUID/.test(error.message),
  );

  await assert.rejects(
    generateFinding(db, validInput({ headline: "" })),
    (error: Error) =>
      error instanceof FindingGenerationValidationError && /headline/.test(error.message),
  );

  assert.equal(queries.length, 0);
});

test("generateFinding rejects source refs and as_of values outside the sealed snapshot manifest", async () => {
  const { db, queries } = fakeDb(() => []);

  await assert.rejects(
    generateFinding(
      db,
      validInput({
        source_refs: ["77777777-7777-4777-8777-777777777777"],
      }),
    ),
    (error: Error) =>
      error instanceof FindingGenerationValidationError &&
      /source_refs\[0\].*snapshot_manifest\.source_ids/.test(error.message),
  );

  await assert.rejects(
    generateFinding(
      db,
      validInput({
        snapshot_manifest: {
          snapshot_id: SNAPSHOT_ID,
          source_ids: [SOURCE_ID],
          as_of: "2026-05-04",
        },
      }),
    ),
    (error: Error) =>
      error instanceof FindingGenerationValidationError && /snapshot_manifest\.as_of/.test(error.message),
  );

  await assert.rejects(
    generateFinding(
      db,
      validInput({
        snapshot_manifest: {
          snapshot_id: "77777777-7777-4777-8777-777777777777",
          source_ids: [SOURCE_ID],
          as_of: CREATED_AT,
        },
      }),
    ),
    (error: Error) =>
      error instanceof FindingGenerationValidationError &&
      /snapshot_manifest\.snapshot_id.*match/.test(error.message),
  );

  assert.equal(queries.length, 0);
});

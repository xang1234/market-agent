import test from "node:test";
import assert from "node:assert/strict";

import {
  createFact,
  queueFactReview,
  supersedeFact,
  supersedeFactWithPool,
  type FactInput,
} from "../src/fact-repo.ts";
import type { QueryExecutor } from "../src/types.ts";

type Query = { text: string; values?: unknown[] };

const FACT_ID = "11111111-1111-4111-a111-111111111111";
const NEW_FACT_ID = "22222222-2222-4222-a222-222222222222";
const SUBJECT_ID = "33333333-3333-4333-a333-333333333333";
const METRIC_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_METRIC_ID = "77777777-7777-4777-8777-777777777777";
const SOURCE_ID = "55555555-5555-4555-8555-555555555555";
const OTHER_SOURCE_ID = "88888888-8888-4888-8888-888888888888";
const QUEUE_ID = "66666666-6666-4666-8666-666666666666";

class FakeDb implements QueryExecutor {
  readonly queries: Query[] = [];
  readonly releaseArgs: boolean[] = [];
  existingFactOverrides: Record<string, unknown> = {};

  async query<R extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]) {
    this.queries.push({ text, values });

    if (/select\s+fact_id,/i.test(text) && /from facts/i.test(text) && /for update/i.test(text)) {
      return {
        rows: [factRow({ fact_id: values?.[0], ...this.existingFactOverrides })],
        rowCount: 1,
      } as never;
    }
    if (/insert into facts/i.test(text)) {
      return {
        rows: [
          factRow({
            fact_id: NEW_FACT_ID,
            value_num: values?.[8],
            verification_status: values?.[20],
            supersedes: values?.[26] ?? null,
          }),
        ],
        rowCount: 1,
      } as never;
    }
    if (/update facts/i.test(text) && /set superseded_by/i.test(text)) {
      return { rows: [factRow({ fact_id: FACT_ID, value_num: "100.0", superseded_by: values?.[1] })], rowCount: 1 } as never;
    }
    if (/insert into fact_review_queue/i.test(text)) {
      return {
        rows: [
          {
            review_id: QUEUE_ID,
            candidate: values?.[0],
            reason: values?.[1],
            source_id: values?.[2],
            metric_id: values?.[3],
            confidence: values?.[4],
            threshold: values?.[5],
            status: "queued",
            created_at: new Date("2026-05-03T00:00:00.000Z"),
            updated_at: new Date("2026-05-03T00:00:00.000Z"),
          },
        ],
        rowCount: 1,
      } as never;
    }
    return { rows: [], rowCount: 0 } as never;
  }

  release(destroy = false): void {
    this.releaseArgs.push(destroy);
  }
}

test("createFact inserts a validated immutable fact row", async () => {
  const db = new FakeDb();

  const result = await createFact(db, factInput({ value_num: 123.45, verification_status: "authoritative" }));

  assert.equal(result.fact_id, NEW_FACT_ID);
  assert.equal(result.value_num, 123.45);
  assert.equal(result.verification_status, "authoritative");
  assert.match(db.queries[0].text, /insert into facts/i);
  assert.match(db.queries[0].text, /returning fact_id/i);
});

test("supersedeFact creates a new fact and links the old fact without overwriting old values", async () => {
  const db = new FakeDb();

  const result = await supersedeFact(db, FACT_ID, factInput({ value_num: 120.0, reported_at: "2026-05-03T00:00:00Z" }));

  assert.equal(result.new_fact.fact_id, NEW_FACT_ID);
  assert.equal(result.new_fact.supersedes, FACT_ID);
  assert.equal(result.superseded_fact.fact_id, FACT_ID);
  assert.equal(result.superseded_fact.value_num, 100);
  assert.equal(result.superseded_fact.superseded_by, NEW_FACT_ID);
  assert.match(db.queries[0].text, /^begin$/i);
  assert.match(db.queries[1].text, /from facts/i);
  assert.match(db.queries[1].text, /for update/i);
  assert.match(db.queries.at(-1)?.text ?? "", /^commit$/i);
  const update = db.queries.find((query) => /update facts/i.test(query.text))!;
  assert.match(update.text, /set superseded_by = \$2/i);
  const updateSetClause = update.text.slice(update.text.indexOf("set"), update.text.indexOf("where"));
  assert.doesNotMatch(updateSetClause, /value_num|value_text|unit|confidence|verification_status/i);
});

test("supersedeFact rejects replacements for a different fact identity before inserting", async () => {
  const db = new FakeDb();
  db.existingFactOverrides = { metric_id: OTHER_METRIC_ID };

  await assert.rejects(
    supersedeFact(db, FACT_ID, factInput({ value_num: 120.0 })),
    /input identity does not match superseded fact/,
  );

  assert.match(db.queries[0].text, /^begin$/i);
  assert.match(db.queries[1].text, /for update/i);
  assert.match(db.queries.at(-1)?.text ?? "", /^rollback$/i);
  assert.equal(db.queries.some((query) => /insert into facts/i.test(query.text)), false);
});

test("queueFactReview persists low-confidence candidate facts for reviewer workflow", async () => {
  const db = new FakeDb();
  const candidate = factInput({ value_num: 99.9, verification_status: "candidate" });

  const row = await queueFactReview(db, {
    candidate,
    reason: "below_review_confidence_threshold",
    source_id: SOURCE_ID,
    metric_id: METRIC_ID,
    confidence: 0.61,
    threshold: 0.7,
  });

  assert.equal(row.review_id, QUEUE_ID);
  assert.equal(row.status, "queued");
  assert.deepEqual(row.candidate, candidate);
  assert.equal(row.reason, "below_review_confidence_threshold");
  assert.match(db.queries[0].text, /insert into fact_review_queue/i);
});

test("queueFactReview rejects indexed column overrides that differ from candidate payload", async () => {
  const db = new FakeDb();

  await assert.rejects(
    queueFactReview(db, {
      candidate: factInput({ value_num: 99.9, verification_status: "candidate" }),
      reason: "below_review_confidence_threshold",
      source_id: OTHER_SOURCE_ID,
      confidence: 0.61,
      threshold: 0.7,
    }),
    /source_id: must match candidate\.source_id/,
  );

  assert.equal(db.queries.length, 0);
});

test("queueFactReview derives indexed columns from candidate payload", async () => {
  const db = new FakeDb();

  await queueFactReview(db, {
    candidate: factInput({ value_num: 99.9, verification_status: "candidate" }),
    reason: "below_review_confidence_threshold",
    source_id: SOURCE_ID,
    metric_id: METRIC_ID,
    confidence: 0.61,
    threshold: 0.7,
  });

  assert.equal(db.queries[0].values?.[2], SOURCE_ID);
  assert.equal(db.queries[0].values?.[3], METRIC_ID);
});

test("queueFactReview serializes queued facts as candidate status", async () => {
  const db = new FakeDb();

  const row = await queueFactReview(db, {
    candidate: factInput({ value_num: 88.8, verification_status: "authoritative" }),
    reason: "below_review_confidence_threshold",
    confidence: 0.61,
    threshold: 0.7,
  });

  assert.equal(row.candidate.verification_status, "candidate");
});

test("createFact rejects impossible calendar dates before querying", async () => {
  const db = new FakeDb();

  await assert.rejects(
    createFact(db, factInput({ period_end: "2026-02-31" })),
    /period_end: must be an ISO date YYYY-MM-DD/,
  );

  assert.equal(db.queries.length, 0);
});

test("supersedeFact rejects pool-like clients before opening a transaction", async () => {
  const db = new FakeDb() as FakeDb & { connect(): Promise<FakeDb> };
  db.connect = async () => db;

  await assert.rejects(
    supersedeFact(db, FACT_ID, factInput({ value_num: 120.0 })),
    /requires a pinned transaction client/,
  );

  assert.equal(db.queries.length, 0);
});

test("supersedeFactWithPool pins and releases one client", async () => {
  const client = new FakeDb();

  const result = await supersedeFactWithPool({ connect: async () => client }, FACT_ID, factInput({ value_num: 120.0 }));

  assert.equal(result.new_fact.fact_id, NEW_FACT_ID);
  assert.deepEqual(client.releaseArgs, [false]);
});

test("supersedeFactWithPool destroys clients after errors", async () => {
  const client = new FakeDb();

  await assert.rejects(
    supersedeFactWithPool({ connect: async () => client }, "not-a-uuid", factInput({ value_num: 120.0 })),
    /superseded_fact_id/,
  );

  assert.deepEqual(client.releaseArgs, [true]);
});

function factInput(overrides: Partial<FactInput> = {}): FactInput {
  return {
    subject_kind: "issuer",
    subject_id: SUBJECT_ID,
    metric_id: METRIC_ID,
    period_kind: "fiscal_q",
    period_start: "2026-01-01",
    period_end: "2026-03-31",
    fiscal_year: 2026,
    fiscal_period: "Q1",
    value_num: 100.0,
    value_text: null,
    unit: "USD",
    currency: "USD",
    scale: 1,
    as_of: "2026-05-03T00:00:00Z",
    reported_at: "2026-05-02T00:00:00Z",
    observed_at: "2026-05-03T00:00:00Z",
    source_id: SOURCE_ID,
    method: "reported",
    adjustment_basis: null,
    definition_version: 1,
    verification_status: "candidate",
    freshness_class: "filing_time",
    coverage_level: "full",
    quality_flags: [],
    entitlement_channels: ["app"],
    confidence: 0.95,
    ingestion_batch_id: null,
    ...overrides,
  };
}

function factRow(overrides: Record<string, unknown> = {}) {
  return {
    fact_id: FACT_ID,
    subject_kind: "issuer",
    subject_id: SUBJECT_ID,
    metric_id: METRIC_ID,
    period_kind: "fiscal_q",
    period_start: "2026-01-01",
    period_end: "2026-03-31",
    fiscal_year: 2026,
    fiscal_period: "Q1",
    value_num: "100.0",
    value_text: null,
    unit: "USD",
    currency: "USD",
    scale: "1",
    as_of: new Date("2026-05-03T00:00:00.000Z"),
    reported_at: new Date("2026-05-02T00:00:00.000Z"),
    observed_at: new Date("2026-05-03T00:00:00.000Z"),
    source_id: SOURCE_ID,
    method: "reported",
    adjustment_basis: null,
    definition_version: 1,
    verification_status: "candidate",
    freshness_class: "filing_time",
    coverage_level: "full",
    quality_flags: [],
    entitlement_channels: ["app"],
    confidence: "0.95",
    supersedes: null,
    superseded_by: null,
    invalidated_at: null,
    ingestion_batch_id: null,
    created_at: new Date("2026-05-03T00:00:00.000Z"),
    updated_at: new Date("2026-05-03T00:00:00.000Z"),
    ...overrides,
  };
}

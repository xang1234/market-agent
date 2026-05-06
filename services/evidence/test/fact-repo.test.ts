import test from "node:test";
import assert from "node:assert/strict";

import {
  approveFactReview,
  approveFactReviewWithPool,
  createFact,
  editFactReviewCandidate,
  FactEgressEntitlementError,
  FactReviewThroughputExceededError,
  listFactsForEgress,
  listFactReviewQueue,
  listStaleFactReviewQueueItems,
  queueFactReview,
  rejectFactReview,
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
const REVIEWER_ID = "reviewer-ops-1";

class FakeDb implements QueryExecutor {
  readonly queries: Query[] = [];
  readonly releaseArgs: boolean[] = [];
  existingFactOverrides: Record<string, unknown> = {};
  egressRows: Record<string, unknown>[] = [];
  reviewQueueRows: Record<string, unknown>[] = [];
  reviewActionCount = 0;

  async query<R extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]) {
    this.queries.push({ text, values });

    if (/select\s+review_id,/i.test(text) && /from fact_review_queue/i.test(text) && /for update/i.test(text)) {
      const candidate = this.reviewQueueRows[0]?.candidate ?? factInput({ value_num: 99.9 });
      return {
        rows: [
          reviewQueueRow({
            review_id: values?.[0],
            candidate,
          }),
        ],
        rowCount: 1,
      } as never;
    }
    if (/extract\(epoch from/i.test(text) && /from fact_review_queue/i.test(text)) {
      const rows = this.reviewQueueRows.map((row) => ({
        ...row,
        age_seconds: "7200",
        stale_after_seconds: values?.[1],
      }));
      return { rows, rowCount: rows.length } as never;
    }
    if (/select\s+review_id,/i.test(text) && /from fact_review_queue/i.test(text)) {
      return {
        rows: this.reviewQueueRows.length > 0 ? this.reviewQueueRows : [reviewQueueRow()],
        rowCount: this.reviewQueueRows.length || 1,
      } as never;
    }
    if (/select count\(\*\)::int as action_count/i.test(text) && /from fact_review_actions/i.test(text)) {
      return { rows: [{ action_count: this.reviewActionCount }], rowCount: 1 } as never;
    }
    if (/select\s+fact_id,/i.test(text) && /from facts/i.test(text) && /for update/i.test(text)) {
      return {
        rows: [factRow({ fact_id: values?.[0], ...this.existingFactOverrides })],
        rowCount: 1,
      } as never;
    }
    if (/select\s+fact_id,/i.test(text) && /from facts/i.test(text) && /entitlement_channels \? \$2/i.test(text)) {
      return { rows: this.egressRows, rowCount: this.egressRows.length } as never;
    }
    if (/insert into facts/i.test(text)) {
      return {
        rows: [
          factRow({
            fact_id: NEW_FACT_ID,
            value_num: values?.[8],
            verification_status: values?.[20],
            quality_flags: JSON.parse(String(values?.[23] ?? "[]")),
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
          reviewQueueRow({
            review_id: QUEUE_ID,
            candidate: values?.[0],
            reason: values?.[1],
            source_id: values?.[2],
            metric_id: values?.[3],
            confidence: values?.[4],
            threshold: values?.[5],
            status: "queued",
          }),
        ],
        rowCount: 1,
      } as never;
    }
    if (/update fact_review_queue/i.test(text)) {
      const status = /status = 'reviewed'/i.test(text) ? "reviewed" : /status = 'dismissed'/i.test(text) ? "dismissed" : "queued";
      const existingCandidate = this.reviewQueueRows[0]?.candidate ?? factInput({ value_num: 99.9 });
      const candidate = status === "dismissed" ? existingCandidate : values?.[1] ?? existingCandidate;
      const reviewedBy = status === "reviewed" ? values?.[2] : status === "dismissed" ? values?.[1] : null;
      const reviewedAtValue = status === "reviewed" ? values?.[3] : status === "dismissed" ? values?.[2] : null;
      const reviewedAt = reviewedAtValue == null ? null : new Date(String(reviewedAtValue));
      const factId = status === "reviewed" ? values?.[4] : null;
      return {
        rows: [
          reviewQueueRow({
            review_id: values?.[0],
            candidate,
            status,
            reviewed_by: reviewedBy,
            reviewed_at: reviewedAt,
            fact_id: factId,
            updated_at: new Date("2026-05-03T00:01:00.000Z"),
          }),
        ],
        rowCount: 1,
      } as never;
    }
    if (/insert into fact_review_actions/i.test(text)) {
      return {
        rows: [
          {
            action_id: "99999999-9999-4999-8999-999999999999",
            review_id: values?.[0],
            action: values?.[1],
            reviewer_id: values?.[2],
            notes: values?.[3],
            candidate_before: values?.[4],
            candidate_after: values?.[5],
            fact_id: values?.[6],
            created_at: new Date("2026-05-03T00:01:00.000Z"),
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

test("listFactReviewQueue returns queued rows in oldest-first reviewer order", async () => {
  const db = new FakeDb();
  db.reviewQueueRows = [
    reviewQueueRow({ review_id: QUEUE_ID, created_at: new Date("2026-05-03T00:00:00.000Z") }),
    reviewQueueRow({ review_id: "99999999-9999-4999-8999-999999999999", created_at: new Date("2026-05-03T00:02:00.000Z") }),
  ];

  const rows = await listFactReviewQueue(db, { status: "queued", limit: 25 });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].review_id, QUEUE_ID);
  assert.match(db.queries[0].text, /where status = \$1/);
  assert.match(db.queries[0].text, /order by created_at asc/);
  assert.deepEqual(db.queries[0].values, ["queued", 25]);
});

test("listStaleFactReviewQueueItems surfaces queued items older than the operator threshold", async () => {
  const db = new FakeDb();
  db.reviewQueueRows = [
    reviewQueueRow({
      review_id: QUEUE_ID,
      created_at: new Date("2026-05-03T00:00:00.000Z"),
    }),
  ];

  const rows = await listStaleFactReviewQueueItems(db, {
    now: "2026-05-03T02:00:00Z",
    stale_after_seconds: 3600,
    limit: 10,
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].review_id, QUEUE_ID);
  assert.equal(rows[0].age_seconds, 7200);
  assert.equal(rows[0].stale_after_seconds, 3600);
  assert.match(db.queries[0].text, /status = 'queued'/);
  assert.match(db.queries[0].text, /created_at <= \$1::timestamptz - \(\$2 \* interval '1 second'\)/);
  assert.deepEqual(db.queries[0].values, ["2026-05-03T02:00:00Z", 3600, 10]);
});

test("approveFactReview audits approval and creates an authoritative fact with reviewer provenance", async () => {
  const db = new FakeDb();
  const candidate = factInput({ value_num: 99.9, verification_status: "candidate" });
  db.reviewQueueRows = [reviewQueueRow({ candidate })];

  const result = await approveFactReview(db, {
    review_id: QUEUE_ID,
    reviewer_id: REVIEWER_ID,
    notes: "matches 10-Q table",
    reviewed_at: "2026-05-03T00:01:00Z",
  });

  assert.equal(result.fact.fact_id, NEW_FACT_ID);
  assert.equal(result.fact.verification_status, "authoritative");
  assert.equal(result.review.reviewed_by, REVIEWER_ID);
  assert.equal(result.review.reviewed_at, "2026-05-03T00:01:00.000Z");
  assert.equal(result.review.fact_id, NEW_FACT_ID);
  assert.deepEqual(result.fact.quality_flags, [
    {
      kind: "manual_review",
      action: "approved",
      review_id: QUEUE_ID,
      reviewer_id: REVIEWER_ID,
      reviewed_at: "2026-05-03T00:01:00Z",
    },
  ]);
  assert.equal(result.review.status, "reviewed");
  assert.match(db.queries[0].text, /^begin$/i);
  assert.match(db.queries[1].text, /from fact_review_queue/i);
  assert.match(db.queries[1].text, /for update/i);
  assert.match(db.queries.at(-1)?.text ?? "", /^commit$/i);
  assert.equal(db.queries.some((query) => /insert into fact_review_actions/i.test(query.text) && query.values?.[1] === "approved"), true);
});

test("approveFactReview can persist reviewer edits before creating the fact", async () => {
  const db = new FakeDb();
  const edited = factInput({ value_num: 101.25, verification_status: "candidate" });

  const result = await approveFactReview(db, {
    review_id: QUEUE_ID,
    reviewer_id: REVIEWER_ID,
    candidate: edited,
    reviewed_at: "2026-05-03T00:01:00Z",
  });

  assert.equal(result.fact.value_num, 101.25);
  const queueUpdate = db.queries.find((query) => /update fact_review_queue/i.test(query.text))!;
  assert.deepEqual(queueUpdate.values?.[1], {
    ...edited,
    verification_status: "candidate",
  });
  assert.equal(db.queries.some((query) => /insert into fact_review_actions/i.test(query.text) && query.values?.[1] === "approved"), true);
});

test("approveFactReview enforces the reviewer throughput cap before promotion", async () => {
  const db = new FakeDb();
  db.reviewActionCount = 2;

  await assert.rejects(
    () =>
      approveFactReview(db, {
        review_id: QUEUE_ID,
        reviewer_id: REVIEWER_ID,
        throughput_limit: { max_actions: 2, window_seconds: 3600 },
        reviewed_at: "2026-05-03T00:01:00Z",
      }),
    (error) =>
      error instanceof FactReviewThroughputExceededError &&
      error.max_actions === 2 &&
      error.window_seconds === 3600,
  );

  assert.equal(db.queries.some((query) => /insert into facts/i.test(query.text)), false);
  assert.equal(db.queries.some((query) => /insert into fact_review_actions/i.test(query.text)), false);
  assert.ok(db.queries.some((query) => /pg_advisory_xact_lock/i.test(query.text)));
  assert.match(db.queries.at(-1)?.text ?? "", /^rollback$/i);
});

test("rejectFactReview dismisses a queued candidate without creating a fact and writes an audit action", async () => {
  const db = new FakeDb();

  const row = await rejectFactReview(db, {
    review_id: QUEUE_ID,
    reviewer_id: REVIEWER_ID,
    notes: "amount belongs to a different segment",
    reviewed_at: "2026-05-03T00:01:00Z",
  });

  assert.equal(row.status, "dismissed");
  assert.equal(row.reviewed_by, REVIEWER_ID);
  assert.equal(row.reviewed_at, "2026-05-03T00:01:00.000Z");
  assert.equal(row.fact_id, null);
  assert.equal(db.queries.some((query) => /insert into facts/i.test(query.text)), false);
  assert.equal(db.queries.some((query) => /insert into fact_review_actions/i.test(query.text) && query.values?.[1] === "rejected"), true);
});

test("editFactReviewCandidate keeps the row queued and audits before and after candidates", async () => {
  const db = new FakeDb();
  const before = factInput({ value_num: 99.9, verification_status: "candidate" });
  const after = factInput({ value_num: 100.5, verification_status: "candidate" });
  db.reviewQueueRows = [reviewQueueRow({ candidate: before })];

  const row = await editFactReviewCandidate(db, {
    review_id: QUEUE_ID,
    reviewer_id: REVIEWER_ID,
    candidate: after,
    notes: "corrected rounded value",
    reviewed_at: "2026-05-03T00:01:00Z",
  });

  assert.equal(row.status, "queued");
  assert.equal(row.candidate.value_num, 100.5);
  const audit = db.queries.find((query) => /insert into fact_review_actions/i.test(query.text))!;
  assert.equal(audit.values?.[1], "edited");
  assert.deepEqual(audit.values?.[4], before);
  assert.deepEqual(audit.values?.[5], { ...after, verification_status: "candidate" });
});

test("listFactsForEgress returns facts whose entitlement includes the requested channel", async () => {
  const db = new FakeDb();
  db.egressRows = [factRow({ fact_id: FACT_ID, entitlement_channels: ["app", "export"] })];

  const rows = await listFactsForEgress(db, {
    fact_ids: [FACT_ID],
    channel: "export",
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].fact_id, FACT_ID);
  assert.deepEqual(rows[0].entitlement_channels, ["app", "export"]);
  assert.match(db.queries[0].text, /entitlement_channels \? \$2/);
  assert.deepEqual(db.queries[0].values, [[FACT_ID], "export"]);
});

test("listFactsForEgress blocks app-only facts from export", async () => {
  const db = new FakeDb();

  await assert.rejects(
    () => listFactsForEgress(db, { fact_ids: [FACT_ID], channel: "export" }),
    (error) =>
      error instanceof FactEgressEntitlementError &&
      error.channel === "export" &&
      error.denied_fact_ids.includes(FACT_ID),
  );

  assert.match(db.queries[0].text, /entitlement_channels \? \$2/);
});

test("createFact rejects unknown entitlement channels before querying", async () => {
  const db = new FakeDb();

  await assert.rejects(
    () => createFact(db, factInput({ entitlement_channels: ["app", "webhook"] })),
    /entitlement_channels/,
  );

  assert.equal(db.queries.length, 0);
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
  const client = new FakeDb();
  const db = {
    query: client.query.bind(client),
    connect: async () => client,
  };

  await assert.rejects(
    supersedeFact(db, FACT_ID, factInput({ value_num: 120.0 })),
    /requires a pinned transaction client/,
  );

  assert.equal(client.queries.length, 0);
});

test("supersedeFact accepts standalone pg.Client-like executors", async () => {
  const db = Object.assign(new FakeDb(), {
    connect: async () => undefined,
    connectionParameters: {},
  });

  const result = await supersedeFact(db, FACT_ID, factInput({ value_num: 120.0 }));

  assert.equal(result.new_fact.fact_id, NEW_FACT_ID);
  assert.match(db.queries[0].text, /^begin$/i);
});

test("supersedeFactWithPool pins and releases one client", async () => {
  const client = new FakeDb();

  const result = await supersedeFactWithPool({ connect: async () => client }, FACT_ID, factInput({ value_num: 120.0 }));

  assert.equal(result.new_fact.fact_id, NEW_FACT_ID);
  assert.deepEqual(client.releaseArgs, [false]);
});

test("supersedeFactWithPool preserves clients after ordinary validation errors", async () => {
  const client = new FakeDb();

  await assert.rejects(
    supersedeFactWithPool({ connect: async () => client }, "not-a-uuid", factInput({ value_num: 120.0 })),
    /superseded_fact_id/,
  );

  assert.deepEqual(client.releaseArgs, [false]);
});

test("supersedeFactWithPool destroys clients after connection errors", async () => {
  const client = new FakeDb();
  client.query = async () => {
    const error = new Error("connection reset") as Error & { code: string };
    error.code = "ECONNRESET";
    throw error;
  };

  await assert.rejects(
    supersedeFactWithPool({ connect: async () => client }, FACT_ID, factInput({ value_num: 120.0 })),
    /connection reset/,
  );

  assert.deepEqual(client.releaseArgs, [true]);
});

test("approveFactReviewWithPool preserves clients after throughput validation errors", async () => {
  const client = new FakeDb();
  client.reviewActionCount = 1;

  await assert.rejects(
    approveFactReviewWithPool(
      { connect: async () => client },
      {
        review_id: QUEUE_ID,
        reviewer_id: REVIEWER_ID,
        reviewed_at: "2026-05-03T00:01:00Z",
        throughput_limit: { max_actions: 1, window_seconds: 3600 },
      },
    ),
    FactReviewThroughputExceededError,
  );

  assert.deepEqual(client.releaseArgs, [false]);
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

function reviewQueueRow(overrides: Record<string, unknown> = {}) {
  return {
    review_id: QUEUE_ID,
    candidate: factInput({ value_num: 99.9, verification_status: "candidate" }),
    reason: "below_review_confidence_threshold",
    source_id: SOURCE_ID,
    metric_id: METRIC_ID,
    confidence: "0.61",
    threshold: "0.7",
    status: "queued",
    created_at: new Date("2026-05-03T00:00:00.000Z"),
    updated_at: new Date("2026-05-03T00:00:00.000Z"),
    reviewed_by: null,
    reviewed_at: null,
    fact_id: null,
    ...overrides,
  };
}

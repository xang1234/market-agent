import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test, { type TestContext } from "node:test";

import { createEvidenceReviewServer } from "../src/review-http.ts";
import type { FactInput, FactPoolClient } from "../src/fact-repo.ts";

const REVIEW_ID = "66666666-6666-4666-8666-666666666666";
const FACT_ID = "11111111-1111-4111-a111-111111111111";
const SUBJECT_ID = "33333333-3333-4333-a333-333333333333";
const METRIC_ID = "44444444-4444-4444-8444-444444444444";
const SOURCE_ID = "55555555-5555-4555-8555-555555555555";
const REVIEWER_ID = "00000000-0000-4000-8000-000000000001";

type Query = { text: string; values?: unknown[] };

class FakeReviewDb implements FactPoolClient {
  readonly queries: Query[] = [];
  readonly releaseArgs: boolean[] = [];
  reviewActionCount = 0;

  async connect(): Promise<FactPoolClient> {
    return this;
  }

  async query(text: string, values?: unknown[]) {
    this.queries.push({ text, values });

    if (/extract\(epoch from/i.test(text) && /from fact_review_queue/i.test(text)) {
      return {
        rows: [
          {
            ...reviewQueueRow(),
            age_seconds: "7200",
            stale_after_seconds: values?.[1],
          },
        ],
        rowCount: 1,
      };
    }

    if (/select\s+review_id,/i.test(text) && /from fact_review_queue/i.test(text) && /for update/i.test(text)) {
      return { rows: [reviewQueueRow()], rowCount: 1 };
    }

    if (/select count\(\*\)::int as action_count/i.test(text) && /from fact_review_actions/i.test(text)) {
      return { rows: [{ action_count: this.reviewActionCount }], rowCount: 1 };
    }

    if (/insert into facts/i.test(text)) {
      return {
        rows: [
          factRow({
            value_num: values?.[8],
            verification_status: values?.[20],
            quality_flags: JSON.parse(String(values?.[23] ?? "[]")),
          }),
        ],
        rowCount: 1,
      };
    }

    if (/update fact_review_queue/i.test(text)) {
      return {
        rows: [
          reviewQueueRow({
            candidate: values?.[1],
            status: /status = 'reviewed'/i.test(text) ? "reviewed" : "queued",
            reviewed_by: values?.[2],
            reviewed_at: values?.[3],
            fact_id: values?.[4],
          }),
        ],
        rowCount: 1,
      };
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
            created_at: new Date("2026-05-03T02:00:00.000Z"),
          },
        ],
        rowCount: 1,
      };
    }

    return { rows: [], rowCount: 0 };
  }

  release(destroy = false): void {
    this.releaseArgs.push(destroy);
  }
}

async function startServer(t: TestContext, db: FakeReviewDb): Promise<string> {
  const server = createEvidenceReviewServer(db, { clock: () => new Date("2026-05-03T02:00:00.000Z") });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

test("GET /v1/evidence/fact-review-queue returns stale queue items", async (t) => {
  const db = new FakeReviewDb();
  const base = await startServer(t, db);

  const response = await fetch(`${base}/v1/evidence/fact-review-queue?stale_after_seconds=3600&limit=10`, {
    headers: { "x-user-id": REVIEWER_ID },
  });
  const body = (await response.json()) as { items: Array<{ review_id: string; age_seconds: number }> };

  assert.equal(response.status, 200);
  assert.equal(body.items[0].review_id, REVIEW_ID);
  assert.equal(body.items[0].age_seconds, 7200);
  assert.match(db.queries[0].text, /created_at <= \$1::timestamptz/);
});

test("GET /v1/evidence/fact-review-queue requires reviewer identity", async (t) => {
  const db = new FakeReviewDb();
  const base = await startServer(t, db);

  const response = await fetch(`${base}/v1/evidence/fact-review-queue`);
  const body = (await response.json()) as { error: string };

  assert.equal(response.status, 401);
  assert.match(body.error, /x-user-id/);
  assert.equal(db.queries.length, 0);
});

test("POST approve pins a client, creates the fact, and returns the audited result", async (t) => {
  const db = new FakeReviewDb();
  const base = await startServer(t, db);

  const response = await fetch(`${base}/v1/evidence/fact-review-queue/${REVIEW_ID}/approve`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-id": REVIEWER_ID,
    },
    body: JSON.stringify({ notes: "verified" }),
  });
  const body = (await response.json()) as { fact: { fact_id: string }; action: { action: string } };

  assert.equal(response.status, 200);
  assert.equal(body.fact.fact_id, FACT_ID);
  assert.equal(body.action.action, "approved");
  assert.deepEqual(db.releaseArgs, [false]);
  assert.ok(db.queries.some((query) => /select count\(\*\)::int as action_count/i.test(query.text)));
  assert.ok(db.queries.some((query) => /insert into fact_review_actions/i.test(query.text)));
});

test("POST approve requires reviewer identity", async (t) => {
  const db = new FakeReviewDb();
  const base = await startServer(t, db);

  const response = await fetch(`${base}/v1/evidence/fact-review-queue/${REVIEW_ID}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const body = (await response.json()) as { error: string };

  assert.equal(response.status, 401);
  assert.match(body.error, /x-user-id/);
});

test("POST approve returns 429 when reviewer throughput is capped", async (t) => {
  const db = new FakeReviewDb();
  db.reviewActionCount = 60;
  const base = await startServer(t, db);

  const response = await fetch(`${base}/v1/evidence/fact-review-queue/${REVIEW_ID}/approve`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-id": REVIEWER_ID,
    },
    body: "{}",
  });
  const body = (await response.json()) as { error: string };

  assert.equal(response.status, 429);
  assert.match(body.error, /throughput limit exceeded/);
  assert.equal(db.queries.some((query) => /insert into facts/i.test(query.text)), false);
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
    value_num: 100,
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

function reviewQueueRow(overrides: Record<string, unknown> = {}) {
  return {
    review_id: REVIEW_ID,
    candidate: factInput({ value_num: 99.9 }),
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

function factRow(overrides: Record<string, unknown> = {}) {
  return {
    fact_id: FACT_ID,
    ...factInput({ verification_status: "authoritative" }),
    scale: "1",
    value_num: "100.0",
    confidence: "0.95",
    supersedes: null,
    superseded_by: null,
    invalidated_at: null,
    created_at: new Date("2026-05-03T00:00:00.000Z"),
    updated_at: new Date("2026-05-03T00:00:00.000Z"),
    ...overrides,
  };
}

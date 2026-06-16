import test from "node:test";
import assert from "node:assert/strict";

import {
  EVENT_STATUSES,
  EVENT_TYPES,
  createEvent,
  createEventSubject,
  findEventsByIssuer,
  listEventSubjectsForEvent,
} from "../src/event-repo.ts";
import type { QueryExecutor } from "../src/types.ts";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";

const EVENT_ID = "11111111-1111-4111-a111-111111111111";
const EVENT_SUBJECT_ID = "22222222-2222-4222-a222-222222222222";
const CLAIM_ID = "33333333-3333-4333-a333-333333333333";
const SOURCE_ID = "44444444-4444-4444-a444-444444444444";
const SUBJECT_ID = "55555555-5555-4555-a555-555555555555";

function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    event_id: EVENT_ID,
    event_type: "lawsuit",
    occurred_at: new Date("2026-05-03T00:00:00.000Z"),
    status: "reported",
    source_claim_ids: [CLAIM_ID],
    source_ids: [SOURCE_ID],
    payload_json: { venue: "Delaware Chancery" },
    created_at: new Date("2026-05-03T00:00:00.000Z"),
    updated_at: new Date("2026-05-03T00:00:00.000Z"),
    ...overrides,
  };
}

function eventSubjectRow(overrides: Record<string, unknown> = {}) {
  return {
    event_subject_id: EVENT_SUBJECT_ID,
    event_id: EVENT_ID,
    subject_kind: "issuer",
    subject_id: SUBJECT_ID,
    role: "defendant",
    created_at: new Date("2026-05-03T00:00:00.000Z"),
    ...overrides,
  };
}

function recordingDb(rows: Record<string, unknown>[][] = [[eventRow()]]) {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  let call = 0;
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      queries.push({ text, values });
      const queryRows = rows[Math.min(call, rows.length - 1)] ?? [];
      call += 1;
      return {
        rows: queryRows as R[],
        command: text.trimStart().startsWith("select") ? "SELECT" : "INSERT",
        rowCount: queryRows.length,
        oid: 0,
        fields: [],
      };
    },
  };
  return { db, queries };
}

test("createEvent inserts a typed event with source claim and source refs", async () => {
  const { db, queries } = recordingDb();

  const event = await createEvent(db, {
    event_type: "lawsuit",
    occurred_at: "2026-05-03T00:00:00.000Z",
    status: "reported",
    source_claim_ids: [CLAIM_ID],
    source_ids: [SOURCE_ID],
    payload_json: { venue: "Delaware Chancery" },
  });

  assert.equal(event.event_id, EVENT_ID);
  assert.equal(event.event_type, "lawsuit");
  assert.deepEqual(event.source_claim_ids, [CLAIM_ID]);
  assert.deepEqual(event.source_ids, [SOURCE_ID]);
  assert.deepEqual(event.payload_json, { venue: "Delaware Chancery" });
  assert.match(queries[0]!.text, /insert into events/);
  assert.deepEqual(queries[0]!.values, [
    "lawsuit",
    "2026-05-03T00:00:00.000Z",
    "reported",
    JSON.stringify([CLAIM_ID]),
    JSON.stringify([SOURCE_ID]),
    JSON.stringify({ venue: "Delaware Chancery" }),
  ]);
});

test("createEventSubject inserts a polymorphic event subject", async () => {
  const { db, queries } = recordingDb([[eventSubjectRow()]]);

  const subject = await createEventSubject(db, {
    event_id: EVENT_ID,
    subject_kind: "issuer",
    subject_id: SUBJECT_ID,
    role: "defendant",
  });

  assert.equal(subject.event_subject_id, EVENT_SUBJECT_ID);
  assert.deepEqual(subject.subject_ref, { kind: "issuer", id: SUBJECT_ID });
  assert.equal(subject.role, "defendant");
  assert.match(queries[0]!.text, /insert into event_subjects/);
  assert.deepEqual(queries[0]!.values, [EVENT_ID, "issuer", SUBJECT_ID, "defendant"]);
});

test("listEventSubjectsForEvent returns subjects ordered by role and id", async () => {
  const { db, queries } = recordingDb([[
    eventSubjectRow({ event_subject_id: EVENT_SUBJECT_ID, role: "defendant" }),
    eventSubjectRow({ event_subject_id: "66666666-6666-4666-a666-666666666666", role: "plaintiff" }),
  ]]);

  const subjects = await listEventSubjectsForEvent(db, EVENT_ID);

  assert.equal(subjects.length, 2);
  assert.equal(subjects[0]!.role, "defendant");
  assert.match(queries[0]!.text, /where event_id = \$1/);
  assert.match(queries[0]!.text, /order by role nulls last/);
  assert.match(queries[0]!.text, /event_subject_id/);
  assert.deepEqual(queries[0]!.values, [EVENT_ID]);
});

test("event operations reject invalid inputs before querying", async () => {
  const { db, queries } = recordingDb();
  const validEvent = {
    event_type: "lawsuit" as const,
    occurred_at: "2026-05-03T00:00:00.000Z",
    status: "reported" as const,
    source_claim_ids: [CLAIM_ID],
    source_ids: [SOURCE_ID],
    payload_json: { venue: "Delaware Chancery" },
  };
  const validSubject = {
    event_id: EVENT_ID,
    subject_kind: "issuer" as const,
    subject_id: SUBJECT_ID,
    role: "defendant",
  };

  await assert.rejects(() => createEvent(db, { ...validEvent, event_type: "spin_off" as never }), /event_type/);
  await assert.rejects(() => createEvent(db, { ...validEvent, occurred_at: "2026-05-03" }), /occurred_at/);
  await assert.rejects(() => createEvent(db, { ...validEvent, status: "draft" as never }), /status/);
  await assert.rejects(() => createEvent(db, { ...validEvent, source_claim_ids: ["not-a-uuid"] }), /source_claim_ids/);
  await assert.rejects(() => createEvent(db, { ...validEvent, source_ids: ["not-a-uuid"] }), /source_ids/);
  await assert.rejects(() => createEvent(db, { ...validEvent, payload_json: [] as never }), /payload_json/);
  await assert.rejects(() => createEventSubject(db, { ...validSubject, event_id: "not-a-uuid" }), /event_id/);
  await assert.rejects(() => createEventSubject(db, { ...validSubject, subject_kind: "company" as never }), /subject_kind/);
  await assert.rejects(() => createEventSubject(db, { ...validSubject, subject_id: "not-a-uuid" }), /subject_id/);
  await assert.rejects(() => createEventSubject(db, { ...validSubject, role: " " }), /role/);
  await assert.rejects(() => listEventSubjectsForEvent(db, "not-a-uuid"), /event_id/);

  assert.equal(queries.length, 0);
});

test("EVENT_TYPES and EVENT_STATUSES pin the P3.4 event contract", () => {
  assert.deepEqual(EVENT_TYPES, [
    "earnings_release",
    "guidance_update",
    "rating_change",
    "m_and_a",
    "split",
    "dividend",
    "product_launch",
    "lawsuit",
    "macro_event",
    "theme_event",
    "insider_transaction",
    "officer_change",
    "restatement",
    "material_agreement",
    "bankruptcy",
    "delisting",
    "auditor_change",
    "material_event",
    "position_change",
  ]);
  assert.deepEqual(EVENT_STATUSES, ["reported", "confirmed", "canceled"]);
  assert.equal(Object.isFrozen(EVENT_TYPES), true);
  assert.equal(Object.isFrozen(EVENT_STATUSES), true);
});

test("listEventSubjectsForEvent rejects stored subject shape drift", async () => {
  await assert.rejects(
    () => listEventSubjectsForEvent(recordingDb([[eventSubjectRow({ subject_kind: "company" })]]).db, EVENT_ID),
    /subject_kind/,
  );
  await assert.rejects(
    () => listEventSubjectsForEvent(recordingDb([[eventSubjectRow({ subject_id: "not-a-uuid" })]]).db, EVENT_ID),
    /subject_id/,
  );
});

test("findEventsByIssuer returns the issuer's in-window events newest-first", async (t) => {
  if (!dockerAvailable()) {
    t.skip("docker unavailable");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "events-by-issuer");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;
  const seeded = await client.query<{ issuer_id: string }>(
    `insert into issuers (legal_name) values ('Acme Inc') returning issuer_id::text as issuer_id`,
  );
  const issuerId = seeded.rows[0]!.issuer_id;
  const other = await client.query<{ issuer_id: string }>(
    `insert into issuers (legal_name) values ('Other Inc') returning issuer_id::text as issuer_id`,
  );
  const otherId = other.rows[0]!.issuer_id;

  const now = Date.now();
  const iso = (daysAgo: number) => new Date(now - daysAgo * 86_400_000).toISOString();

  // Two in-window events for Acme (different dates) + one stale + one for another issuer.
  for (const [eventType, occurredAt] of [
    ["officer_change", iso(2)],
    ["bankruptcy", iso(1)],
    ["delisting", iso(200)], // outside a 90-day window
  ] as const) {
    const event = await createEvent(db, {
      event_type: eventType,
      occurred_at: occurredAt,
      status: "reported",
      source_claim_ids: [],
      source_ids: [],
      payload_json: null,
    });
    await createEventSubject(db, { event_id: event.event_id, subject_kind: "issuer", subject_id: issuerId, role: "subject" });
  }
  const otherEvent = await createEvent(db, {
    event_type: "material_event",
    occurred_at: iso(1),
    status: "reported",
    source_claim_ids: [],
    source_ids: [],
    payload_json: null,
  });
  await createEventSubject(db, { event_id: otherEvent.event_id, subject_kind: "issuer", subject_id: otherId, role: "subject" });

  const events = await findEventsByIssuer(db, issuerId, 90);
  assert.deepEqual(
    events.map((e) => e.event_type),
    ["bankruptcy", "officer_change"],
    "in-window events newest-first; the 200-day-old delisting and the other issuer's event are excluded",
  );
});

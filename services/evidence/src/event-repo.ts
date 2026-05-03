import type { SubjectKind, SubjectRef } from "../../resolver/src/subject-ref.ts";
import { SUBJECT_KINDS } from "../../resolver/src/subject-ref.ts";

import type { QueryExecutor } from "./types.ts";
import {
  assertIso8601WithOffset,
  assertOneOf,
  assertOptionalNonEmptyString,
  assertUuidV4,
} from "./validators.ts";

export const EVENT_TYPES = Object.freeze([
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
] as const);

export const EVENT_STATUSES = Object.freeze([
  "reported",
  "confirmed",
  "canceled",
] as const);

export type EventType = (typeof EVENT_TYPES)[number];
export type EventStatus = (typeof EVENT_STATUSES)[number];

export type EventInput = {
  event_type: EventType;
  occurred_at: string;
  status: EventStatus;
  source_claim_ids: readonly string[];
  source_ids: readonly string[];
  payload_json?: Record<string, unknown> | null;
};

export type EventRow = {
  event_id: string;
  event_type: EventType;
  occurred_at: string;
  status: EventStatus;
  source_claim_ids: readonly string[];
  source_ids: readonly string[];
  payload_json: Readonly<Record<string, unknown>> | null;
  created_at: string;
  updated_at: string;
};

export type EventSubjectInput = {
  event_id: string;
  subject_kind: SubjectKind;
  subject_id: string;
  role?: string | null;
};

export type EventSubjectRow = {
  event_subject_id: string;
  event_id: string;
  subject_ref: SubjectRef;
  role: string | null;
  created_at: string;
};

type EventDbRow = Omit<
  EventRow,
  "occurred_at" | "source_claim_ids" | "source_ids" | "payload_json" | "created_at" | "updated_at"
> & {
  occurred_at: Date | string;
  source_claim_ids: string[] | string;
  source_ids: string[] | string;
  payload_json: Record<string, unknown> | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type EventSubjectDbRow = {
  event_subject_id: string;
  event_id: string;
  subject_kind: SubjectKind;
  subject_id: string;
  role: string | null;
  created_at: Date | string;
};

const EVENT_COLUMNS = `event_id,
               event_type,
               occurred_at,
               status,
               source_claim_ids,
               source_ids,
               payload_json,
               created_at,
               updated_at`;

const EVENT_SUBJECT_COLUMNS = `event_subject_id,
               event_id,
               subject_kind,
               subject_id,
               role,
               created_at`;

export async function createEvent(db: QueryExecutor, input: EventInput): Promise<EventRow> {
  const normalized = normalizeEventInput(input);

  const { rows } = await db.query<EventDbRow>(
    `insert into events
       (event_type, occurred_at, status, source_claim_ids, source_ids, payload_json)
     values ($1, $2::timestamptz, $3::event_status, $4::jsonb, $5::jsonb, $6::jsonb)
     returning ${EVENT_COLUMNS}`,
    [
      normalized.event_type,
      normalized.occurred_at,
      normalized.status,
      JSON.stringify(normalized.source_claim_ids),
      JSON.stringify(normalized.source_ids),
      normalized.payload_json === null ? null : JSON.stringify(normalized.payload_json),
    ],
  );

  return eventRowFromDb(rows[0]);
}

export async function createEventSubject(
  db: QueryExecutor,
  input: EventSubjectInput,
): Promise<EventSubjectRow> {
  const normalized = normalizeEventSubjectInput(input);

  const { rows } = await db.query<EventSubjectDbRow>(
    `insert into event_subjects
       (event_id, subject_kind, subject_id, role)
     values ($1::uuid, $2::subject_kind, $3::uuid, $4)
     returning ${EVENT_SUBJECT_COLUMNS}`,
    [
      normalized.event_id,
      normalized.subject_kind,
      normalized.subject_id,
      normalized.role,
    ],
  );

  return eventSubjectRowFromDb(rows[0]);
}

export async function listEventSubjectsForEvent(
  db: QueryExecutor,
  eventId: string,
): Promise<readonly EventSubjectRow[]> {
  assertUuidV4(eventId, "event_id");

  const { rows } = await db.query<EventSubjectDbRow>(
    `select ${EVENT_SUBJECT_COLUMNS}
       from event_subjects
      where event_id = $1
      order by role nulls last,
               event_subject_id`,
    [eventId],
  );

  return Object.freeze(rows.map(eventSubjectRowFromDb));
}

function normalizeEventInput(input: EventInput): Required<EventInput> {
  assertOneOf(input.event_type, EVENT_TYPES, "event_type");
  assertIso8601WithOffset(input.occurred_at, "occurred_at");
  assertOneOf(input.status, EVENT_STATUSES, "status");
  assertUuidArray(input.source_claim_ids, "source_claim_ids");
  assertUuidArray(input.source_ids, "source_ids");
  assertOptionalJsonObject(input.payload_json, "payload_json");

  return {
    event_type: input.event_type,
    occurred_at: input.occurred_at,
    status: input.status,
    source_claim_ids: [...input.source_claim_ids],
    source_ids: [...input.source_ids],
    payload_json: input.payload_json ?? null,
  };
}

function normalizeEventSubjectInput(input: EventSubjectInput): Required<EventSubjectInput> {
  assertUuidV4(input.event_id, "event_id");
  assertOneOf(input.subject_kind, SUBJECT_KINDS, "subject_kind");
  assertUuidV4(input.subject_id, "subject_id");
  assertOptionalNonEmptyString(input.role, "role");

  return {
    event_id: input.event_id,
    subject_kind: input.subject_kind,
    subject_id: input.subject_id,
    role: input.role ?? null,
  };
}

function eventRowFromDb(row: EventDbRow | undefined): EventRow {
  if (!row) {
    throw new Error("event insert/select did not return a row");
  }

  assertOneOf(row.event_type, EVENT_TYPES, "event_type");
  assertOneOf(row.status, EVENT_STATUSES, "status");

  return Object.freeze({
    event_id: row.event_id,
    event_type: row.event_type,
    occurred_at: isoString(row.occurred_at),
    status: row.status,
    source_claim_ids: Object.freeze(parseUuidArray(row.source_claim_ids, "source_claim_ids")),
    source_ids: Object.freeze(parseUuidArray(row.source_ids, "source_ids")),
    payload_json: parseOptionalJsonObject(row.payload_json, "payload_json"),
    created_at: isoString(row.created_at),
    updated_at: isoString(row.updated_at),
  });
}

function eventSubjectRowFromDb(row: EventSubjectDbRow | undefined): EventSubjectRow {
  if (!row) {
    throw new Error("event subject insert/select did not return a row");
  }

  assertOneOf(row.subject_kind, SUBJECT_KINDS, "subject_kind");
  assertUuidV4(row.subject_id, "subject_id");

  return Object.freeze({
    event_subject_id: row.event_subject_id,
    event_id: row.event_id,
    subject_ref: Object.freeze({ kind: row.subject_kind, id: row.subject_id }),
    role: row.role,
    created_at: isoString(row.created_at),
  });
}

function assertUuidArray(value: unknown, label: string): asserts value is readonly string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label}: must be an array of UUID v4 values`);
  }

  value.forEach((item, index) => assertUuidV4(item, `${label}[${index}]`));
}

function parseUuidArray(value: string[] | string, label: string): string[] {
  const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
  assertUuidArray(parsed, label);
  return [...parsed];
}

function assertOptionalJsonObject(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> | null | undefined {
  if (value == null) return;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}: must be a JSON object`);
  }
}

function parseOptionalJsonObject(
  value: Record<string, unknown> | string | null,
  label: string,
): Readonly<Record<string, unknown>> | null {
  if (value === null) return null;
  const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
  assertOptionalJsonObject(parsed, label);
  return Object.freeze(parsed);
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

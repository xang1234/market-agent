import type { SubjectKind, SubjectRef } from "../../resolver/src/subject-ref.ts";
import { SUBJECT_KINDS } from "../../resolver/src/subject-ref.ts";

export type ChatThreadsDb = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[]; rowCount?: number | null }>;
};

export class ChatThreadNotFoundError extends Error {
  constructor(message = "chat thread not found") {
    super(message);
    this.name = "ChatThreadNotFoundError";
  }
}

export class ChatThreadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatThreadValidationError";
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// UI input cap; column is `text` so bumping requires no schema change.
const MAX_TITLE_LENGTH = 240;

export type ChatThread = {
  thread_id: string;
  user_id: string;
  primary_subject_ref: SubjectRef | null;
  title: string | null;
  latest_snapshot_id: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ListThreadsOptions = {
  includeArchived?: boolean;
};

export async function listThreads(
  db: ChatThreadsDb,
  userId: string,
  options: ListThreadsOptions = {},
): Promise<ChatThread[]> {
  assertUuid(userId, "user_id");
  const includeArchived = options.includeArchived === true;

  const result = await db.query<ChatThreadRow>(
    `select ${THREAD_COLUMNS}
       from chat_threads
      where user_id = $1::uuid
        ${includeArchived ? "" : "and archived_at is null"}
      order by updated_at desc, thread_id desc`,
    [userId],
  );
  return result.rows.map(rowToChatThread);
}

export type CreateThreadInput = {
  primary_subject_ref?: SubjectRef;
  title?: string | null;
};

export async function createThread(
  db: ChatThreadsDb,
  userId: string,
  input: CreateThreadInput = {},
): Promise<ChatThread> {
  assertUuid(userId, "user_id");
  const subject = normalizePrimarySubjectRef(input.primary_subject_ref);
  const title = normalizeOptionalTitle(input.title);

  const result = await db.query<ChatThreadRow>(
    `insert into chat_threads (user_id, primary_subject_kind, primary_subject_id, title)
     values ($1::uuid, $2::subject_kind, $3::uuid, $4)
     returning ${THREAD_COLUMNS}`,
    [userId, subject?.kind ?? null, subject?.id ?? null, title],
  );
  const row = result.rows[0];
  if (!row) throw new Error("createThread: insert returned no row");
  return rowToChatThread(row);
}

export async function getThread(
  db: ChatThreadsDb,
  userId: string,
  threadId: string,
): Promise<ChatThread> {
  assertUuid(userId, "user_id");
  assertUuid(threadId, "thread_id");

  const result = await db.query<ChatThreadRow>(
    `select ${THREAD_COLUMNS}
       from chat_threads
      where user_id = $1::uuid and thread_id = $2::uuid`,
    [userId, threadId],
  );
  const row = result.rows[0];
  if (!row) throw new ChatThreadNotFoundError();
  return rowToChatThread(row);
}

export type UpdateThreadTitleInput = {
  title: string | null;
};

export async function updateThreadTitle(
  db: ChatThreadsDb,
  userId: string,
  threadId: string,
  input: UpdateThreadTitleInput,
): Promise<ChatThread> {
  assertUuid(userId, "user_id");
  assertUuid(threadId, "thread_id");
  const title = normalizeOptionalTitle(input.title);

  const result = await db.query<ChatThreadRow>(
    `update chat_threads
        set title = $3,
            updated_at = now()
      where user_id = $1::uuid and thread_id = $2::uuid
      returning ${THREAD_COLUMNS}`,
    [userId, threadId, title],
  );
  const row = result.rows[0];
  if (!row) throw new ChatThreadNotFoundError();
  return rowToChatThread(row);
}

// Idempotent: archiving an already-archived thread keeps the original
// archived_at timestamp. We only stamp archived_at when it is currently null,
// so callers can safely retry without losing the original archive moment.
export async function archiveThread(
  db: ChatThreadsDb,
  userId: string,
  threadId: string,
): Promise<ChatThread> {
  assertUuid(userId, "user_id");
  assertUuid(threadId, "thread_id");

  const result = await db.query<ChatThreadRow>(
    `update chat_threads
        set archived_at = coalesce(archived_at, now()),
            updated_at = case when archived_at is null then now() else updated_at end
      where user_id = $1::uuid and thread_id = $2::uuid
      returning ${THREAD_COLUMNS}`,
    [userId, threadId],
  );
  const row = result.rows[0];
  if (!row) throw new ChatThreadNotFoundError();
  return rowToChatThread(row);
}

const THREAD_COLUMNS = `
  thread_id::text as thread_id,
  user_id::text as user_id,
  primary_subject_kind,
  primary_subject_id::text as primary_subject_id,
  title,
  latest_snapshot_id::text as latest_snapshot_id,
  archived_at,
  created_at,
  updated_at
`;

type ChatThreadRow = {
  thread_id: string;
  user_id: string;
  primary_subject_kind: SubjectKind | null;
  primary_subject_id: string | null;
  title: string | null;
  latest_snapshot_id: string | null;
  archived_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

function rowToChatThread(row: ChatThreadRow): ChatThread {
  const subjectRef =
    row.primary_subject_kind != null && row.primary_subject_id != null
      ? { kind: row.primary_subject_kind, id: row.primary_subject_id }
      : null;
  return {
    thread_id: row.thread_id,
    user_id: row.user_id,
    primary_subject_ref: subjectRef,
    title: row.title,
    latest_snapshot_id: row.latest_snapshot_id,
    archived_at: toIsoString(row.archived_at),
    created_at: toIsoString(row.created_at) ?? "",
    updated_at: toIsoString(row.updated_at) ?? "",
  };
}

function toIsoString(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function assertUuid(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new ChatThreadValidationError(`${field} must be a UUID`);
  }
}

function normalizeOptionalTitle(title: string | null | undefined): string | null {
  if (title == null) return null;
  if (typeof title !== "string") {
    throw new ChatThreadValidationError("title must be a string when provided");
  }
  const trimmed = title.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_TITLE_LENGTH) {
    throw new ChatThreadValidationError(`title must be ${MAX_TITLE_LENGTH} characters or fewer`);
  }
  return trimmed;
}

function normalizePrimarySubjectRef(value: SubjectRef | undefined): SubjectRef | null {
  if (value === undefined) return null;
  if (typeof value !== "object" || value === null) {
    throw new ChatThreadValidationError("primary_subject_ref must be an object with kind and id");
  }
  const candidate = value as { kind?: unknown; id?: unknown };
  if (typeof candidate.kind !== "string" || !(SUBJECT_KINDS as readonly string[]).includes(candidate.kind)) {
    throw new ChatThreadValidationError(
      `primary_subject_ref.kind must be one of: ${SUBJECT_KINDS.join(", ")}`,
    );
  }
  if (typeof candidate.id !== "string" || !UUID_PATTERN.test(candidate.id)) {
    throw new ChatThreadValidationError("primary_subject_ref.id must be a UUID");
  }
  return { kind: candidate.kind as SubjectKind, id: candidate.id };
}

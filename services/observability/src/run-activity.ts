import { randomUUID } from "node:crypto";

import { serializeJsonValue, type JsonValue, type QueryExecutor } from "./types.ts";

export const RUN_ACTIVITY_STAGES = [
  "reading",
  "investigating",
  "found",
  "dismissed",
] as const;

export type RunActivityStage = (typeof RUN_ACTIVITY_STAGES)[number];

export type SubjectRefJson = {
  kind: string;
  id: string;
};

export type RunActivityInput = {
  user_id?: string | null;
  agent_id: string;
  stage: RunActivityStage;
  subject_refs: ReadonlyArray<SubjectRefJson>;
  source_refs?: ReadonlyArray<string>;
  summary: string;
  ts?: Date | null;
};

export type RunActivityRow = {
  run_activity_id: string;
  user_id: string | null;
  agent_id: string;
  stage: RunActivityStage;
  subject_refs: ReadonlyArray<SubjectRefJson>;
  source_refs: ReadonlyArray<string>;
  summary: string;
  ts: Date;
};

export type RunActivitySseEvent = {
  type: "run_activity";
  seq: number;
  activity: {
    run_activity_id: string;
    user_id: string | null;
    agent_id: string;
    stage: RunActivityStage;
    subject_refs: ReadonlyArray<SubjectRefJson>;
    source_refs: ReadonlyArray<string>;
    summary: string;
    ts: string;
  };
};

export type RunActivityScope = {
  userId: string;
};

export type RunActivityHub = {
  currentSeq(): number;
  eventsForUser(userId: string): ReadonlyArray<RunActivitySseEvent>;
  isSeqAvailableForUser(userId: string, seq: number): boolean;
  publish(activity: RunActivityRow, scope: RunActivityScope): RunActivitySseEvent;
  subscribe(userId: string, listener: (event: RunActivitySseEvent) => void): () => void;
};

export async function writeRunActivity(
  db: QueryExecutor,
  input: RunActivityInput,
): Promise<RunActivityRow> {
  assertRunActivityInput(input);
  const { rows } = await db.query<RunActivityRow>(
    `insert into run_activities (user_id, agent_id, stage, subject_refs, source_refs, summary, ts)
     values ($1::uuid, $2, $3, $4::jsonb, $5::jsonb, $6, coalesce($7::timestamptz, now()))
     returning run_activity_id, user_id, agent_id, stage, subject_refs, source_refs, summary, ts`,
    [
      input.user_id ?? null,
      input.agent_id,
      input.stage,
      serializeJsonValue(input.subject_refs as JsonValue),
      serializeJsonValue((input.source_refs ?? []) as JsonValue),
      input.summary,
      input.ts ?? null,
    ],
  );
  const row = rows[0];
  if (!row) {
    throw new Error("run activity insert returned no row");
  }
  return row;
}

export function createRunActivityHub(
  options: { maxRetainedEvents?: number } = {},
): RunActivityHub {
  const maxRetainedEvents = options.maxRetainedEvents ?? 1000;
  if (!Number.isInteger(maxRetainedEvents) || maxRetainedEvents < 1) {
    throw new Error("run activity hub maxRetainedEvents must be a positive integer");
  }

  let seq = 0;
  const events: Array<{ userId: string; event: RunActivitySseEvent }> = [];
  const listeners = new Set<{ userId: string; listener: (event: RunActivitySseEvent) => void }>();

  return {
    currentSeq() {
      return seq;
    },
    eventsForUser(userId) {
      assertUserId(userId);
      return events
        .filter((entry) => entry.userId === userId)
        .map((entry) => entry.event);
    },
    isSeqAvailableForUser(userId, requestedSeq) {
      assertUserId(userId);
      if (!Number.isSafeInteger(requestedSeq) || requestedSeq < 0) return false;
      if (requestedSeq === 0) return true;
      if (requestedSeq > seq) return false;
      return events.some((entry) => entry.userId === userId && entry.event.seq === requestedSeq);
    },
    publish(activity, scope) {
      assertUserId(scope.userId);
      seq += 1;
      const event = deepFreeze(createRunActivitySseEvent(activity, seq));
      events.push({ userId: scope.userId, event });
      while (events.length > maxRetainedEvents) {
        events.shift();
      }
      for (const entry of [...listeners]) {
        if (entry.userId !== scope.userId) continue;
        try {
          entry.listener(event);
        } catch {
          listeners.delete(entry);
        }
      }
      return event;
    },
    subscribe(userId, listener) {
      assertUserId(userId);
      const entry = { userId, listener };
      listeners.add(entry);
      return () => {
        listeners.delete(entry);
      };
    },
  };
}

export async function writeAndPublishRunActivity(
  db: QueryExecutor,
  hub: RunActivityHub,
  input: RunActivityInput,
  scope: RunActivityScope,
): Promise<RunActivitySseEvent> {
  return hub.publish(await writeRunActivity(db, { ...input, user_id: input.user_id ?? scope.userId }), scope);
}

export function createLiveRunActivity(
  input: RunActivityInput,
  scope: RunActivityScope,
  options: { runActivityId?: string; ts?: Date } = {},
): RunActivityRow {
  const scopedInput = { ...input, user_id: input.user_id ?? scope.userId };
  assertRunActivityInput(scopedInput);
  assertUserId(scope.userId);
  return {
    run_activity_id: options.runActivityId ?? randomUUID(),
    user_id: scopedInput.user_id ?? null,
    agent_id: scopedInput.agent_id,
    stage: scopedInput.stage,
    subject_refs: scopedInput.subject_refs,
    source_refs: scopedInput.source_refs ?? [],
    summary: scopedInput.summary,
    ts: options.ts ?? scopedInput.ts ?? new Date(),
  };
}

export function createRunActivitySseEvent(
  activity: RunActivityRow,
  seq: number,
): RunActivitySseEvent {
  if (!Number.isInteger(seq) || seq < 1) {
    throw new Error("run activity SSE seq must be a positive integer");
  }
  return {
    type: "run_activity",
    seq,
    activity: {
      ...activity,
      ts: activity.ts.toISOString(),
    },
  };
}

function assertRunActivityInput(input: RunActivityInput): void {
  if (!RUN_ACTIVITY_STAGES.includes(input.stage)) {
    throw new Error(`run activity stage is invalid: ${input.stage}`);
  }
  if (input.user_id != null) {
    assertUserId(input.user_id);
  }
  assertNonEmptyString(input.agent_id, "agent_id");
  assertNonEmptyString(input.summary, "summary");
  if (!Array.isArray(input.subject_refs)) {
    throw new Error("run activity subject_refs must be an array");
  }
  for (const subject of input.subject_refs) {
    assertNonEmptyString(subject.kind, "subject_refs.kind");
    assertNonEmptyString(subject.id, "subject_refs.id");
  }
  if (input.source_refs !== undefined) {
    for (const source_ref of input.source_refs) {
      assertNonEmptyString(source_ref, "source_refs");
    }
  }
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`run activity ${label} is required`);
  }
}

function assertUserId(value: unknown): asserts value is string {
  assertNonEmptyString(value, "user_id");
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (seen.has(value)) {
    return value;
  }
  seen.add(value);

  for (const child of Object.values(value)) {
    deepFreeze(child, seen);
  }

  return Object.freeze(value);
}

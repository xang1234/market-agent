import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  createLiveRunActivity,
  createRunActivityHub,
  createRunActivitySseEvent,
  writeRunActivity,
  type RunActivityInput,
} from "../src/run-activity.ts";
import type { QueryExecutor } from "../src/types.ts";

const AGENT_ID = "11111111-1111-4111-8111-111111111111";
const SUBJECT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "44444444-4444-4444-8444-444444444444";
const USER_B = "55555555-5555-4555-8555-555555555555";

test("writeRunActivity persists stage telemetry and returns the stored row", async () => {
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  const run_activity_id = randomUUID();
  const ts = new Date("2026-05-05T10:00:00.000Z");
  const db: QueryExecutor = {
    query: async (text, values) => {
      calls.push({ text, values });
      return {
        rows: [
          {
            run_activity_id,
            user_id: USER_ID,
            agent_id: AGENT_ID,
            stage: "reading",
            subject_refs: [{ kind: "listing", id: SUBJECT_ID }],
            source_refs: ["source-1"],
            summary: "Reading latest 10-Q",
            ts,
          },
        ],
        rowCount: 1,
        command: "INSERT",
        oid: 0,
        fields: [],
      } as never;
    },
  };

  const row = await writeRunActivity(db, input());

  assert.equal(row.run_activity_id, run_activity_id);
  assert.equal(row.user_id, USER_ID);
  assert.equal(row.stage, "reading");
  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /insert into run_activities/i);
  assert.equal(calls[0].values?.[0], USER_ID);
  assert.equal(calls[0].values?.[1], AGENT_ID);
  assert.equal(calls[0].values?.[2], "reading");
  assert.equal(typeof calls[0].values?.[3], "string");
  assert.equal(typeof calls[0].values?.[4], "string");
})

test("createRunActivitySseEvent wraps persisted activity with SSE type and sequence", () => {
  const event = createRunActivitySseEvent(
    {
      run_activity_id: "33333333-3333-4333-8333-333333333333",
      user_id: USER_ID,
      agent_id: AGENT_ID,
      stage: "found",
      subject_refs: [{ kind: "listing", id: SUBJECT_ID }],
      source_refs: [],
      summary: "Found guidance update",
      ts: new Date("2026-05-05T10:00:00.000Z"),
    },
    7,
  );

  assert.equal(event.type, "run_activity");
  assert.equal(event.seq, 7);
  assert.equal(event.activity.user_id, USER_ID);
  assert.equal(event.activity.stage, "found");
  assert.equal(event.activity.ts, "2026-05-05T10:00:00.000Z");
})

test("createLiveRunActivity derives user_id from publish scope", () => {
  const row = createLiveRunActivity(input({ user_id: null }), {
    userId: USER_ID,
  });

  assert.equal(row.user_id, USER_ID);
  assert.equal(row.agent_id, AGENT_ID);
  assert.equal(row.stage, "reading");
});

test("run activity hub validates Last-Event-ID against retained user events", () => {
  const hub = createRunActivityHub({ maxRetainedEvents: 2 });
  hub.publish(createLiveRunActivity(input({ summary: "User A 1" }), { userId: USER_ID }), { userId: USER_ID });
  hub.publish(createLiveRunActivity(input({ summary: "User B" }), { userId: USER_B }), { userId: USER_B });
  hub.publish(createLiveRunActivity(input({ summary: "User A 2" }), { userId: USER_ID }), { userId: USER_ID });

  assert.equal(hub.isSeqAvailableForUser(USER_ID, 0), true);
  assert.equal(hub.isSeqAvailableForUser(USER_ID, 1), false);
  assert.equal(hub.isSeqAvailableForUser(USER_ID, 2), false);
  assert.equal(hub.isSeqAvailableForUser(USER_ID, 3), true);
  assert.equal(hub.isSeqAvailableForUser(USER_ID, 4), false);
});

test("writeRunActivity rejects invalid stage before hitting the database", async () => {
  const db: QueryExecutor = {
    query: async () => {
      throw new Error("query should not run");
    },
  };

  await assert.rejects(
    () => writeRunActivity(db, { ...input(), stage: "queued" as RunActivityInput["stage"] }),
    /stage/,
  );
})

test("writeRunActivity throws a clear error when insert returns no row", async () => {
  const db: QueryExecutor = {
    query: async () => ({ rows: [], rowCount: 0, command: "INSERT", oid: 0, fields: [] }) as never,
  };

  await assert.rejects(
    () => writeRunActivity(db, input()),
    /run activity insert returned no row/,
  );
});

function input(overrides: Partial<RunActivityInput> = {}): RunActivityInput {
  return {
    user_id: USER_ID,
    agent_id: AGENT_ID,
    stage: "reading",
    subject_refs: [{ kind: "listing", id: SUBJECT_ID }],
    source_refs: ["source-1"],
    summary: "Reading latest 10-Q",
    ...overrides,
  };
}

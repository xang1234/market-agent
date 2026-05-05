import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  createRunActivitySseEvent,
  writeRunActivity,
  type RunActivityInput,
} from "../src/run-activity.ts";
import type { QueryExecutor } from "../src/types.ts";

const AGENT_ID = "11111111-1111-4111-8111-111111111111";
const SUBJECT_ID = "22222222-2222-4222-8222-222222222222";

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
  assert.equal(row.stage, "reading");
  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /insert into run_activities/i);
  assert.equal(calls[0].values?.[0], AGENT_ID);
  assert.equal(calls[0].values?.[1], "reading");
  assert.equal(typeof calls[0].values?.[2], "string");
  assert.equal(typeof calls[0].values?.[3], "string");
})

test("createRunActivitySseEvent wraps persisted activity with SSE type and sequence", () => {
  const event = createRunActivitySseEvent(
    {
      run_activity_id: "33333333-3333-4333-8333-333333333333",
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
  assert.equal(event.activity.stage, "found");
  assert.equal(event.activity.ts, "2026-05-05T10:00:00.000Z");
})

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

function input(): RunActivityInput {
  return {
    agent_id: AGENT_ID,
    stage: "reading",
    subject_refs: [{ kind: "listing", id: SUBJECT_ID }],
    source_refs: ["source-1"],
    summary: "Reading latest 10-Q",
  };
}

import assert from "node:assert/strict";
import test from "node:test";

import { getHomeAgentSummaries } from "../src/agent-summaries.ts";
import type { QueryExecutor } from "../src/types.ts";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const AGENT_A = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const AGENT_B = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const AGENT_C = "cccccccc-cccc-4ccc-accc-cccccccccccc";
const RUN_A = "11111111-1111-4111-a111-111111111111";
const RUN_B = "22222222-2222-4222-a222-222222222222";
const FINDING_A = "33333333-3333-4333-a333-333333333333";
const FINDING_B = "44444444-4444-4444-a444-444444444444";

type Row = Record<string, unknown>;
type QueryCall = { text: string; values?: unknown[] };

function fakeDb(rows: ReadonlyArray<Row>): { db: QueryExecutor; calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  return {
    calls,
    db: {
      async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
        calls.push({ text, values });
        return {
          rows: rows as R[],
          command: "SELECT",
          rowCount: rows.length,
          oid: 0,
          fields: [],
        };
      },
    },
  };
}

function row(overrides: Partial<Row>): Row {
  return {
    agent_id: AGENT_A,
    name: "Default agent",
    agent_created_at: "2026-04-01T00:00:00.000Z",
    last_run_id: null,
    last_run_status: null,
    last_run_started_at: null,
    last_run_ended_at: null,
    last_run_duration_ms: null,
    last_run_error: null,
    finding_total: 0,
    finding_hc: 0,
    finding_critical: 0,
    latest_hc_finding_id: null,
    latest_hc_headline: null,
    latest_hc_severity: null,
    latest_hc_created_at: null,
    ...overrides,
  };
}

test("getHomeAgentSummaries SQL filters by user, enabled flag, and window cutoff", async () => {
  const { db, calls } = fakeDb([]);
  await getHomeAgentSummaries(db, {
    user_id: USER_ID,
    window_hours: 24,
    now: "2026-05-05T12:00:00.000Z",
  });
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.match(call.text, /from agents/i);
  assert.match(call.text, /a\.user_id = \$1::uuid/i);
  assert.match(call.text, /a\.enabled = true/i);
  assert.match(call.text, /agent_run_logs/i);
  assert.match(call.text, /findings/i);
  // window cutoff is computed from now - window_hours and passed as $2.
  assert.deepEqual(call.values, [USER_ID, "2026-05-04T12:00:00.000Z"]);
});

test("getHomeAgentSummaries surfaces an agent that has never run", async () => {
  const { db } = fakeDb([row({ agent_id: AGENT_A, name: "Never run" })]);
  const result = await getHomeAgentSummaries(db, {
    user_id: USER_ID,
    window_hours: 24,
    now: "2026-05-05T00:00:00.000Z",
  });
  assert.equal(result.rows.length, 1);
  const r = result.rows[0];
  assert.equal(r.agent_id, AGENT_A);
  assert.equal(r.name, "Never run");
  assert.equal(r.last_run, null);
  assert.deepEqual(r.finding_counts, { total: 0, high_or_critical: 0, critical: 0 });
  assert.equal(r.latest_high_or_critical_finding, null);
});

test("getHomeAgentSummaries projects last_run and counts when present", async () => {
  const { db } = fakeDb([
    row({
      agent_id: AGENT_A,
      name: "Active",
      last_run_id: RUN_A,
      last_run_status: "completed",
      last_run_started_at: "2026-05-05T11:00:00.000Z",
      last_run_ended_at: "2026-05-05T11:05:00.000Z",
      last_run_duration_ms: 300_000,
      last_run_error: null,
      finding_total: 7,
      finding_hc: 3,
      finding_critical: 1,
      latest_hc_finding_id: FINDING_A,
      latest_hc_headline: "Guidance withdrawn",
      latest_hc_severity: "critical",
      latest_hc_created_at: "2026-05-05T10:30:00.000Z",
    }),
  ]);
  const result = await getHomeAgentSummaries(db, {
    user_id: USER_ID,
    window_hours: 24,
    now: "2026-05-05T12:00:00.000Z",
  });
  const r = result.rows[0];
  assert.deepEqual(r.last_run, {
    agent_run_log_id: RUN_A,
    status: "completed",
    started_at: "2026-05-05T11:00:00.000Z",
    ended_at: "2026-05-05T11:05:00.000Z",
    duration_ms: 300_000,
    error: null,
  });
  assert.deepEqual(r.finding_counts, { total: 7, high_or_critical: 3, critical: 1 });
  assert.deepEqual(r.latest_high_or_critical_finding, {
    finding_id: FINDING_A,
    headline: "Guidance withdrawn",
    severity: "critical",
    created_at: "2026-05-05T10:30:00.000Z",
  });
});

test("getHomeAgentSummaries orders critical-bearing agents first, then by last_run.ended_at desc, then created_at desc, then id asc", async () => {
  const { db } = fakeDb([
    row({
      agent_id: AGENT_A,
      agent_created_at: "2026-04-01T00:00:00.000Z",
      last_run_id: RUN_A,
      last_run_status: "completed",
      last_run_started_at: "2026-05-05T08:00:00.000Z",
      last_run_ended_at: "2026-05-05T08:05:00.000Z",
      last_run_duration_ms: 1,
      finding_total: 1,
      finding_hc: 0,
      finding_critical: 0,
    }),
    row({
      agent_id: AGENT_B,
      agent_created_at: "2026-04-02T00:00:00.000Z",
      last_run_id: RUN_B,
      last_run_status: "completed",
      last_run_started_at: "2026-05-05T07:00:00.000Z",
      last_run_ended_at: "2026-05-05T07:05:00.000Z",
      last_run_duration_ms: 1,
      finding_total: 5,
      finding_hc: 2,
      finding_critical: 1,
      latest_hc_finding_id: FINDING_B,
      latest_hc_headline: "Critical hit",
      latest_hc_severity: "critical",
      latest_hc_created_at: "2026-05-05T06:00:00.000Z",
    }),
    row({
      agent_id: AGENT_C,
      agent_created_at: "2026-03-01T00:00:00.000Z",
      last_run_id: null,
      last_run_status: null,
      last_run_started_at: null,
      last_run_ended_at: null,
      last_run_duration_ms: null,
      finding_total: 0,
      finding_hc: 0,
      finding_critical: 0,
    }),
  ]);
  const result = await getHomeAgentSummaries(db, {
    user_id: USER_ID,
    window_hours: 24,
    now: "2026-05-05T12:00:00.000Z",
  });
  assert.deepEqual(
    result.rows.map((r) => r.agent_id),
    [AGENT_B, AGENT_A, AGENT_C],
  );
});

test("getHomeAgentSummaries breaks last_run.ended_at ties by agent.created_at desc", async () => {
  const { db } = fakeDb([
    row({
      agent_id: AGENT_A,
      // Equal ended_at; the deciding signal must be agent.created_at.
      agent_created_at: "2026-04-01T00:00:00.000Z",
      last_run_id: RUN_A,
      last_run_status: "completed",
      last_run_started_at: "2026-05-05T08:00:00.000Z",
      last_run_ended_at: "2026-05-05T08:05:00.000Z",
      last_run_duration_ms: 1,
    }),
    row({
      agent_id: AGENT_B,
      agent_created_at: "2026-04-15T00:00:00.000Z",
      last_run_id: RUN_B,
      last_run_status: "completed",
      last_run_started_at: "2026-05-05T08:00:00.000Z",
      last_run_ended_at: "2026-05-05T08:05:00.000Z",
      last_run_duration_ms: 1,
    }),
  ]);
  const result = await getHomeAgentSummaries(db, {
    user_id: USER_ID,
    window_hours: 24,
    now: "2026-05-05T12:00:00.000Z",
  });
  // AGENT_B was created later, so it ranks first under created_at desc.
  assert.deepEqual(
    result.rows.map((r) => r.agent_id),
    [AGENT_B, AGENT_A],
  );
});

test("getHomeAgentSummaries echoes the resolved window_hours", async () => {
  const { db } = fakeDb([]);
  const result = await getHomeAgentSummaries(db, {
    user_id: USER_ID,
    window_hours: 48,
    now: "2026-05-05T12:00:00.000Z",
  });
  assert.equal(result.window_hours, 48);
});

test("getHomeAgentSummaries defaults window_hours to 24 and rejects out-of-range windows", async () => {
  const { db, calls } = fakeDb([]);
  await getHomeAgentSummaries(db, {
    user_id: USER_ID,
    now: "2026-05-05T12:00:00.000Z",
  });
  assert.deepEqual(calls[0].values, [USER_ID, "2026-05-04T12:00:00.000Z"]);

  await assert.rejects(
    getHomeAgentSummaries(db, {
      user_id: USER_ID,
      window_hours: 0,
      now: "2026-05-05T12:00:00.000Z",
    }),
    /window_hours/i,
  );
  await assert.rejects(
    getHomeAgentSummaries(db, {
      user_id: USER_ID,
      window_hours: 1_000,
      now: "2026-05-05T12:00:00.000Z",
    }),
    /window_hours/i,
  );
});

test("getHomeAgentSummaries rejects malformed user_id", async () => {
  const { db } = fakeDb([]);
  await assert.rejects(
    getHomeAgentSummaries(db, {
      user_id: "not-a-uuid",
      now: "2026-05-05T12:00:00.000Z",
    }),
    /user_id/i,
  );
});

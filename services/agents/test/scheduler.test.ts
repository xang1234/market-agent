import assert from "node:assert/strict";
import test from "node:test";

import { dueAgentRuns, scheduledAgentRuns, type SchedulableAgent } from "../src/scheduler.ts";

const NOW = new Date("2026-11-15T12:00:00.000Z");
const CREATED_AT = "2026-11-01T00:00:00.000Z";

function agent(agent_id: string, cadence: string, enabled = true): SchedulableAgent {
  return { agent_id, cadence, enabled, created_at: CREATED_AT };
}

const HOURLY_61 = "11111111-1111-4111-8111-111111111111";
const HOURLY_59 = "22222222-2222-4222-8222-222222222222";
const DISABLED = "33333333-3333-4333-8333-333333333333";
const ON_FILING = "44444444-4444-4444-8444-444444444444";
const NEVER_RAN = "55555555-5555-4555-8555-555555555555";

const agents = [
  agent(HOURLY_61, "hourly"),
  agent(HOURLY_59, "hourly"),
  agent(DISABLED, "hourly", false),
  agent(ON_FILING, "on-filing"),
  agent(NEVER_RAN, "daily"),
];
const lastRuns = new Map([
  [HOURLY_61, "2026-11-15T10:59:00.000Z"],
  [HOURLY_59, "2026-11-15T11:01:00.000Z"],
  [DISABLED, "2026-11-15T09:00:00.000Z"],
  [ON_FILING, "2026-11-15T09:00:00.000Z"],
]);

test("dueAgentRuns returns enabled interval agents whose next run is at or before now", () => {
  const due = dueAgentRuns(agents, lastRuns, NOW);
  assert.deepEqual(due.map(({ agent_id, due_at }) => ({ agent_id, due_at })), [
    { agent_id: HOURLY_61, due_at: "2026-11-15T11:59:00.000Z" },
    { agent_id: NEVER_RAN, due_at: "2026-11-02T00:00:00.000Z" },
  ]);
});

test("scheduledAgentRuns lists the next due time of agents that are not due yet", () => {
  assert.deepEqual(
    scheduledAgentRuns(agents, lastRuns).map(({ agent_id, due_at }) => ({ agent_id, due_at })),
    [
      { agent_id: HOURLY_61, due_at: "2026-11-15T11:59:00.000Z" },
      { agent_id: HOURLY_59, due_at: "2026-11-15T12:01:00.000Z" },
      { agent_id: NEVER_RAN, due_at: "2026-11-02T00:00:00.000Z" },
    ],
  );
});

test("one due run keeps one run id across calls, and the next due time gets another", () => {
  const [first] = dueAgentRuns(agents, lastRuns, NOW);
  const [second] = dueAgentRuns(agents, lastRuns, NOW);
  assert.equal(first.run_id, second.run_id);
  assert.match(first.run_id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

  const [later] = dueAgentRuns(agents, new Map([[HOURLY_61, "2026-11-15T11:00:00.000Z"]]), NOW);
  assert.equal(later.agent_id, HOURLY_61);
  assert.notEqual(later.run_id, first.run_id);
});

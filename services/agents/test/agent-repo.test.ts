import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult } from "pg";

import {
  AgentValidationError,
  createAgent,
  disableAgent,
  getAgent,
  listAgentsByUser,
  updateAgent,
  type AgentInput,
  type AgentUpdate,
  type QueryExecutor,
} from "../src/agent-repo.ts";

const AGENT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const ISSUER_ID = "33333333-3333-4333-8333-333333333333";
const SCREEN_ID = "44444444-4444-4444-8444-444444444444";
const FIXED_NOW = "2026-05-04T00:00:00.000Z";

type Captured = { text: string; values?: unknown[] };

function fakeDb(
  responder: (text: string, values?: unknown[]) => unknown[],
): { db: { query: QueryExecutor["query"] }; queries: Captured[] } {
  const queries: Captured[] = [];
  return {
    queries,
    db: {
      async query<R extends Record<string, unknown> = Record<string, unknown>>(
        text: string,
        values?: unknown[],
      ): Promise<QueryResult<R>> {
        queries.push({ text, values });
        const rows = responder(text, values) as R[];
        return { rows, rowCount: rows.length, command: "", oid: 0, fields: [] };
      },
    },
  };
}

function agentRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    agent_id: AGENT_ID,
    user_id: USER_ID,
    name: "Margin recovery monitor",
    thesis: "Track margin recovery after inventory normalization.",
    universe: { mode: "static", subject_refs: [{ kind: "issuer", id: ISSUER_ID }] },
    source_policy: null,
    cadence: "daily",
    prompt_template: "Watch the latest filings and evidence-backed claims.",
    alert_rules: [],
    watermarks: {},
    enabled: true,
    created_at: FIXED_NOW,
    updated_at: FIXED_NOW,
    ...overrides,
  };
}

const staticInput: AgentInput = {
  user_id: USER_ID,
  name: "Margin recovery monitor",
  thesis: "Track margin recovery after inventory normalization.",
  universe: { mode: "static", subject_refs: [{ kind: "issuer", id: ISSUER_ID }] },
  cadence: "daily",
  prompt_template: "Watch the latest filings and evidence-backed claims.",
};

test("createAgent inserts a durable static-universe agent and returns a frozen row", async () => {
  const { db, queries } = fakeDb(() => [agentRow()]);

  const row = await createAgent(db, staticInput);

  assert.equal(row.agent_id, AGENT_ID);
  assert.equal(row.user_id, USER_ID);
  assert.deepEqual(row.universe, {
    mode: "static",
    subject_refs: [{ kind: "issuer", id: ISSUER_ID }],
  });
  assert.equal(row.enabled, true);
  assert.deepEqual(row.alert_rules, []);
  assert.deepEqual(row.watermarks, {});
  assert.equal(Object.isFrozen(row), true);
  assert.equal(Object.isFrozen(row.universe), true);
  assert.match(queries[0].text, /insert into agents/);
  assert.equal(queries[0].values?.[0], USER_ID);
  assert.equal(queries[0].values?.[4], JSON.stringify(staticInput.universe));
});

test("createAgent accepts a dynamic screen universe without expanding membership", async () => {
  const input: AgentInput = {
    ...staticInput,
    universe: { mode: "screen", screen_id: SCREEN_ID },
  };
  const { db, queries } = fakeDb(() => [agentRow({ universe: input.universe })]);

  const row = await createAgent(db, input);

  assert.deepEqual(row.universe, { mode: "screen", screen_id: SCREEN_ID });
  assert.equal(queries[0].values?.[4], JSON.stringify({ mode: "screen", screen_id: SCREEN_ID }));
});

test("createAgent rejects malformed agent input before issuing SQL", async () => {
  const { db, queries } = fakeDb(() => []);

  await assert.rejects(
    createAgent(db, { ...staticInput, name: "" }),
    (error: Error) => error instanceof AgentValidationError && /name/.test(error.message),
  );
  await assert.rejects(
    createAgent(db, {
      ...staticInput,
      universe: { mode: "static", subject_refs: [{ kind: "issuer", id: "" }] },
    }),
    (error: Error) => error instanceof AgentValidationError && /subject_refs\[0\]/.test(error.message),
  );
  await assert.rejects(
    createAgent(db, { ...staticInput, universe: { mode: "screen", screen_id: "not-a-uuid" } }),
    (error: Error) => error instanceof AgentValidationError && /screen_id.*UUID/.test(error.message),
  );

  assert.equal(queries.length, 0);
});

test("listAgentsByUser scopes by user_id and orders newest first", async () => {
  const { db, queries } = fakeDb(() => [
    agentRow({ agent_id: AGENT_ID }),
    agentRow({ agent_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Second" }),
  ]);

  const rows = await listAgentsByUser(db, USER_ID);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].agent_id, AGENT_ID);
  assert.match(queries[0].text, /where user_id = \$1::uuid/);
  assert.match(queries[0].text, /order by created_at desc, agent_id asc/);
});

test("getAgent returns null when no row exists", async () => {
  const { db } = fakeDb(() => []);
  assert.equal(await getAgent(db, AGENT_ID), null);
});

test("updateAgent patches only mutable config fields and bumps updated_at", async () => {
  const patch: AgentUpdate = {
    thesis: "Track gross margin recovery and channel inventory.",
    cadence: "hourly",
    alert_rules: [{ kind: "severity_at_least", severity: "high" }],
  };
  const { db, queries } = fakeDb(() => [
    agentRow({ thesis: patch.thesis, cadence: patch.cadence, alert_rules: patch.alert_rules }),
  ]);

  const row = await updateAgent(db, AGENT_ID, patch);

  assert.equal(row.thesis, patch.thesis);
  assert.equal(row.cadence, "hourly");
  assert.deepEqual(row.alert_rules, patch.alert_rules);
  assert.match(queries[0].text, /updated_at = now\(\)/);
  assert.equal(queries[0].values?.[0], AGENT_ID);
});

test("updateAgent rejects null clears for nullable fields instead of silently preserving or JSON-null writing", async () => {
  const { db, queries } = fakeDb(() => []);

  await assert.rejects(
    updateAgent(db, AGENT_ID, { prompt_template: null }),
    (error: Error) => error instanceof AgentValidationError && /prompt_template/.test(error.message),
  );
  await assert.rejects(
    updateAgent(db, AGENT_ID, { source_policy: null }),
    (error: Error) => error instanceof AgentValidationError && /source_policy/.test(error.message),
  );

  assert.equal(queries.length, 0);
});

test("disableAgent turns off an agent without deleting durable configuration", async () => {
  const { db, queries } = fakeDb(() => [agentRow({ enabled: false })]);

  const row = await disableAgent(db, AGENT_ID);

  assert.equal(row.enabled, false);
  assert.match(queries[0].text, /set enabled = false/);
});

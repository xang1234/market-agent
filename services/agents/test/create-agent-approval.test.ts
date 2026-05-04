import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult } from "pg";

import { loadToolRegistry } from "../../tools/src/registry.ts";
import {
  CreateAgentApprovalError,
  applyApprovedCreateAgent,
  approveCreateAgentAction,
  createAgentApprovalIntent,
} from "../src/create-agent-approval.ts";
import type { AgentInput } from "../src/agent-repo.ts";

const AGENT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const ISSUER_ID = "33333333-3333-4333-8333-333333333333";
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

type QueryExecutor = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
};

const input: AgentInput = {
  user_id: USER_ID,
  name: "Margin recovery monitor",
  thesis: "Track margin recovery after inventory normalization.",
  universe: { mode: "static", subject_refs: [{ kind: "issuer", id: ISSUER_ID }] },
  cadence: "daily",
  prompt_template: "Watch the latest filings and evidence-backed claims.",
};

function agentRow() {
  return {
    agent_id: AGENT_ID,
    user_id: USER_ID,
    name: input.name,
    thesis: input.thesis,
    universe: input.universe,
    source_policy: null,
    cadence: input.cadence,
    prompt_template: input.prompt_template,
    alert_rules: [],
    watermarks: {},
    enabled: true,
    created_at: FIXED_NOW,
    updated_at: FIXED_NOW,
  };
}

test("createAgentApprovalIntent returns a deterministic pending action and does not insert an agent", async () => {
  const { db, queries } = fakeDb(() => {
    throw new Error("createAgentApprovalIntent must not query the database");
  });

  const intent = createAgentApprovalIntent({
    registry: loadToolRegistry(),
    input,
    idempotency_key: "turn-5/tool-1",
  });

  assert.equal(intent.confirmation_required, true);
  assert.equal(intent.pending_action.tool_name, "create_agent");
  assert.equal(intent.pending_action.bundle_id, "agent_management");
  assert.equal(intent.pending_action.approval_required, true);
  assert.equal(intent.pending_action.read_only, false);
  assert.deepEqual(intent.pending_action.arguments, input);
  assert.match(
    intent.pending_action_id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.equal(queries.length, 0);
  await assert.rejects(db.query("select 1"), /must not query/);
});

test("createAgentApprovalIntent rejects invalid agent config before minting a pending action", () => {
  assert.throws(
    () =>
      createAgentApprovalIntent({
        registry: loadToolRegistry(),
        input: { ...input, cadence: "weekly" },
        idempotency_key: "turn-5/tool-invalid",
      }),
    (error: Error) => error instanceof CreateAgentApprovalError && /cadence/.test(error.message),
  );
});

test("applyApprovedCreateAgent creates an enabled agent from the approved pending action", async () => {
  const { db, queries } = fakeDb(() => [agentRow()]);
  const intent = createAgentApprovalIntent({
    registry: loadToolRegistry(),
    input,
    idempotency_key: "turn-5/tool-1",
  });

  const agent = await applyApprovedCreateAgent(
    db,
    approveCreateAgentAction(intent.pending_action, {
      approved_by_user_id: USER_ID,
      approved_at: "2026-05-04T00:00:00.000Z",
    }),
  );

  assert.equal(agent.agent_id, AGENT_ID);
  assert.equal(agent.enabled, true);
  assert.match(queries[0].text, /insert into agents/);
  assert.equal(queries[0].values?.[9], true);
});

test("approveCreateAgentAction rejects a pending action for the wrong tool", () => {
  const intent = createAgentApprovalIntent({
    registry: loadToolRegistry(),
    input,
    idempotency_key: "turn-5/tool-1",
  });

  assert.throws(
    () =>
      approveCreateAgentAction(
        { ...intent.pending_action, tool_name: "create_alert" },
        { approved_by_user_id: USER_ID, approved_at: FIXED_NOW },
      ),
    /create_agent/,
  );
});

test("applyApprovedCreateAgent rejects a raw pending action that has not been approved", async () => {
  const { db, queries } = fakeDb(() => []);
  const intent = createAgentApprovalIntent({
    registry: loadToolRegistry(),
    input,
    idempotency_key: "turn-5/tool-1",
  });

  await assert.rejects(
    applyApprovedCreateAgent(db, intent.pending_action),
    /approved create_agent action/i,
  );
  assert.equal(queries.length, 0);
});

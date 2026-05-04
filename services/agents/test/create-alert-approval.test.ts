import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult } from "pg";

import { loadToolRegistry } from "../../tools/src/registry.ts";
import type { QueryExecutor } from "../src/agent-repo.ts";
import {
  CreateAlertApprovalError,
  applyApprovedCreateAlert,
  approveCreateAlertAction,
  createAlertApprovalIntent,
  type CreateAlertInput,
} from "../src/create-alert-approval.ts";

const AGENT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const ISSUER_ID = "33333333-3333-4333-8333-333333333333";
const FIXED_NOW = "2026-05-04T00:00:00.000Z";

type Captured = { text: string; values?: unknown[] };

const input: CreateAlertInput = {
  agent_id: AGENT_ID,
  subject_ref: { kind: "issuer", id: ISSUER_ID },
  rule: {
    rule_id: "critical-margin-risk",
    severity_at_least: "high",
    headline_contains: "margin risk",
  },
  channels: ["email"],
};

function agentRow(alertRules: unknown[] = []) {
  return {
    agent_id: AGENT_ID,
    user_id: USER_ID,
    name: "Margin recovery monitor",
    thesis: "Track margin recovery after inventory normalization.",
    universe: { mode: "static", subject_refs: [{ kind: "issuer", id: ISSUER_ID }] },
    source_policy: null,
    cadence: "daily",
    prompt_template: null,
    alert_rules: alertRules,
    watermarks: {},
    enabled: true,
    created_at: FIXED_NOW,
    updated_at: FIXED_NOW,
  };
}

test("createAlertApprovalIntent returns a deterministic pending action and does not write alert rules", async () => {
  const { db, queries } = fakeDb(() => {
    throw new Error("createAlertApprovalIntent must not query the database");
  });

  const intent = createAlertApprovalIntent({
    registry: loadToolRegistry(),
    input,
    idempotency_key: "turn-9/tool-1",
  });

  assert.equal(intent.confirmation_required, true);
  assert.equal(intent.pending_action.tool_name, "create_alert");
  assert.equal(intent.pending_action.bundle_id, "alert_management");
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

test("applyApprovedCreateAlert appends the compiled alert rule after approval", async () => {
  const expectedRule = {
    rule_id: "critical-margin-risk",
    subject: { kind: "issuer", id: ISSUER_ID },
    severity_at_least: "high",
    headline_contains: "margin risk",
    channels: ["email"],
  };
  const { db, queries } = fakeDb((text) => {
    if (/select/.test(text)) return [agentRow()];
    if (/update agents/.test(text)) return [agentRow([expectedRule])];
    return [];
  });
  const intent = createAlertApprovalIntent({
    registry: loadToolRegistry(),
    input,
    idempotency_key: "turn-9/tool-1",
  });

  const agent = await applyApprovedCreateAlert(
    db,
    approveCreateAlertAction(intent.pending_action, {
      approved_by_user_id: USER_ID,
      approved_at: FIXED_NOW,
    }),
  );

  assert.deepEqual(agent.alert_rules, [expectedRule]);
  assert.match(queries[0].text, /select/);
  assert.match(queries[1].text, /update agents/);
  assert.equal(queries[1].values?.[0], AGENT_ID);
  assert.deepEqual(JSON.parse(String(queries[1].values?.[7])), [expectedRule]);
});

test("createAlertApprovalIntent rejects invalid declarative rules before minting a pending action", () => {
  assert.throws(
    () =>
      createAlertApprovalIntent({
        registry: loadToolRegistry(),
        input: {
          ...input,
          rule: { rule_id: "bad", javascript: "finding.severity === 'high'" },
        },
      }),
    (error: Error) =>
      error instanceof CreateAlertApprovalError && /unsupported alert rule field/.test(error.message),
  );
});

test("applyApprovedCreateAlert rejects pending actions that have not been approved", async () => {
  const { db, queries } = fakeDb(() => []);
  const intent = createAlertApprovalIntent({
    registry: loadToolRegistry(),
    input,
    idempotency_key: "turn-9/tool-1",
  });

  await assert.rejects(
    applyApprovedCreateAlert(db, intent.pending_action),
    /approved create_alert action/i,
  );
  assert.equal(queries.length, 0);
});

function fakeDb(
  responder: (text: string, values?: unknown[]) => unknown[],
): { db: QueryExecutor; queries: Captured[] } {
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

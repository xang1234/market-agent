import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult } from "pg";

import {
  evaluateAgentAlerts,
  type AlertFiredRow,
} from "../src/alert-evaluator.ts";
import type { QueryExecutor } from "../src/agent-repo.ts";

const AGENT_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const FINDING_ID = "33333333-3333-4333-8333-333333333333";
const ALERT_FIRED_ID = "44444444-4444-4444-8444-444444444444";
const CLUSTER_ID = "55555555-5555-4555-8555-555555555555";

test("evaluateAgentAlerts logs an explainable firing for matching rules", async () => {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const db = fakeDb((text, values) => {
    queries.push({ text, values });
    assert.match(text, /insert into alerts_fired/i);
    return [
      {
        alert_fired_id: ALERT_FIRED_ID,
        agent_id: AGENT_ID,
        run_id: RUN_ID,
        rule_id: "critical-margin-risk",
        finding_id: FINDING_ID,
        channels: ["email"],
        trigger_refs: JSON.parse(String(values?.[5])),
        status: "pending_notification",
        fired_at: "2026-05-04T00:00:00.000Z",
      },
    ];
  });

  const result = await evaluateAgentAlerts(db, {
    agent_id: AGENT_ID,
    run_id: RUN_ID,
    alert_rules: [
      {
        rule_id: "critical-margin-risk",
        severity_at_least: "high",
        headline_contains: "margin risk",
        claim_cluster_id_in: [CLUSTER_ID],
        channels: ["email"],
      },
    ],
    findings: [
      {
        finding_id: FINDING_ID,
        agent_id: AGENT_ID,
        snapshot_id: "66666666-6666-4666-8666-666666666666",
        subject_refs: [{ kind: "issuer", id: AGENT_ID }],
        claim_cluster_ids: [CLUSTER_ID],
        severity: "critical",
        headline: "Margin risk widened after supplier warning",
        summary_blocks: [],
        created_at: "2026-05-04T00:00:00.000Z",
      },
    ],
  });

  assert.equal(result.evaluated_rules, 1);
  assert.equal(result.evaluated_findings, 1);
  assert.deepEqual(result.fired, [
    {
      alert_fired_id: ALERT_FIRED_ID,
      agent_id: AGENT_ID,
      run_id: RUN_ID,
      rule_id: "critical-margin-risk",
      finding_id: FINDING_ID,
      channels: ["email"],
      trigger_refs: [
        { kind: "finding", id: FINDING_ID },
        { kind: "claim_cluster", id: CLUSTER_ID },
      ],
      status: "pending_notification",
      fired_at: "2026-05-04T00:00:00.000Z",
    } satisfies AlertFiredRow,
  ]);
  assert.deepEqual(queries[0]?.values?.slice(0, 5), [
    AGENT_ID,
    RUN_ID,
    "critical-margin-risk",
    FINDING_ID,
    JSON.stringify(["email"]),
  ]);
});

test("evaluateAgentAlerts does not write firing rows when predicates do not match", async () => {
  let writes = 0;
  const db = fakeDb(() => {
    writes += 1;
    return [];
  });

  const result = await evaluateAgentAlerts(db, {
    agent_id: AGENT_ID,
    run_id: RUN_ID,
    alert_rules: [
      {
        rule_id: "critical-margin-risk",
        severity_at_least: "critical",
        channels: ["email"],
      },
    ],
    findings: [
      {
        finding_id: FINDING_ID,
        agent_id: AGENT_ID,
        snapshot_id: "66666666-6666-4666-8666-666666666666",
        subject_refs: [{ kind: "issuer", id: AGENT_ID }],
        claim_cluster_ids: [],
        severity: "medium",
        headline: "Revenue growth accelerated",
        summary_blocks: [],
        created_at: "2026-05-04T00:00:00.000Z",
      },
    ],
  });

  assert.equal(writes, 0);
  assert.deepEqual(result.fired, []);
});

test("evaluateAgentAlerts rejects findings that belong to a different agent", async () => {
  const db = fakeDb(() => {
    throw new Error("mixed-agent findings must be rejected before SQL");
  });

  await assert.rejects(
    evaluateAgentAlerts(db, {
      agent_id: AGENT_ID,
      run_id: RUN_ID,
      alert_rules: [
        {
          rule_id: "critical-margin-risk",
          severity_at_least: "high",
          channels: ["email"],
        },
      ],
      findings: [
        {
          finding_id: FINDING_ID,
          agent_id: "77777777-7777-4777-8777-777777777777",
          snapshot_id: "66666666-6666-4666-8666-666666666666",
          subject_refs: [{ kind: "issuer", id: AGENT_ID }],
          claim_cluster_ids: [],
          severity: "critical",
          headline: "Margin risk widened after supplier warning",
          summary_blocks: [],
          created_at: "2026-05-04T00:00:00.000Z",
        },
      ],
    }),
    /findings\[0\]\.agent_id must match agent_id/,
  );
});

function fakeDb(
  handler: (text: string, values?: unknown[]) => ReadonlyArray<Record<string, unknown>>,
): QueryExecutor {
  return {
    async query<R extends Record<string, unknown>>(
      text: string,
      values?: unknown[],
    ): Promise<QueryResult<R>> {
      return {
        rows: handler(text, values) as R[],
        rowCount: 0,
        command: "",
        oid: 0,
        fields: [],
      };
    },
  };
}

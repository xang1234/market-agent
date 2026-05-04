import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult } from "pg";

import { runAgentLoop } from "../src/agent-loop.ts";

const AGENT_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "33333333-3333-4333-8333-333333333333";
const FINDING_ID = "44444444-4444-4444-8444-444444444444";
const ALERT_FIRED_ID = "55555555-5555-4555-8555-555555555555";

type Captured = { text: string; values?: unknown[] };

type TxClient = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
  release(error?: Error): void;
};

function fakePool(): { pool: { connect(): Promise<TxClient> }; queries: Captured[]; released: unknown[] } {
  const queries: Captured[] = [];
  const released: unknown[] = [];
  const client: TxClient = {
    async query<R extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      values?: unknown[],
    ): Promise<QueryResult<R>> {
      queries.push({ text, values });
      const rowCount = /update agents/.test(text) ? 1 : 0;
      return { rows: [], rowCount, command: "", oid: 0, fields: [] };
    },
    release(error?: Error): void {
      released.push(error);
    },
  };
  return {
    queries,
    released,
    pool: {
      async connect(): Promise<TxClient> {
        return client;
      },
    },
  };
}

test("runAgentLoop executes injectable stages in order and advances watermarks after side effects", async () => {
  const order: string[] = [];
  const { pool, queries, released } = fakePool();

  const result = await runAgentLoop({
    pool,
    agent_id: AGENT_ID,
    current_watermarks: { source_cursor: "old" },
    stages: {
      readDeltas: async () => {
        order.push("read");
        return { documents: 2 };
      },
      extractEvidence: async ({ deltas }) => {
        order.push(`extract:${deltas.documents}`);
        return { claims: 3 };
      },
      clusterEvidence: async ({ evidence }) => {
        order.push(`cluster:${evidence.claims}`);
        return { clusters: 1 };
      },
      analyze: async ({ clusters }) => {
        order.push(`analyze:${clusters.clusters}`);
        return { findings: [{ headline: "Demand improved" }] };
      },
      applySideEffects: async ({ tx, analysis }) => {
        order.push(`side-effects:${analysis.findings.length}`);
        await tx.query("insert into findings (agent_id, headline) values ($1, $2)", [
          AGENT_ID,
          analysis.findings[0].headline,
        ]);
        return { findings: analysis.findings.length };
      },
      nextWatermarks: async () => {
        order.push("watermarks");
        return { source_cursor: "new" };
      },
    },
  });

  assert.deepEqual(order, [
    "read",
    "extract:2",
    "cluster:3",
    "analyze:1",
    "watermarks",
    "side-effects:1",
  ]);
  assert.deepEqual(result.outputs_summary, { findings: 1 });
  assert.deepEqual(result.next_watermarks, { source_cursor: "new" });
  assert.deepEqual(queries.map((query) => query.text), [
    "begin",
    "insert into findings (agent_id, headline) values ($1, $2)",
    `update agents
          set watermarks = $2::jsonb,
              updated_at = now()
        where agent_id = $1::uuid`,
    "commit",
  ]);
  assert.equal(released.length, 1);
  assert.equal(released[0], undefined);
});

test("runAgentLoop rolls back and does not advance watermarks when side effects fail", async () => {
  const { pool, queries, released } = fakePool();

  await assert.rejects(
    runAgentLoop({
      pool,
      agent_id: AGENT_ID,
      current_watermarks: {},
      stages: {
        readDeltas: async () => ({}),
        extractEvidence: async () => ({}),
        clusterEvidence: async () => ({}),
        analyze: async () => ({}),
        nextWatermarks: async () => ({ cursor: "new" }),
        applySideEffects: async () => {
          throw new Error("finding insert failed");
        },
      },
    }),
    /finding insert failed/,
  );

  assert.deepEqual(queries.map((query) => query.text), ["begin", "rollback"]);
  assert.equal(released.length, 1, "client must be released after rollback");
  assert.equal(released[0], undefined);
});

test("runAgentLoop evaluates alert rules inside the side-effect transaction after findings are available", async () => {
  const queries: Captured[] = [];
  const released: unknown[] = [];
  const client: TxClient = {
    async query<R extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      values?: unknown[],
    ): Promise<QueryResult<R>> {
      queries.push({ text, values });
      if (/insert into alerts_fired/.test(text)) {
        return {
          rows: [
            {
              alert_fired_id: ALERT_FIRED_ID,
              agent_id: AGENT_ID,
              run_id: RUN_ID,
              rule_id: "high-margin-risk",
              finding_id: FINDING_ID,
              channels: ["email"],
              trigger_refs: JSON.parse(String(values?.[5])),
              status: "pending_notification",
              fired_at: "2026-05-04T00:00:00.000Z",
            },
          ] as R[],
          rowCount: 1,
          command: "",
          oid: 0,
          fields: [],
        };
      }
      const rowCount = /update agents/.test(text) ? 1 : 0;
      return { rows: [], rowCount, command: "", oid: 0, fields: [] };
    },
    release(error?: Error): void {
      released.push(error);
    },
  };

  const result = await runAgentLoop({
    pool: {
      async connect() {
        return client;
      },
    },
    agent_id: AGENT_ID,
    run_id: RUN_ID,
    current_watermarks: {},
    alert_rules: [
      {
        rule_id: "high-margin-risk",
        severity_at_least: "high",
        headline_contains: "margin risk",
        channels: ["email"],
      },
    ],
    stages: {
      readDeltas: async () => ({}),
      extractEvidence: async () => ({}),
      clusterEvidence: async () => ({}),
      analyze: async () => ({
        findings: [
          {
            finding_id: FINDING_ID,
            agent_id: AGENT_ID,
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
      nextWatermarks: async () => ({ cursor: "new" }),
      applySideEffects: async () => ({ findings: 1 }),
      alertFindings: async ({ analysis }) => analysis.findings,
    },
  });

  assert.deepEqual(result.outputs_summary, {
    findings: 1,
    alerts: { evaluated_rules: 1, evaluated_findings: 1, fired: 1 },
  });
  assert.ok(queries.some((query) => /insert into alerts_fired/.test(query.text)));
  assert.deepEqual(queries.map((query) => query.text).at(-1), "commit");
  assert.equal(released[0], undefined);
});

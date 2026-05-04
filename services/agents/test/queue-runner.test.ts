import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult } from "pg";

import {
  AgentRunMessageValidationError,
  handleAgentRunMessage,
} from "../src/queue-runner.ts";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID_2 = "11111111-1111-4111-8111-111111111112";
const AGENT_ID = "22222222-2222-4222-8222-222222222222";
const AGENT_ID_2 = "22222222-2222-4222-8222-222222222223";
const STARTED_AT = "2026-05-04T00:00:00.000Z";
const ENDED_AT = "2026-05-04T00:00:01.000Z";

type Captured = { text: string; values?: unknown[] };

type QueryExecutor = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
};

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

test("handleAgentRunMessage claims a new run, executes once, and completes the run log", async () => {
  let executions = 0;
  const { db, queries } = fakeDb((text, values) => {
    if (text.trimStart().startsWith("select")) {
      return [];
    }
    if (/insert into agent_run_logs/.test(text)) {
      return [
        {
          agent_run_log_id: values?.[0],
          agent_id: values?.[1],
          started_at: STARTED_AT,
          ended_at: null,
          duration_ms: null,
          inputs_watermark: null,
          outputs_summary: null,
          status: "running",
          error: null,
        },
      ];
    }
    if (/update agent_run_logs/.test(text) && /status = 'completed'/.test(text)) {
      return [
        {
          agent_run_log_id: values?.[0],
          agent_id: AGENT_ID,
          started_at: STARTED_AT,
          ended_at: ENDED_AT,
          duration_ms: 1000,
          inputs_watermark: null,
          outputs_summary: JSON.parse(values?.[1] as string),
          status: "completed",
          error: null,
        },
      ];
    }
    return [];
  });

  const result = await handleAgentRunMessage(db, {
    message: { run_id: RUN_ID, agent_id: AGENT_ID },
    execute: async () => {
      executions += 1;
      return { findings: 1 };
    },
  });

  assert.equal(result.status, "completed");
  assert.equal(result.run_id, RUN_ID);
  assert.equal(executions, 1);
  assert.match(queries[0].text, /status = 'running'/);
  assert.match(queries[1].text, /insert into agent_run_logs/);
  assert.match(queries.at(-1)?.text ?? "", /update agent_run_logs/);
  assert.equal(queries.at(-1)?.values?.[1], JSON.stringify({ findings: 1 }));
});

test("handleAgentRunMessage short-circuits duplicate run_id before side effects", async () => {
  let executions = 0;
  const { db, queries } = fakeDb((text, values) => {
    if (text.trimStart().startsWith("select")) {
      if (/where agent_run_log_id = \$1::uuid/.test(text)) {
        return [
          {
            agent_run_log_id: values?.[0],
            agent_id: AGENT_ID,
            started_at: STARTED_AT,
            ended_at: ENDED_AT,
            duration_ms: 1000,
            inputs_watermark: null,
            outputs_summary: { findings: 1 },
            status: "completed",
            error: null,
          },
        ];
      }
      return [];
    }
    if (/insert into agent_run_logs/.test(text)) {
      return [];
    }
    return [];
  });

  const result = await handleAgentRunMessage(db, {
    message: { run_id: RUN_ID, agent_id: AGENT_ID },
    execute: async () => {
      executions += 1;
      return { findings: 99 };
    },
  });

  assert.equal(result.status, "duplicate");
  assert.equal(result.run_id, RUN_ID);
  assert.equal(executions, 0);
  assert.equal(queries.length, 3);
});

test("handleAgentRunMessage short-circuits duplicate run_id while the original run is still running", async () => {
  let executions = 0;
  const { db } = fakeDb((text, values) => {
    if (text.trimStart().startsWith("select")) {
      if (/where agent_run_log_id = \$1::uuid/.test(text)) {
        return [
          {
            agent_run_log_id: values?.[0],
            agent_id: AGENT_ID,
            started_at: STARTED_AT,
            ended_at: null,
            duration_ms: null,
            inputs_watermark: null,
            outputs_summary: null,
            status: "running",
            error: null,
          },
        ];
      }
      return [];
    }
    if (/insert into agent_run_logs/.test(text)) {
      return [];
    }
    return [];
  });

  const result = await handleAgentRunMessage(db, {
    message: { run_id: RUN_ID, agent_id: AGENT_ID },
    execute: async () => {
      executions += 1;
      return { findings: 99 };
    },
  });

  assert.equal(result.status, "duplicate");
  assert.equal(executions, 0);
});

test("handleAgentRunMessage rejects malformed ids before SQL", async () => {
  const { db, queries } = fakeDb(() => []);

  await assert.rejects(
    handleAgentRunMessage(db, {
      message: { run_id: "not-a-uuid", agent_id: AGENT_ID },
      execute: async () => ({ findings: 1 }),
    }),
    (error: Error) =>
      error instanceof AgentRunMessageValidationError && /run_id.*UUID/.test(error.message),
  );
  await assert.rejects(
    handleAgentRunMessage(db, {
      message: { run_id: RUN_ID, agent_id: "" },
      execute: async () => ({ findings: 1 }),
    }),
    (error: Error) =>
      error instanceof AgentRunMessageValidationError && /agent_id/.test(error.message),
  );

  assert.equal(queries.length, 0);
});

test("handleAgentRunMessage skips a new run when another run is active for the same agent", async () => {
  let executions = 0;
  const { db, queries } = fakeDb((text) => {
    if (text.trimStart().startsWith("select")) {
      return [
        {
          agent_run_log_id: RUN_ID,
          agent_id: AGENT_ID,
          started_at: STARTED_AT,
          ended_at: null,
          duration_ms: null,
          inputs_watermark: null,
          outputs_summary: null,
          status: "running",
          error: null,
        },
      ];
    }
    return [];
  });

  const result = await handleAgentRunMessage(db, {
    message: { run_id: RUN_ID_2, agent_id: AGENT_ID },
    execute: async () => {
      executions += 1;
      return { findings: 1 };
    },
  });

  assert.equal(result.status, "skipped_concurrency_limit");
  assert.equal(result.run_id, RUN_ID_2);
  assert.equal(executions, 0);
  assert.equal(queries.length, 1);
  assert.match(queries[0].text, /status = 'running'/);
});

test("handleAgentRunMessage allows different agents to run independently", async () => {
  let executions = 0;
  const { db } = fakeDb((text, values) => {
    if (text.trimStart().startsWith("select")) {
      return [];
    }
    if (/insert into agent_run_logs/.test(text)) {
      return [
        {
          agent_run_log_id: values?.[0],
          agent_id: values?.[1],
          started_at: STARTED_AT,
          ended_at: null,
          duration_ms: null,
          inputs_watermark: null,
          outputs_summary: null,
          status: "running",
          error: null,
        },
      ];
    }
    if (/update agent_run_logs/.test(text) && /status = 'completed'/.test(text)) {
      return [
        {
          agent_run_log_id: values?.[0],
          agent_id: AGENT_ID_2,
          started_at: STARTED_AT,
          ended_at: ENDED_AT,
          duration_ms: 1000,
          inputs_watermark: null,
          outputs_summary: JSON.parse(values?.[1] as string),
          status: "completed",
          error: null,
        },
      ];
    }
    return [];
  });

  const result = await handleAgentRunMessage(db, {
    message: { run_id: RUN_ID_2, agent_id: AGENT_ID_2 },
    execute: async () => {
      executions += 1;
      return { findings: 2 };
    },
  });

  assert.equal(result.status, "completed");
  assert.equal(executions, 1);
});

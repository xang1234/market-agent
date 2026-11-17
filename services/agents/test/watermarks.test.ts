import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult } from "pg";

import {
  WatermarkValidationError,
  advanceWatermarksTransactionClient,
  advanceWatermarksWithSideEffects,
  advanceWatermarksWithSideEffectsWithPool,
} from "../src/watermarks.ts";
import type { QueryExecutor } from "../src/agent-repo.ts";
import { AgentRunSupersededError } from "../src/agent-run-repo.ts";

const AGENT_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "33333333-3333-4333-8333-333333333333";
const FENCE = "update agent_run_logs set claim_expires_at = greatest(claim_expires_at, now() + make_interval(mins => $3::int)) where agent_run_log_id = $1::uuid and agent_id = $2::uuid and status = 'running' and ended_at is null";

type Captured = { text: string; values?: unknown[] };

function fakeDb() {
  const queries: Captured[] = [];
  return {
    queries,
    db: {
      async query<R extends Record<string, unknown> = Record<string, unknown>>(
        text: string,
        values?: unknown[],
      ): Promise<QueryResult<R>> {
        queries.push({ text, values });
        return { rows: [], rowCount: 1, command: "", oid: 0, fields: [] };
      },
    },
  };
}

test("advanceWatermarksWithSideEffects commits side effects and watermark update in one transaction", async () => {
  const { db, queries } = fakeDb();

  await advanceWatermarksWithSideEffects(advanceWatermarksTransactionClient(withRelease(db)), {
    agent_id: AGENT_ID,
    run_id: RUN_ID,
    next_watermarks: { documents: { since: "2026-05-04T00:00:00.000Z" } },
    async applySideEffects(tx) {
      await tx.query("insert into findings (agent_id, headline) values ($1, $2)", [
        AGENT_ID,
        "Guidance raised",
      ]);
    },
  });

  assert.deepEqual(
    queries.map((query) => query.text.replace(/\s+/g, " ").trim()),
    [
      "begin",
      "insert into findings (agent_id, headline) values ($1, $2)",
      "update agents set watermarks = $2::jsonb, updated_at = now() where agent_id = $1::uuid",
      FENCE,
      "commit",
    ],
  );
  assert.deepEqual(queries[3].values, [RUN_ID, AGENT_ID, 15]);
  assert.equal(queries[2].values?.[0], AGENT_ID);
  assert.equal(
    queries[2].values?.[1],
    JSON.stringify({ documents: { since: "2026-05-04T00:00:00.000Z" } }),
  );
});

test("advanceWatermarksWithSideEffects rolls back and skips watermark update when side effects fail", async () => {
  const { db, queries } = fakeDb();

  await assert.rejects(
    advanceWatermarksWithSideEffects(advanceWatermarksTransactionClient(withRelease(db)), {
      agent_id: AGENT_ID,
      run_id: RUN_ID,
      next_watermarks: { documents: { since: "2026-05-04T00:00:00.000Z" } },
      async applySideEffects(tx) {
        await tx.query("insert into findings (agent_id, headline) values ($1, $2)", [
          AGENT_ID,
          "Guidance raised",
        ]);
        throw new Error("finding insert failed");
      },
    }),
    /finding insert failed/,
  );

  assert.deepEqual(
    queries.map((query) => query.text.replace(/\s+/g, " ").trim()),
    [
      "begin",
      "insert into findings (agent_id, headline) values ($1, $2)",
      "rollback",
    ],
  );
});

test("advanceWatermarksWithSideEffects validates agent id and watermarks before opening a transaction", async () => {
  const { db, queries } = fakeDb();
  const tx = advanceWatermarksTransactionClient(withRelease(db));

  await assert.rejects(
    advanceWatermarksWithSideEffects(tx, {
      agent_id: "not-a-uuid",
      run_id: RUN_ID,
      next_watermarks: {},
      async applySideEffects() {},
    }),
    WatermarkValidationError,
  );
  await assert.rejects(
    advanceWatermarksWithSideEffects(tx, {
      agent_id: AGENT_ID,
      run_id: RUN_ID,
      next_watermarks: null,
      async applySideEffects() {},
    }),
    WatermarkValidationError,
  );
  await assert.rejects(
    advanceWatermarksWithSideEffects(tx, {
      agent_id: AGENT_ID,
      run_id: "not-a-uuid",
      next_watermarks: {},
      async applySideEffects() {},
    }),
    WatermarkValidationError,
  );

  assert.equal(queries.length, 0);
});

test("advanceWatermarksWithSideEffects rejects unbranded query executors before opening a transaction", async () => {
  const { db, queries } = fakeDb();

  await assert.rejects(
    // @ts-expect-error: an unbranded executor on purpose; it must be rejected.
    advanceWatermarksWithSideEffects(db, {
      agent_id: AGENT_ID,
      run_id: RUN_ID,
      next_watermarks: {},
      async applySideEffects() {},
    }),
    /pinned transaction client/i,
  );
  assert.equal(queries.length, 0);
});

test("advanceWatermarksTransactionClient rejects pool-like executors before opening a transaction", () => {
  const { db, queries } = fakeDb();
  const poolLike = Object.assign(db, {
    async connect() {
      throw new Error("must not acquire clients through direct helper");
    },
  });

  assert.throws(
    () => advanceWatermarksTransactionClient(poolLike),
    /pinned transaction client/i,
  );
  assert.equal(queries.length, 0);
});

test("advanceWatermarksWithSideEffectsWithPool pins transaction statements to one acquired client", async () => {
  const { db: client, queries } = fakeDb();
  let connectCount = 0;
  let releaseError: Error | undefined;
  const pool = {
    async connect() {
      connectCount += 1;
      return Object.assign(client, {
        release(error?: Error) {
          releaseError = error;
        },
      });
    },
    async query() {
      throw new Error("pool.query must not be used for transaction statements");
    },
  };

  await advanceWatermarksWithSideEffectsWithPool(pool, {
    agent_id: AGENT_ID,
    run_id: RUN_ID,
    next_watermarks: { documents: { since: "2026-05-04T00:00:00.000Z" } },
    async applySideEffects(tx) {
      await tx.query("insert into findings (agent_id, headline) values ($1, $2)", [
        AGENT_ID,
        "Guidance raised",
      ]);
    },
  });

  assert.equal(connectCount, 1);
  assert.equal(releaseError, undefined);
  assert.deepEqual(
    queries.map((query) => query.text.replace(/\s+/g, " ").trim()),
    [
      "begin",
      "insert into findings (agent_id, headline) values ($1, $2)",
      "update agents set watermarks = $2::jsonb, updated_at = now() where agent_id = $1::uuid",
      FENCE,
      "commit",
    ],
  );
});

test("advanceWatermarksWithSideEffects rolls back when the watermark update touches no agent row", async () => {
  const queries: Captured[] = [];
  const db: QueryExecutor & { release(error?: Error): void } = {
    async query<R extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      values?: unknown[],
    ): Promise<QueryResult<R>> {
      queries.push({ text, values });
      const normalized = text.replace(/\s+/g, " ").trim();
      return {
        rows: [],
        rowCount: normalized.startsWith("update agents set watermarks") ? 0 : 1,
        command: "",
        oid: 0,
        fields: [],
      };
    },
    release() {},
  };

  await assert.rejects(
    advanceWatermarksWithSideEffects(advanceWatermarksTransactionClient(db), {
      agent_id: AGENT_ID,
      run_id: RUN_ID,
      next_watermarks: { documents: { since: "2026-05-04T00:00:00.000Z" } },
      async applySideEffects(tx) {
        await tx.query("insert into findings (agent_id, headline) values ($1, $2)", [
          AGENT_ID,
          "Guidance raised",
        ]);
      },
    }),
    /agent not found/i,
  );

  assert.deepEqual(
    queries.map((query) => query.text.replace(/\s+/g, " ").trim()),
    [
      "begin",
      "insert into findings (agent_id, headline) values ($1, $2)",
      "update agents set watermarks = $2::jsonb, updated_at = now() where agent_id = $1::uuid",
      "rollback",
    ],
  );
});

test("advanceWatermarksWithSideEffects rolls back every effect when the run no longer holds its claim", async () => {
  const queries: Captured[] = [];
  const db: QueryExecutor & { release(error?: Error): void } = {
    async query<R extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      values?: unknown[],
    ): Promise<QueryResult<R>> {
      queries.push({ text, values });
      const normalized = text.replace(/\s+/g, " ").trim();
      return { rows: [], rowCount: normalized === FENCE ? 0 : 1, command: "", oid: 0, fields: [] };
    },
    release() {},
  };

  await assert.rejects(
    advanceWatermarksWithSideEffects(advanceWatermarksTransactionClient(db), {
      agent_id: AGENT_ID,
      run_id: RUN_ID,
      next_watermarks: { documents: { since: "2026-05-04T00:00:00.000Z" } },
      async applySideEffects(tx) {
        await tx.query("insert into findings (agent_id, headline) values ($1, $2)", [AGENT_ID, "Guidance raised"]);
      },
    }),
    AgentRunSupersededError,
  );

  assert.deepEqual(
    queries.map((query) => query.text.replace(/\s+/g, " ").trim()),
    [
      "begin",
      "insert into findings (agent_id, headline) values ($1, $2)",
      "update agents set watermarks = $2::jsonb, updated_at = now() where agent_id = $1::uuid",
      FENCE,
      "rollback",
    ],
  );
});

function withRelease<T extends QueryExecutor>(db: T): T & { release(error?: Error): void } {
  return Object.assign(db, {
    release() {},
  });
}

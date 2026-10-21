import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import test from "node:test";
import { connectedPool, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { createEvidenceFinancialPort } from "../src/evidence-adapter.ts";
import { ParentRefusedError, type PersistParentArtifact } from "../src/finalize.ts";
import { planFinancialRequest, type PlanningContext, type PlanningResult } from "../src/planner.ts";
import type { FinancialPool, SqlExecutor } from "../src/ports.ts";
import { issuerLabels, publishRequest, type FinancialRequest, type RequestOutcome } from "../src/request.ts";
import { createFinancialWorker } from "../src/worker.ts";
import { authorityFor, databaseUrl, engineDatabase, IDS, revenuePlan } from "./db-fixtures.ts";

const noRuns: FinancialPool = {
  query: async () => ({ rows: [] }),
  connect: async () => Object.assign(new EventEmitter(), { query: async () => ({ rows: [] }), release() {} }),
};

const planningContext: PlanningContext = {
  plan_id: randomUUID(),
  origin: { kind: "chat_request", ref: "chat:turn:1" },
  knowledge_cutoff: "2024-01-15T00:00:00.000Z",
  cutoff_timezone: "UTC",
  reporting_basis: "as_reported",
  freshness_max_age_days: null,
  authority: authorityFor(),
  parent_limits: {},
  max_model_calls: 2,
  requested_subjects: [{ mention: "AAA", resolution: { status: "resolved", subject_ref: { kind: "issuer", id: IDS.issuerA }, label: "AAA" } }],
  publication_unit_kind: "chat_section",
};

const ready = async (): Promise<PlanningResult> => ({ outcome: "ready", plan: revenuePlan(), model_calls: 0 });

function request(overrides: Partial<FinancialRequest> & Pick<FinancialRequest, "request_key">): FinancialRequest {
  return { authority: authorityFor(), plan: ready, evidence: createEvidenceFinancialPort, persistParent: async () => {}, ...overrides };
}

/** A pool whose client finds no earlier run and fails `error` when the reservation begins, after emitting `heard` as pg reports a lost connection. */
function failingReservation(error: unknown, heard: Error | null) {
  const client = Object.assign(new EventEmitter(), {
    query: async (text: string) => {
      if (text !== "begin") return { rows: [] };
      if (heard) client.emit("error", heard);
      throw error;
    },
    release() {},
  });
  const pool: FinancialPool = { query: client.query, connect: async () => client };
  return { pool, client };
}

const sqlError = (code: string) => Object.assign(new Error(`sqlstate ${code}`), { code });

function published(outcome: RequestOutcome): string | undefined {
  return outcome.status === "driven" ? outcome.report?.finalized[0]?.result.status : undefined;
}

test("planning failures", async (t) => {
  await t.test("a planning model that does not answer is planning_unavailable, with its cause as a warning", async (t) => {
    const errors = t.mock.method(console, "error", () => {});
    const warnings = t.mock.method(console, "warn", () => {});
    const down = new Error("410 model retired");
    const outcome = await publishRequest(noRuns, request({
      request_key: "turn-1",
      plan: () => planFinancialRequest(planningContext, "Revenue for AAA", async () => { throw down; }),
    }));
    assert.deepEqual(outcome, { status: "gap", reason: "planning_unavailable" });
    assert.equal(errors.mock.callCount(), 0);
    assert.deepEqual(warnings.mock.calls.map((call) => call.arguments), [["[financial-engine] the planning model did not answer for chat request turn-1", down]]);
  });

  await t.test("a TypeError in a plan builder is logged with the surface and request key and reaches the caller", async (t) => {
    const errors = t.mock.method(console, "error", () => {});
    const defect = new TypeError("Cannot read properties of undefined (reading 'label')");
    await assert.rejects(publishRequest(noRuns, request({ request_key: "turn-2", plan: async () => { throw defect; } })), (error) => error === defect);
    assert.deepEqual(errors.mock.calls.map((call) => call.arguments), [["[financial-engine] planning failed for chat request turn-2", defect]]);
  });
});

test("which database faults are routine", async (t) => {
  const lostConnection = new Error("Connection terminated unexpectedly");
  const routine: ReadonlyArray<readonly [string, unknown, Error | null]> = [
    ["a serialization failure", sqlError("40001"), null],
    ["a deadlock", sqlError("40P01"), null],
    ["a lock timeout", sqlError("55P03"), null],
    ["a full disk", sqlError("53100"), null],
    ["a storage fault", sqlError("58030"), null],
    ["a lost connection, reported without a code", new Error("Client has encountered a connection error and is not queryable"), lostConnection],
  ];
  for (const [name, error, heard] of routine) {
    await t.test(`${name} is publication_failed, warned with its cause, and the client is released unheard`, async (t) => {
      const errors = t.mock.method(console, "error", () => {});
      const warnings = t.mock.method(console, "warn", () => {});
      const { pool, client } = failingReservation(error, heard);
      assert.deepEqual(await publishRequest(pool, request({ request_key: "grid-1" })), { status: "gap", reason: "publication_failed" });
      assert.equal(errors.mock.callCount(), 0);
      assert.deepEqual(warnings.mock.calls.map((call) => call.arguments), [["[financial-engine] publication stopped for chat request grid-1", heard ?? error]]);
      assert.equal(client.listenerCount("error"), 0);
    });
  }
  const defects: ReadonlyArray<readonly [string, unknown]> = [
    ["a bind message with the wrong parameter count", sqlError("08P01")],
    ["a statement timeout", sqlError("57014")],
    ["a missing file", sqlError("58P01")],
    ["an undefined column", sqlError("42703")],
    ["an exception a trigger raised", sqlError("P0001")],
    ["an uncoded error on a live connection", new Error("unexpected row shape")],
  ];
  for (const [name, error] of defects) {
    await t.test(`${name} is logged and reaches the caller`, async (t) => {
      const errors = t.mock.method(console, "error", () => {});
      const { pool, client } = failingReservation(error, null);
      await assert.rejects(publishRequest(pool, request({ request_key: "grid-2" })), (thrown) => thrown === error);
      assert.deepEqual(errors.mock.calls.map((call) => call.arguments), [["[financial-engine] publication failed for chat request grid-2", error]]);
      assert.equal(client.listenerCount("error"), 0);
    });
  }
});

test("publication failures", { skip: !dockerAvailable(), timeout: 300_000 }, async (t) => {
  const db = await engineDatabase(t, "fin-request");
  const pool = await connectedPool(t, databaseUrl(db), { max: 4 });
  const sql = (statement: string): PersistParentArtifact => async (tx) => { await tx.client.query(statement); };

  await t.test("a failed SQL query while planning is logged and reaches the caller", async (t) => {
    const errors = t.mock.method(console, "error", () => {});
    await db.query(`alter table issuers rename column legal_name to legal_name_before`);
    try {
      const failure = await publishRequest(pool, request({
        request_key: "plan-sql",
        plan: async (planDb: SqlExecutor) => { await issuerLabels(planDb, [IDS.issuerA]); return ready(); },
      })).catch((error: unknown) => error);
      assert.equal((failure as { code?: string }).code, "42703");
      assert.deepEqual(errors.mock.calls.map((call) => call.arguments), [["[financial-engine] planning failed for chat request plan-sql", failure]]);
    } finally {
      await db.query(`alter table issuers rename column legal_name_before to legal_name`);
    }
  });

  const routine: ReadonlyArray<readonly [string, Partial<FinancialRequest>]> = [
    ["the parent refuses the publication", { persistParent: async () => { throw new ParentRefusedError("the chat thread no longer belongs to the run's owner"); } }],
    ["a storage fault rolls the finalization back", { persistParent: sql(`do $$ begin raise exception 'parent store unavailable' using errcode = '58030'; end $$`) }],
  ];
  for (const [name, failing] of routine) {
    await t.test(`${name}: publication_failed, nothing logged, and a retry publishes`, async (t) => {
      const errors = t.mock.method(console, "error", () => {});
      const key = randomUUID();
      assert.deepEqual(await publishRequest(pool, request({ request_key: key, ...failing })), { status: "gap", reason: "publication_failed" });
      assert.equal(errors.mock.callCount(), 0);
      assert.equal(published(await publishRequest(pool, request({ request_key: key }))), "published");
    });
  }

  await t.test("a lease that lapses before the drive: publication_failed, nothing logged, and a retry publishes", async (t) => {
    const errors = t.mock.method(console, "error", () => {});
    t.mock.method(console, "warn", () => {});
    const key = randomUUID();
    const lapse = async () => db.query(`update financial_runs set lease_expires_at = now() - interval '1 second' where request_key = $1`, [key]);
    assert.deepEqual(await publishRequest(pool, request({ request_key: key, beforeDrive: lapse })), { status: "gap", reason: "publication_failed" });
    assert.equal(errors.mock.callCount(), 0);
    assert.equal(published(await publishRequest(pool, request({ request_key: key }))), "published");
  });

  await t.test("a deadlock while the run executes: publication_failed, nothing logged, and a retry publishes", async (t) => {
    const errors = t.mock.method(console, "error", () => {});
    const key = randomUUID();
    await db.query(`
      create function deadlock_unit() returns trigger language plpgsql as $$ begin raise exception 'deadlock detected' using errcode = '40P01'; end $$;
      create trigger deadlock_unit before insert on financial_run_units for each row execute function deadlock_unit();`);
    let outcome;
    try {
      outcome = await publishRequest(pool, request({ request_key: key }));
    } finally {
      await db.query(`drop trigger deadlock_unit on financial_run_units; drop function deadlock_unit();`);
    }
    assert.deepEqual(outcome, { status: "gap", reason: "publication_failed" });
    assert.equal(errors.mock.callCount(), 0);
    assert.equal(published(await publishRequest(pool, request({ request_key: key }))), "published");
  });

  const killBackend = `perform pg_terminate_backend(pg_backend_pid())`;
  // A dead connection cannot release its lease; recovery takes the run once the lease lapses.
  const lapse = (key: string) => db.query(`update financial_runs set lease_expires_at = now() - interval '1 second' where request_key = $1`, [key]);
  await t.test("a connection that dies during finalization: publication_failed, no error logged, and a retry after the lease lapses publishes", async (t) => {
    const errors = t.mock.method(console, "error", () => {});
    t.mock.method(console, "warn", () => {});
    const key = randomUUID();
    assert.deepEqual(await publishRequest(pool, request({ request_key: key, persistParent: sql(`do $$ begin ${killBackend}; end $$`) })), { status: "gap", reason: "publication_failed" });
    assert.equal(errors.mock.callCount(), 0);
    await lapse(key);
    assert.equal(published(await publishRequest(pool, request({ request_key: key }))), "published");
  });

  await t.test("a connection that dies while the run executes: publication_failed, no error logged, and a retry after the lease lapses publishes", async (t) => {
    const errors = t.mock.method(console, "error", () => {});
    t.mock.method(console, "warn", () => {});
    const key = randomUUID();
    await db.query(`
      create function kill_unit_backend() returns trigger language plpgsql as $$ begin ${killBackend}; return new; end $$;
      create trigger kill_unit_backend before insert on financial_run_units for each row execute function kill_unit_backend();`);
    let outcome;
    try {
      outcome = await publishRequest(pool, request({ request_key: key }));
    } finally {
      await db.query(`drop trigger kill_unit_backend on financial_run_units; drop function kill_unit_backend();`);
    }
    assert.deepEqual(outcome, { status: "gap", reason: "publication_failed" });
    assert.equal(errors.mock.callCount(), 0);
    await lapse(key);
    assert.equal(published(await publishRequest(pool, request({ request_key: key }))), "published");
  });

  const defects: ReadonlyArray<readonly [string, PersistParentArtifact]> = [
    ["a TypeError in the parent's artifact write", async () => { throw new TypeError("Cannot read properties of null (reading 'blocks')"); }],
    ["a failed SQL query in the parent's artifact write", sql(`select no_such_column from financial_runs`)],
  ];
  for (const [name, persistParent] of defects) {
    await t.test(`${name} is logged with the surface and request key, reaches the caller, and leaves the run for a retry`, async (t) => {
      const errors = t.mock.method(console, "error", () => {});
      const key = randomUUID();
      const failure = await publishRequest(pool, request({ request_key: key, persistParent })).catch((error: unknown) => error);
      assert.ok(failure instanceof Error, `expected the defect to reach the caller; got ${JSON.stringify(failure)}`);
      assert.deepEqual(errors.mock.calls.map((call) => call.arguments), [[`[financial-engine] publication failed for chat request ${key}`, failure]]);
      assert.equal(published(await publishRequest(pool, request({ request_key: key }))), "published");
    });
  }

  const recoveryFailure = [
    ["a defect it hits again is logged as an error", new TypeError("Cannot read properties of null (reading 'blocks')"), "error"],
    ["a parent's refusal is logged as a warning", new ParentRefusedError("the chat thread no longer belongs to the run's owner"), "warn"],
  ] as const;
  for (const [name, failure, level] of recoveryFailure) {
    await t.test(`the recovery worker: ${name}, with the parent kind and run`, async (t) => {
      const logged = { error: t.mock.method(console, "error", () => {}), warn: t.mock.method(console, "warn", () => {}) };
      const key = randomUUID();
      const persistParent: PersistParentArtifact = async () => { throw failure; };
      await publishRequest(pool, request({ request_key: key, persistParent })).catch(() => {});
      const runId = (await db.query(`select run_id::text from financial_runs where request_key = $1`, [key])).rows[0].run_id;
      const worker = createFinancialWorker({
        pool,
        worker_id: "recovery-1",
        ttl_ms: 60_000,
        evidence: createEvidenceFinancialPort,
        parents: { chat_thread: { authority: async () => authorityFor(), persistParent } },
        interval_ms: 1_000,
        max_runs_per_tick: 10,
      });
      logged.error.mock.resetCalls();
      logged.warn.mock.resetCalls();
      assert.deepEqual((await worker.tick()).filter((entry) => entry.run_id === runId), [{ run_id: runId, status: "error", reason: failure.name }]);
      const about = (calls: typeof logged.error.mock.calls) => calls.filter((call) => String(call.arguments[0]).includes(runId)).map((call) => call.arguments);
      const message = level === "error"
        ? `[financial-engine] recovery failed for chat_thread run ${runId}`
        : `[financial-engine] recovery stopped for chat_thread run ${runId}`;
      assert.deepEqual({ error: about(logged.error.mock.calls), warn: about(logged.warn.mock.calls) }, { error: level === "error" ? [[message, failure]] : [], warn: level === "warn" ? [[message, failure]] : [] });
    });
  }

  await t.test("the recovery worker: a connection that dies mid-recovery is a warning, and the process lives on", async (t) => {
    const logged = { error: t.mock.method(console, "error", () => {}), warn: t.mock.method(console, "warn", () => {}) };
    const key = randomUUID();
    const persistParent = sql(`do $$ begin ${killBackend}; end $$`);
    assert.deepEqual(await publishRequest(pool, request({ request_key: key, persistParent })), { status: "gap", reason: "publication_failed" });
    await lapse(key);
    const runId = (await db.query(`select run_id::text from financial_runs where request_key = $1`, [key])).rows[0].run_id;
    const worker = createFinancialWorker({
      pool,
      worker_id: "recovery-2",
      ttl_ms: 60_000,
      evidence: createEvidenceFinancialPort,
      parents: { chat_thread: { authority: async () => authorityFor(), persistParent } },
      interval_ms: 1_000,
      max_runs_per_tick: 10,
    });
    logged.error.mock.resetCalls();
    logged.warn.mock.resetCalls();
    assert.deepEqual((await worker.tick()).filter((entry) => entry.run_id === runId).map((entry) => entry.status), ["error"]);
    const about = (calls: typeof logged.error.mock.calls) => calls.filter((call) => String(call.arguments[0]).includes(runId)).map((call) => call.arguments[0]);
    assert.deepEqual({ error: about(logged.error.mock.calls), warn: about(logged.warn.mock.calls) }, { error: [], warn: [`[financial-engine] recovery stopped for chat_thread run ${runId}`] });
  });
});

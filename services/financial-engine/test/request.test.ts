import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { connectedPool, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { createEvidenceFinancialPort } from "../src/evidence-adapter.ts";
import { ParentRefusedError, type PersistParentArtifact } from "../src/finalize.ts";
import { planFinancialRequest, type PlanningContext, type PlanningResult } from "../src/planner.ts";
import type { FinancialPool, SqlExecutor } from "../src/ports.ts";
import { issuerLabels, publishRequest, type FinancialRequest, type RequestOutcome } from "../src/request.ts";
import { authorityFor, databaseUrl, engineDatabase, IDS, revenuePlan } from "./db-fixtures.ts";

const noRuns: FinancialPool = {
  query: async () => ({ rows: [] }),
  connect: async () => ({ query: async () => ({ rows: [] }), release() {} }),
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

function published(outcome: RequestOutcome): string | undefined {
  return outcome.status === "driven" ? outcome.report?.finalized[0]?.result.status : undefined;
}

test("planning failures", async (t) => {
  await t.test("a planning model that does not answer is planning_unavailable, and nothing is logged", async (t) => {
    const errors = t.mock.method(console, "error", () => {});
    const outcome = await publishRequest(noRuns, request({
      request_key: "turn-1",
      plan: () => planFinancialRequest(planningContext, "Revenue for AAA", async () => { throw new Error("provider down"); }),
    }));
    assert.deepEqual(outcome, { status: "gap", reason: "planning_unavailable" });
    assert.equal(errors.mock.callCount(), 0);
  });

  await t.test("a TypeError in a plan builder is logged with the surface and request key and reaches the caller", async (t) => {
    const errors = t.mock.method(console, "error", () => {});
    const defect = new TypeError("Cannot read properties of undefined (reading 'label')");
    await assert.rejects(publishRequest(noRuns, request({ request_key: "turn-2", plan: async () => { throw defect; } })), (error) => error === defect);
    assert.deepEqual(errors.mock.calls.map((call) => call.arguments), [["[financial-engine] planning failed for chat request turn-2", defect]]);
  });
});

test("publication failures", { skip: !dockerAvailable(), timeout: 240_000 }, async (t) => {
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
    const key = randomUUID();
    const lapse = async () => db.query(`update financial_runs set lease_expires_at = now() - interval '1 second' where request_key = $1`, [key]);
    assert.deepEqual(await publishRequest(pool, request({ request_key: key, beforeDrive: lapse })), { status: "gap", reason: "publication_failed" });
    assert.equal(errors.mock.callCount(), 0);
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
});

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test, { type TestContext } from "node:test";
import type { Pool } from "pg";
import { connectedPool, dockerAvailable, registerLifoCleanup } from "../../../db/test/docker-pg.ts";
import Ajv2020 from "../../financial-core/node_modules/ajv/dist/2020.js";
import type { SnapshotTransactionClient } from "../../snapshot/src/snapshot-sealer.ts";
import { handleFinancialHttp, type FinancialPool } from "../src/http.ts";
import { completedRun, databaseUrl, engineDatabase, IDS, marginPlan, pinnedClients, readyRun } from "./db-fixtures.ts";

const SPEC = new URL("../../../spec/", import.meta.url);
const HTTP_SCHEMA_ID = "https://example.com/schemas/financial_answer_http_schema.json";

function schemaValidator() {
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
  for (const file of ["finance_research_block_schema.json", "financial_plan_schema.json", "financial_result_schema.json", "financial_answer_http_schema.json"]) {
    ajv.addSchema(JSON.parse(readFileSync(new URL(file, SPEC), "utf8")));
  }
  return (name: string, body: unknown) => {
    const validate = ajv.getSchema(`${HTTP_SCHEMA_ID}#/$defs/${name}`)!;
    assert.ok(validate(body), `${name}: ${JSON.stringify(validate.errors)}`);
  };
}

/** A test server that authenticates by header — the harness stands in for the deployment's authenticator. */
async function startServer(t: TestContext, pool: Pool, statements: string[]): Promise<string> {
  const db: FinancialPool = {
    query: (text, values) => { statements.push(text); return pool.query(text, values as unknown[]) as never; },
    connect: () => pool.connect(),
  };
  const server: Server = createServer((req, res) => {
    const userId = String(req.headers["x-test-user"] ?? "");
    void handleFinancialHttp(req, res, { userId, db }).then((handled) => {
      if (!handled) { res.statusCode = 418; res.end(); }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  registerLifoCleanup(t, () => new Promise<void>((resolve) => server.close(() => resolve())));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

test("financial answer HTTP", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for financial HTTP coverage");
    return;
  }
  const db = await engineDatabase(t, "fin-http");
  const [client] = await pinnedClients(t, db, 1) as [SnapshotTransactionClient];
  const pool = await connectedPool(t, databaseUrl(db));
  const statements: string[] = [];
  const base = await startServer(t, pool, statements);
  const valid = schemaValidator();
  const call = async (method: string, path: string, options: { user?: string; body?: unknown } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { "x-test-user": options.user ?? IDS.owner, ...(options.body === undefined ? {} : { "content-type": "application/json" }) },
      ...(options.body === undefined ? {} : { body: typeof options.body === "string" ? options.body : JSON.stringify(options.body) }),
    });
    return { status: response.status, headers: response.headers, body: await response.json() as Record<string, unknown> };
  };

  const completed = await completedRun(db, client);
  const pending = await readyRun(db, marginPlan());

  await t.test("run status shows committed units only, privately", async () => {
    const done = await call("GET", `/v1/financial/runs/${completed.runId}`);
    assert.equal(done.status, 200);
    valid("FinancialRunStatus", done.body);
    assert.equal(done.headers.get("cache-control"), "private, no-store");
    assert.match(done.headers.get("vary") ?? "", /x-user-id/u);
    assert.equal(done.body.execution_state, "completed");
    const margin = (done.body.units as Array<Record<string, unknown>>).find((unit) => unit.unit_id === "margin_unit")!;
    assert.equal(margin.state, "sealed");
    assert.equal(margin.coverage_state, "partial");
    assert.deepEqual([...(margin.result_ids as string[])].sort(), [completed.results.out_gm, completed.results.out_gm22].sort());

    const unsealed = await call("GET", `/v1/financial/runs/${pending.runId}`);
    valid("FinancialRunStatus", unsealed.body);
    for (const unit of unsealed.body.units as Array<Record<string, unknown>>) {
      assert.equal(unit.state, "computed");
      assert.deepEqual([unit.coverage_state, unit.snapshot_id, unit.certificate_digest, unit.result_ids], [null, null, null, []], "no draft coverage or results");
    }
  });

  await t.test("another owner's run or result is the same not-found as a missing one", async () => {
    const missing = await call("GET", `/v1/financial/runs/${randomUUID()}`);
    const foreign = await call("GET", `/v1/financial/runs/${completed.runId}`, { user: IDS.other });
    assert.deepEqual([foreign.status, foreign.body], [missing.status, missing.body]);
    assert.deepEqual(missing, { ...missing, status: 404, body: { error: "not found", code: "not_found" } });
    valid("FinancialHttpError", missing.body);
    const foreignResult = await call("GET", `/v1/financial/results/${completed.results.out_gm}`, { user: IDS.other });
    assert.deepEqual([foreignResult.status, foreignResult.body], [404, missing.body]);
    const draftId = (await db.query(`select result_id::text from financial_results where run_id = $1 and output_id = 'out_gm'`, [pending.runId])).rows[0].result_id;
    assert.deepEqual((await call("GET", `/v1/financial/results/${draftId}`)).body, missing.body, "an uncommitted result");
    assert.equal((await call("GET", "/v1/financial/runs/not-a-uuid")).status, 400);
    assert.equal((await call("DELETE", `/v1/financial/runs/${completed.runId}`)).status, 405);
  });

  await t.test("a committed result inspects against the shared schema", async () => {
    const inspection = await call("GET", `/v1/financial/results/${completed.results.out_gm}`);
    assert.equal(inspection.status, 200);
    valid("FinancialResultInspection", inspection.body);
    assert.equal(inspection.body.availability, "available");
    assert.equal(inspection.headers.get("cache-control"), "private, no-store");
  });

  await t.test("GET routes only read", async () => {
    const before = (await db.query(`select count(*)::int as n, max(updated_at)::text as touched from financial_runs`)).rows[0];
    const events = (await db.query(`select count(*)::int as n from financial_run_events`)).rows[0].n;
    statements.length = 0;
    await call("GET", `/v1/financial/runs/${completed.runId}`);
    await call("GET", `/v1/financial/results/${completed.results.out_check}`);
    await call("GET", `/v1/financial/runs/${pending.runId}`);
    assert.ok(statements.length > 0);
    for (const statement of statements) assert.match(statement.trimStart(), /^select\b/iu);
    assert.deepEqual((await db.query(`select count(*)::int as n, max(updated_at)::text as touched from financial_runs`)).rows[0], before);
    assert.equal((await db.query(`select count(*)::int as n from financial_run_events`)).rows[0].n, events);
  });

  await t.test("a replay request is idempotent per key and pins to the original run", async () => {
    const key = `replay-${randomUUID()}`;
    const first = await call("POST", `/v1/financial/runs/${completed.runId}/replays`, { body: { request_key: key } });
    assert.equal(first.status, 202, JSON.stringify(first.body));
    valid("FinancialReplayAccepted", first.body);
    assert.deepEqual({ ...first.body, replay_run_id: "<id>" }, { replay_run_id: "<id>", replay_of_run_id: completed.runId, execution_state: "pending", created: true });

    const again = await call("POST", `/v1/financial/runs/${completed.runId}/replays`, { body: { request_key: key } });
    assert.equal(again.status, 200);
    assert.deepEqual(again.body, { ...first.body, created: false });

    const ofReplay = await call("POST", `/v1/financial/runs/${first.body.replay_run_id}/replays`, { body: { request_key: key } });
    assert.deepEqual(ofReplay.body, { ...first.body, created: false }, "replaying a replay pins to the original");

    const replay = (await db.query(`select plan_id::text, knowledge_cutoff, policies, parent_version, execution_state from financial_runs where run_id = $1`, [first.body.replay_run_id])).rows[0];
    const original = (await db.query(`select plan_id::text, knowledge_cutoff, policies, parent_version from financial_runs where run_id = $1`, [completed.runId])).rows[0];
    assert.deepEqual({ ...replay, execution_state: undefined }, { ...original, execution_state: undefined }, "the saved plan, cutoff, policies, and parent version");
    assert.equal(replay.execution_state, "pending", "nothing executes in the request");
  });

  await t.test("replay conflicts, foreign runs, unfinished runs, and bad bodies are refused", async () => {
    const key = `replay-${randomUUID()}`;
    assert.equal((await call("POST", `/v1/financial/runs/${completed.runId}/replays`, { body: { request_key: key } })).status, 202);
    const other = await completedRun(db, client);
    const conflict = await call("POST", `/v1/financial/runs/${other.runId}/replays`, { body: { request_key: key } });
    assert.deepEqual([conflict.status, conflict.body.code], [409, "request_key_conflict"]);
    valid("FinancialHttpError", conflict.body);

    const unfinished = await call("POST", `/v1/financial/runs/${pending.runId}/replays`, { body: { request_key: key } });
    assert.deepEqual([unfinished.status, unfinished.body.code], [409, "source_not_final"]);
    const foreign = await call("POST", `/v1/financial/runs/${completed.runId}/replays`, { user: IDS.other, body: { request_key: key } });
    assert.deepEqual([foreign.status, foreign.body.code], [404, "not_found"]);
    for (const body of ["{", { request_key: "has spaces" }, { request_key: key, force: true }, []]) {
      assert.equal((await call("POST", `/v1/financial/runs/${completed.runId}/replays`, { body })).status, 400, JSON.stringify(body));
    }
    assert.equal((await call("GET", `/v1/financial/runs/${completed.runId}/replays`)).status, 405);
  });
});

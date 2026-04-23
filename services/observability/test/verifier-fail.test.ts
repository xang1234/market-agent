import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { writeVerifierFailLog } from "../src/verifier-fail.ts";

test("writeVerifierFailLog persists a row with structured details", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for observability integration coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fra-6al-8-2");
  const client = await connectedClient(t, databaseUrl);
  const thread_id = randomUUID();

  const { verifier_fail_log_id, created_at } = await writeVerifierFailLog(client, {
    thread_id,
    reason_code: "missing_citation",
    details: { block_id: "b-1", expected: "fact", found: null },
  });

  assert.match(verifier_fail_log_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.ok(created_at instanceof Date);

  const { rows } = await client.query(
    `select thread_id, snapshot_id, reason_code, details
     from verifier_fail_logs where verifier_fail_log_id = $1`,
    [verifier_fail_log_id],
  );
  assert.deepEqual(rows[0], {
    thread_id,
    snapshot_id: null,
    reason_code: "missing_citation",
    details: { block_id: "b-1", expected: "fact", found: null },
  });
});

test("writeVerifierFailLog writes null details when the field is omitted", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for observability integration coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fra-6al-8-2");
  const client = await connectedClient(t, databaseUrl);

  const { verifier_fail_log_id } = await writeVerifierFailLog(client, {
    reason_code: "snapshot_stale",
  });

  const { rows } = await client.query(
    `select thread_id, snapshot_id, details from verifier_fail_logs where verifier_fail_log_id = $1`,
    [verifier_fail_log_id],
  );
  assert.deepEqual(rows[0], { thread_id: null, snapshot_id: null, details: null });
});

test("writeVerifierFailLog normalizes explicit null details to SQL NULL", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for observability integration coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fra-6al-8-2");
  const client = await connectedClient(t, databaseUrl);

  const { verifier_fail_log_id } = await writeVerifierFailLog(client, {
    reason_code: "snapshot_stale",
    details: null as never,
  });

  const { rows } = await client.query(
    `select details, details is null as is_sql_null
     from verifier_fail_logs where verifier_fail_log_id = $1`,
    [verifier_fail_log_id],
  );
  assert.deepEqual(rows[0], { details: null, is_sql_null: true });
});

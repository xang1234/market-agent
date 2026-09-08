import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult } from "pg";

import {
  findThesisAssessment,
  getCurrentThesis,
  loadThesisHistory,
  recordThesisAssessment,
  saveThesis,
} from "../src/thesis-repo.ts";
import {
  ThesisConflictError,
  ThesisNotFoundError,
  type ConditionAssessment,
} from "../src/thesis-types.ts";
import type { QueryExecutor } from "../src/agent-repo.ts";
import {
  bootstrapDatabase,
  connectedPool,
  dockerAvailable,
} from "../../../db/test/docker-pg.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";
const ISSUER_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_ISSUER_ID = "44444444-4444-4444-8444-444444444444";
const AGENT_ID = "55555555-5555-4555-8555-555555555555";
const CONDITION_ID = "66666666-6666-4666-8666-666666666666";
const RUN_ID = "77777777-7777-4777-8777-777777777777";
const SNAPSHOT_ID = "88888888-8888-4888-8888-888888888888";
const INSTRUMENT_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const LISTING_ID = "bbbbbbbb-1111-4111-8111-111111111111";

const RESULTS: ConditionAssessment[] = [{
  condition_id: CONDITION_ID,
  status: "supported",
  reason: "The cited evidence supports the condition.",
  claim_refs: ["99999999-9999-4999-8999-999999999999"],
  fact_refs: [],
  method: "model",
}];

test("recordThesisAssessment performs one statement and does not open a nested transaction", async () => {
  const statements: string[] = [];
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string): Promise<QueryResult<R>> {
      statements.push(text.replace(/\s+/g, " ").trim());
      return result([{
        assessment_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        thesis_version_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        run_id: RUN_ID,
        snapshot_id: SNAPSHOT_ID,
        input_hash: "packet-1",
        results: RESULTS,
        model_version: "primary:model-42",
        prompt_version: "living-thesis-v1",
        assessed_at: "2026-09-08T00:00:00.000Z",
      }]) as unknown as QueryResult<R>;
    },
  };

  await recordThesisAssessment(db, {
    thesis_version_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    run_id: RUN_ID,
    snapshot_id: SNAPSHOT_ID,
    input_hash: "packet-1",
    results: RESULTS,
    model_version: "primary:model-42",
    prompt_version: "living-thesis-v1",
  });

  assert.equal(statements.length, 1);
  assert.match(statements[0] ?? "", /^insert into agent_thesis_assessments/i);
  assert.doesNotMatch(statements[0] ?? "", /\bbegin\b|\bcommit\b/i);
});

test(
  "thesis repository saves versions, scopes owners, detects conflicts, reloads history, deduplicates assessments, and cascades agent deletion",
  { skip: !dockerAvailable(), timeout: 120_000 },
  async (t) => {
    const { databaseUrl } = await bootstrapDatabase(t, "living-thesis-repo");
    const pool = await connectedPool(t, databaseUrl);
    await seedBaseRows(pool as unknown as QueryExecutor);

    const version1 = await saveThesis(pool as unknown as QueryExecutor, {
      agent_id: AGENT_ID,
      user_id: USER_ID,
      expected_version: 0,
      thesis: "Enterprise demand remains durable through the next cycle.",
      subject_ref: { kind: "issuer", id: ISSUER_ID },
      conditions: [{
        condition_id: CONDITION_ID,
        statement: "Enterprise demand remains above prior-year levels.",
        falsifier: "Enterprise demand falls below prior-year levels.",
        horizon: "12 months",
      }],
    });
    assert.equal(version1.version, 1);
    assert.equal((await getCurrentThesis(pool as unknown as QueryExecutor, AGENT_ID))?.thesis, version1.thesis);
    const legacy = await pool.query<{ thesis: string }>("select thesis from agents where agent_id = $1", [AGENT_ID]);
    assert.equal(legacy.rows[0]?.thesis, version1.thesis);

    await assert.rejects(
      saveThesis(pool as unknown as QueryExecutor, {
        agent_id: AGENT_ID,
        user_id: OTHER_USER_ID,
        expected_version: 1,
        thesis: "Unauthorized replacement thesis.",
        subject_ref: { kind: "issuer", id: ISSUER_ID },
        conditions: version1.conditions,
      }),
      ThesisNotFoundError,
    );
    await assert.rejects(
      saveThesis(pool as unknown as QueryExecutor, {
        agent_id: AGENT_ID,
        user_id: USER_ID,
        expected_version: 0,
        thesis: "Stale replacement thesis.",
        subject_ref: { kind: "issuer", id: ISSUER_ID },
        conditions: version1.conditions,
      }),
      ThesisConflictError,
    );

    const version2 = await saveThesis(pool as unknown as QueryExecutor, {
      agent_id: AGENT_ID,
      user_id: USER_ID,
      expected_version: 1,
      thesis: "Enterprise demand and operating leverage remain durable.",
      subject_ref: { kind: "issuer", id: ISSUER_ID },
      conditions: version1.conditions,
    });
    assert.equal(version2.version, 2);

    const client = await pool.connect();
    let assessment;
    let duplicate;
    try {
      await client.query("begin");
      assessment = await recordThesisAssessment(client, {
        thesis_version_id: version2.thesis_version_id,
        run_id: RUN_ID,
        snapshot_id: SNAPSHOT_ID,
        input_hash: "packet-1",
        results: RESULTS,
        model_version: "primary:model-42",
        prompt_version: "living-thesis-v1",
      });
      duplicate = await recordThesisAssessment(client, {
        thesis_version_id: version2.thesis_version_id,
        run_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        snapshot_id: SNAPSHOT_ID,
        input_hash: "packet-1",
        results: [],
        model_version: null,
        prompt_version: "other",
      });
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    assert.equal(duplicate.assessment_id, assessment.assessment_id);
    assert.deepEqual(
      await findThesisAssessment(pool as unknown as QueryExecutor, version2.thesis_version_id, "packet-1"),
      assessment,
    );

    const history = await loadThesisHistory(pool as unknown as QueryExecutor, {
      agent_id: AGENT_ID,
      user_id: USER_ID,
    });
    assert.equal(history.thesis?.version, 2);
    assert.deepEqual(history.versions.map((version) => version.version), [2, 1]);
    assert.equal(history.assessments.length, 1);
    assert.equal(history.assessments[0]?.assessment_id, assessment.assessment_id);
    await assert.rejects(
      loadThesisHistory(pool as unknown as QueryExecutor, { agent_id: AGENT_ID, user_id: OTHER_USER_ID }),
      ThesisNotFoundError,
    );

    await pool.query(
      "update agents set universe = $2::jsonb where agent_id = $1::uuid",
      [AGENT_ID, JSON.stringify({ mode: "static", subject_refs: [{ kind: "issuer", id: OTHER_ISSUER_ID }] })],
    );
    await assert.rejects(
      saveThesis(pool as unknown as QueryExecutor, {
        agent_id: AGENT_ID,
        user_id: USER_ID,
        expected_version: 2,
        thesis: "Incompatible subject thesis.",
        subject_ref: { kind: "issuer", id: ISSUER_ID },
        conditions: version1.conditions,
      }),
      ThesisConflictError,
    );

    await pool.query("delete from agents where agent_id = $1::uuid", [AGENT_ID]);
    const remaining = await pool.query<{ versions: string; assessments: string }>(
      `select
         (select count(*)::text from agent_thesis_versions) as versions,
         (select count(*)::text from agent_thesis_assessments) as assessments`,
    );
    assert.deepEqual(remaining.rows[0], { versions: "0", assessments: "0" });
  },
);

async function seedBaseRows(db: QueryExecutor): Promise<void> {
  await db.query(
    `insert into users (user_id, email) values
       ($1::uuid, 'owner@example.test'),
       ($2::uuid, 'other@example.test')`,
    [USER_ID, OTHER_USER_ID],
  );
  await db.query(
    `insert into issuers (issuer_id, legal_name) values
       ($1::uuid, 'Issuer One'),
       ($2::uuid, 'Issuer Two')`,
    [ISSUER_ID, OTHER_ISSUER_ID],
  );
  await db.query(
    `insert into instruments (instrument_id, issuer_id, asset_type)
     values ($1::uuid, $2::uuid, 'common_stock')`,
    [INSTRUMENT_ID, ISSUER_ID],
  );
  await db.query(
    `insert into listings (listing_id, instrument_id, mic, ticker, trading_currency, timezone)
     values ($1::uuid, $2::uuid, 'XNAS', 'ONE', 'USD', 'America/New_York')`,
    [LISTING_ID, INSTRUMENT_ID],
  );
  await db.query(
    `insert into agents (agent_id, user_id, name, thesis, universe, cadence)
     values ($1::uuid, $2::uuid, 'Issuer monitor', 'Legacy thesis', $3::jsonb, 'daily')`,
    [AGENT_ID, USER_ID, JSON.stringify({ mode: "static", subject_refs: [{ kind: "listing", id: LISTING_ID }] })],
  );
  await db.query(
    `insert into snapshots
       (snapshot_id, subject_refs, as_of, basis, normalization, allowed_transforms)
     values ($1::uuid, $2::jsonb, '2026-09-08T00:00:00.000Z', 'reported', 'none', '[]'::jsonb)`,
    [SNAPSHOT_ID, JSON.stringify([{ kind: "issuer", id: ISSUER_ID }])],
  );
}

function result<R extends Record<string, unknown>>(rows: R[]): QueryResult<R> {
  return { rows, rowCount: rows.length, command: "", oid: 0, fields: [] };
}

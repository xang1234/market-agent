import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import type { JsonValue } from "../../observability/src/types.ts";
import type { SnapshotSealResult, SealedSnapshot } from "../../snapshot/src/snapshot-sealer.ts";
import {
  AnalyzeTemplateRunNotFoundError,
  AnalyzeTemplateRunPersistenceError,
  analyzeTemplateRunTransactionClient,
  getAnalyzeTemplateRun,
  listAnalyzeTemplateRunsByTemplate,
  persistAnalyzeTemplateRunAfterSnapshotSeal,
  type AnalyzeTemplateRunPersistenceDb,
  type AnalyzeTemplateRunPoolClient,
  type PersistAnalyzeTemplateRunInput,
} from "../src/template-runner.ts";

const TEMPLATE_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const SNAPSHOT_ID = "33333333-3333-4333-8333-333333333333";
const ALT_SNAPSHOT_ID = "44444444-4444-4444-8444-444444444444";
const FIXED_NOW = "2026-05-01T12:00:00.000Z";

type Captured = { text: string; values?: unknown[] };

function fakePoolClient(
  responder: (text: string, values?: unknown[]) => unknown[],
): { db: AnalyzeTemplateRunPoolClient; queries: Captured[] } {
  const queries: Captured[] = [];
  const db: AnalyzeTemplateRunPoolClient = {
    async query<R extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      values?: unknown[],
    ): Promise<{ rows: R[] }> {
      queries.push({ text, values });
      return { rows: responder(text, values) as R[] };
    },
    release() {},
  };
  return { db, queries };
}

function fakeDb(
  responder: (text: string, values?: unknown[]) => unknown[],
): { db: AnalyzeTemplateRunPersistenceDb; queries: Captured[] } {
  const queries: Captured[] = [];
  const db: AnalyzeTemplateRunPersistenceDb = {
    async query<R extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      values?: unknown[],
    ): Promise<{ rows: R[] }> {
      queries.push({ text, values });
      return { rows: responder(text, values) as R[] };
    },
  };
  return { db, queries };
}

function sealedSnapshot(snapshot_id: string = SNAPSHOT_ID): SealedSnapshot {
  return Object.freeze({
    snapshot_id,
    created_at: FIXED_NOW,
    subject_refs: Object.freeze([{ kind: "issuer" as const, id: "55555555-5555-4555-8555-555555555555" }]),
    fact_refs: Object.freeze([]),
    claim_refs: Object.freeze([]),
    event_refs: Object.freeze([]),
    document_refs: Object.freeze([]),
    series_specs: Object.freeze([]),
    source_ids: Object.freeze([]),
    tool_call_ids: Object.freeze([]),
    tool_call_result_hashes: Object.freeze([]),
    as_of: FIXED_NOW,
    basis: "reported" as const,
    normalization: "raw" as const,
    coverage_start: null,
    allowed_transforms: null,
    model_version: null,
    parent_snapshot: null,
  });
}

function okSeal(snapshot_id: string = SNAPSHOT_ID): SnapshotSealResult & { ok: true } {
  return Object.freeze({
    ok: true,
    snapshot: sealedSnapshot(snapshot_id),
    verification: Object.freeze({ ok: true, failures: Object.freeze([]) }),
  });
}

function failedSeal(): SnapshotSealResult {
  return Object.freeze({
    ok: false,
    verification: Object.freeze({
      ok: false,
      failures: Object.freeze([
        Object.freeze({
          reason_code: "missing_subject_refs" as const,
          details: Object.freeze({}),
        }),
      ]),
    }),
  });
}

const sampleBlocks: JsonValue = [
  { id: "block-1", kind: "section", title: "Overview", children: [], snapshot_id: SNAPSHOT_ID },
];

function runRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    run_id: RUN_ID,
    template_id: TEMPLATE_ID,
    template_version: 1,
    snapshot_id: SNAPSHOT_ID,
    blocks: sampleBlocks,
    created_at: FIXED_NOW,
    ...overrides,
  };
}

const baseInput = (sealResult: SnapshotSealResult): PersistAnalyzeTemplateRunInput => ({
  template_id: TEMPLATE_ID,
  template_version: 1,
  blocks: sampleBlocks,
  sealSnapshot: async () => sealResult,
});

// ---------- persistAnalyzeTemplateRunAfterSnapshotSeal ------------------

test("persistAnalyzeTemplateRunAfterSnapshotSeal short-circuits when the seal fails — no DB writes", async () => {
  // The fra-dpj contract is "bundle execution produces a sealed snapshot +
  // memo Block[]". If sealing fails, there's no snapshot to anchor the
  // memo to, so persisting the blocks would orphan them. Return the seal
  // failure verbatim and never touch the database.
  const { db, queries } = fakePoolClient(() => []);
  const result = await persistAnalyzeTemplateRunAfterSnapshotSeal(
    analyzeTemplateRunTransactionClient(db),
    baseInput(failedSeal()),
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.seal.ok, false);
  }
  assert.equal(queries.length, 0, "no queries must run when the snapshot seal fails");
});

test("persistAnalyzeTemplateRunAfterSnapshotSeal persists template_version and snapshot_id from the seal inside one transaction", async () => {
  // Pinning template_version at run time is the explainability anchor:
  // editing the template later doesn't rewrite history. snapshot_id comes
  // from the seal (not the input) so a stale or fabricated id can't be
  // injected.
  let call = 0;
  const { db, queries } = fakePoolClient((text) => {
    call += 1;
    if (text.trim().toLowerCase() === "begin") return [];
    if (text.includes("insert into analyze_template_runs")) return [runRow()];
    if (text.trim().toLowerCase() === "commit") return [];
    return [];
  });
  const result = await persistAnalyzeTemplateRunAfterSnapshotSeal(
    analyzeTemplateRunTransactionClient(db),
    baseInput(okSeal()),
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.run.snapshot_id, SNAPSHOT_ID);
    assert.equal(result.run.template_version, 1);
  }
  // Transaction wraps the insert.
  assert.deepEqual(
    queries.map((q) => q.text.trim().toLowerCase()).filter((t) => t === "begin" || t === "commit"),
    ["begin", "commit"],
  );
  const insert = queries.find((q) => q.text.includes("insert into analyze_template_runs"));
  assert.ok(insert, "expected an insert into analyze_template_runs");
  // Insert binds in order: template_id, template_version, snapshot_id, blocks.
  assert.equal(insert.values?.[0], TEMPLATE_ID);
  assert.equal(insert.values?.[1], 1);
  assert.equal(insert.values?.[2], SNAPSHOT_ID, "snapshot_id must come from the seal, not the input");
  assert.equal(insert.values?.[3], JSON.stringify(sampleBlocks));
  assert.equal(call, 3);
});

test("persistAnalyzeTemplateRunAfterSnapshotSeal rolls back if the insert returns no row", async () => {
  // Defensive: if pg silently returns zero rows from a RETURNING insert (e.g.
  // a hypothetical schema constraint change that filters out the row), we
  // must rollback rather than commit the empty transaction and lose the seal.
  const calls: string[] = [];
  const { db } = fakePoolClient((text) => {
    calls.push(text.trim().toLowerCase());
    if (text.includes("insert into analyze_template_runs")) return [];
    return [];
  });
  await assert.rejects(
    persistAnalyzeTemplateRunAfterSnapshotSeal(
      analyzeTemplateRunTransactionClient(db),
      baseInput(okSeal()),
    ),
    (err: Error) =>
      err instanceof AnalyzeTemplateRunPersistenceError && /returned no row/.test(err.message),
  );
  assert.equal(calls.includes("rollback"), true, "rollback must run when the insert yields no row");
  assert.equal(calls.includes("commit"), false, "commit must not run on a failed insert");
});

test("persistAnalyzeTemplateRunAfterSnapshotSeal validates inputs before invoking the seal — rejects empty template_id", async () => {
  // The seal callback is expensive (DB roundtrips, verifier work); reject
  // obviously-malformed inputs before paying that cost.
  let sealInvocations = 0;
  const { db } = fakePoolClient(() => []);
  await assert.rejects(
    persistAnalyzeTemplateRunAfterSnapshotSeal(analyzeTemplateRunTransactionClient(db), {
      template_id: "",
      template_version: 1,
      blocks: sampleBlocks,
      sealSnapshot: async () => {
        sealInvocations += 1;
        return okSeal();
      },
    }),
    (err: Error) =>
      err instanceof AnalyzeTemplateRunPersistenceError && /template_id/.test(err.message),
  );
  assert.equal(sealInvocations, 0, "seal callback must not run when the input fails validation");
});

test("persistAnalyzeTemplateRunAfterSnapshotSeal rejects a non-positive integer template_version", async () => {
  // analyze_templates.version starts at 1 and only increments. Zero or
  // negative pins are nonsensical and would silently corrupt the
  // explainability trail.
  const { db } = fakePoolClient(() => []);
  for (const bad of [0, -1, 1.5, Number.NaN]) {
    await assert.rejects(
      persistAnalyzeTemplateRunAfterSnapshotSeal(analyzeTemplateRunTransactionClient(db), {
        template_id: TEMPLATE_ID,
        template_version: bad,
        blocks: sampleBlocks,
        sealSnapshot: async () => okSeal(),
      }),
      (err: Error) =>
        err instanceof AnalyzeTemplateRunPersistenceError && /template_version/.test(err.message),
      `expected throw for template_version=${bad}`,
    );
  }
});

test("persistAnalyzeTemplateRunAfterSnapshotSeal rejects a non-array blocks payload — memos are Block[]", async () => {
  // The memo contract is Block[] (BlockRegistry-rendered). Storing a bare
  // object or string would corrupt the renderer's input shape and surface
  // as a rendering crash deep in the UI.
  const { db } = fakePoolClient(() => []);
  await assert.rejects(
    persistAnalyzeTemplateRunAfterSnapshotSeal(analyzeTemplateRunTransactionClient(db), {
      template_id: TEMPLATE_ID,
      template_version: 1,
      blocks: { not: "an array" } as unknown as JsonValue,
      sealSnapshot: async () => okSeal(),
    }),
    (err: Error) =>
      err instanceof AnalyzeTemplateRunPersistenceError && /blocks/.test(err.message),
  );
});

test("analyzeTemplateRunTransactionClient rejects a raw pool (has .connect but no .release) — caller must use the *WithPool variant", async () => {
  // Same posture as snapshot-sealer's transaction-client brand: the persist
  // path mutates one table and runs inside a single transaction, so we
  // reject any caller that hands us a pool instead of an acquired
  // transaction client. A pg.Pool has .connect() but no .release(); a
  // pg.PoolClient (acquired from pool.connect()) has BOTH, so we
  // discriminate on the presence of .release().
  const poolShape = {
    async query<R>() {
      return { rows: [] as R[] };
    },
    async connect() {
      return null;
    },
  };
  assert.throws(
    () => analyzeTemplateRunTransactionClient(poolShape as unknown as AnalyzeTemplateRunPersistenceDb),
    /pinned transaction client/i,
  );
});

test("analyzeTemplateRunTransactionClient rejects an unbranded query-only executor (no .release) — must come from pool.connect()", async () => {
  // QueryExecutor without .release() can't represent an acquired
  // transaction-pinned connection. Reject it before brand assignment so the
  // persist path can't accidentally run two statements on different
  // connections from a pool.
  const { db } = fakeDb(() => []);
  assert.throws(
    () => analyzeTemplateRunTransactionClient(db),
    /acquired transaction client with release\(\)/i,
  );
});

// ---------- read paths ---------------------------------------------------

test("getAnalyzeTemplateRun returns null when no row matches", async () => {
  const { db } = fakeDb(() => []);
  const row = await getAnalyzeTemplateRun(db, RUN_ID);
  assert.equal(row, null);
});

test("getAnalyzeTemplateRun rejects an empty run_id before any query", async () => {
  const { db, queries } = fakeDb(() => []);
  await assert.rejects(
    getAnalyzeTemplateRun(db, ""),
    (err: Error) =>
      err instanceof AnalyzeTemplateRunPersistenceError && /run_id/.test(err.message),
  );
  assert.equal(queries.length, 0);
});

test("getAnalyzeTemplateRun returns the parsed row with version, snapshot, and blocks surfaced", async () => {
  const { db } = fakeDb(() => [runRow({ template_version: 7, snapshot_id: ALT_SNAPSHOT_ID })]);
  const row = await getAnalyzeTemplateRun(db, RUN_ID);
  assert.ok(row);
  assert.equal(row.template_version, 7);
  assert.equal(row.snapshot_id, ALT_SNAPSHOT_ID);
  assert.deepEqual(row.blocks, sampleBlocks);
  assert.equal(Object.isFrozen(row), true);
});

test("listAnalyzeTemplateRunsByTemplate orders by created_at desc — newest first for the run history UI", async () => {
  // Reruns produce a new sealed snapshot; the picker shows "latest first"
  // so the user lands on the freshest memo. The DB ORDER BY owns this so
  // a popular template doesn't push the sort into JS land.
  const { db, queries } = fakeDb(() => [
    runRow({ run_id: "00000000-0000-4000-8000-000000000001", created_at: "2026-05-02T00:00:00.000Z" }),
    runRow({ run_id: "00000000-0000-4000-8000-000000000002", created_at: "2026-05-01T00:00:00.000Z" }),
  ]);
  const rows = await listAnalyzeTemplateRunsByTemplate(db, TEMPLATE_ID);
  assert.equal(rows.length, 2);
  assert.equal(Object.isFrozen(rows), true);
  assert.match(queries[0].text, /order by created_at desc/);
  assert.equal(queries[0].values?.[0], TEMPLATE_ID);
});

test("listAnalyzeTemplateRunsByTemplate rejects an empty template_id", async () => {
  const { db } = fakeDb(() => []);
  await assert.rejects(
    listAnalyzeTemplateRunsByTemplate(db, ""),
    (err: Error) =>
      err instanceof AnalyzeTemplateRunPersistenceError && /template_id/.test(err.message),
  );
});

// ---------- AnalyzeTemplateRunNotFoundError typed export -----------------

test("AnalyzeTemplateRunNotFoundError is exported and instanceof-checkable for downstream callers", () => {
  // Symmetry with AnalyzeTemplateNotFoundError. The runner doesn't itself
  // throw NotFound for read paths (it returns null) but the error class is
  // exported so a coordinator-shaped caller that wants throw semantics can
  // reuse it without inventing a parallel type.
  const err = new AnalyzeTemplateRunNotFoundError();
  assert.ok(err instanceof AnalyzeTemplateRunNotFoundError);
  assert.ok(err instanceof Error);
});

// ---------- spec drift ---------------------------------------------------

test("analyze_template_runs drift-tests against the spec SQL: required columns, FKs, and the (template_id, created_at desc) index", () => {
  // Reads the actual schema and pins what the runner depends on:
  // - template_id FK with ON DELETE CASCADE (so `delete user → cascade
  //   templates → cascade runs` works for tenant cleanup).
  // - snapshot_id FK *without* CASCADE (the chat_messages convention —
  //   deleting a sealed snapshot must fail loudly, not silently orphan
  //   memos).
  // - template_version captured at run time so old memos remain readable
  //   even after the template is edited.
  // - blocks jsonb not null (memo payload).
  // - composite index on (template_id, created_at desc) for the list path.
  const workspaceRoot = join(import.meta.dirname, "..", "..", "..");
  const schemaSource = readFileSync(join(workspaceRoot, "spec", "finance_research_db_schema.sql"), "utf8");
  const tableMatch = schemaSource.match(/create table analyze_template_runs \(([\s\S]*?)\);/);
  assert.ok(tableMatch, "expected create table analyze_template_runs in spec/finance_research_db_schema.sql");
  const body = tableMatch[1];
  for (const expected of [
    /template_id uuid not null references analyze_templates\(template_id\) on delete cascade/,
    // snapshot_id reference WITHOUT cascade — deleting a referenced snapshot must fail loudly.
    /snapshot_id uuid not null references snapshots\(snapshot_id\)(?!\s*on\s+delete\s+cascade)/,
    /template_version integer not null/,
    /blocks jsonb not null/,
  ]) {
    assert.match(body, expected, `analyze_template_runs must declare ${expected}`);
  }
  assert.match(
    schemaSource,
    /create index \w+\s+on analyze_template_runs\(template_id, created_at desc\)/,
    "missing covering index on (template_id, created_at desc) for listAnalyzeTemplateRunsByTemplate",
  );
});

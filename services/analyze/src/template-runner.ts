import { serializeJsonValue, type JsonValue } from "../../observability/src/types.ts";
import type { SnapshotSealResult } from "../../snapshot/src/snapshot-sealer.ts";

// Mirrors services/chat/src/messages.ts. The persistence layer is
// snapshot-aware but does NOT itself stage manifests or seal — those are
// caller concerns delegated through the sealSnapshot() callback. The
// renderer that produces Block[] from a sealed snapshot is also a caller
// concern (sibling beads fra-i7z layout-hint rendering, fra-oc8
// source-category → bundle mapping). What this module owns: validate
// inputs, run the seal callback, persist the resulting (template_id,
// template_version, playbook metadata, snapshot_id, blocks) row inside one
// transaction, and surface read paths for run history.

export type AnalyzeTemplateRunPersistenceDb = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[] }>;
};

const ANALYZE_TEMPLATE_RUN_TRANSACTION_CLIENT: unique symbol = Symbol(
  "analyze.templateRunTransactionClient",
);

type AnalyzeTemplateRunTransactionClientBrand = {
  readonly [ANALYZE_TEMPLATE_RUN_TRANSACTION_CLIENT]: true;
};

export type AnalyzeTemplateRunPoolClient = AnalyzeTemplateRunPersistenceDb & {
  release(error?: Error): void;
};

export type AnalyzeTemplateRunTransactionClient = AnalyzeTemplateRunPoolClient &
  AnalyzeTemplateRunTransactionClientBrand;

export type AnalyzeTemplateRunClientPool = {
  connect(): Promise<AnalyzeTemplateRunPoolClient>;
};

export class AnalyzeTemplateRunPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalyzeTemplateRunPersistenceError";
  }
}

export type AnalyzeTemplateRunRow = {
  run_id: string;
  template_id: string;
  template_version: number;
  playbook_id: string | null;
  run_metadata: JsonValue;
  snapshot_id: string;
  // Stored as jsonb; deserialized as a JSON array. Per-element shape
  // matches Block[] but is enforced at the renderer, not here.
  blocks: ReadonlyArray<JsonValue>;
  created_at: string;
};

export type AnalyzeTemplateRunWithTemplateRow = AnalyzeTemplateRunRow & {
  template_name: string;
};

export type AnalyzeTemplateRunSummaryRow = Omit<AnalyzeTemplateRunWithTemplateRow, "blocks">;

export type AnalyzeTemplateRunsPage = {
  runs: ReadonlyArray<AnalyzeTemplateRunSummaryRow>;
  next_cursor: string | null;
};

type AnalyzeTemplateRunDbRow = {
  run_id: string;
  template_id: string;
  template_version: number | string;
  playbook_id: string | null;
  run_metadata: unknown;
  snapshot_id: string;
  blocks?: unknown;
  created_at: Date | string;
  template_name?: string;
};

export type PersistAnalyzeTemplateRunInput = {
  template_id: string;
  // Pinned at run time. analyze_templates.version starts at 1 and only
  // increments; the caller passes the value they read off the template
  // when they kicked off the run, so a later edit to the template doesn't
  // rewrite this run's history.
  template_version: number;
  // The rendered memo. Block[] per the BlockRegistry contract — typed as
  // an array at compile time, with per-element shape left to the renderer
  // (fra-i7z). The runtime check at validatePersistInput is belt-and-braces
  // for callers who reach in via `as any`.
  blocks: ReadonlyArray<JsonValue>;
  // Playbooks are guidance layered on top of the selected template. The
  // durable contract stores both the friendly id and the normalized metadata
  // so a future rerun can reconstruct the original request without scraping
  // rendered blocks.
  playbook_id?: string | null;
  run_metadata: JsonValue;
  // Caller-supplied seal callback. The persistence layer doesn't stage
  // manifests or call sealSnapshot directly so unit tests can drive this
  // path without dragging in the verifier or the snapshots table.
  sealSnapshot(): Promise<SnapshotSealResult>;
};

export type PersistAnalyzeTemplateRunResult =
  | {
      ok: true;
      seal: SnapshotSealResult & { ok: true };
      run: AnalyzeTemplateRunRow;
    }
  | {
      ok: false;
      seal: SnapshotSealResult;
    };

const SELECT_COLUMNS = `run_id::text as run_id,
       template_id::text as template_id,
       template_version,
       playbook_id,
       run_metadata,
       snapshot_id::text as snapshot_id,
       blocks,
       created_at`;

const RUN_SELECT_COLUMNS = `r.run_id::text as run_id,
       r.template_id::text as template_id,
       r.template_version,
       r.playbook_id,
       r.run_metadata,
       r.snapshot_id::text as snapshot_id,
       r.blocks,
       r.created_at`;

const RUN_SUMMARY_SELECT_COLUMNS = `r.run_id::text as run_id,
       r.template_id::text as template_id,
       r.template_version,
       r.playbook_id,
       r.run_metadata,
       r.snapshot_id::text as snapshot_id,
       r.created_at,
       t.name as template_name`;

export async function persistAnalyzeTemplateRunAfterSnapshotSeal(
  db: AnalyzeTemplateRunTransactionClient,
  input: PersistAnalyzeTemplateRunInput,
): Promise<PersistAnalyzeTemplateRunResult> {
  // Validate before the brand check: input shape errors are fully
  // user-controlled, brand mismatches are environmental. Catching the
  // user-controlled bug first gives the more actionable message.
  validatePersistInput(input);
  assertAnalyzeTemplateRunTransactionClient(db);

  const seal = await input.sealSnapshot();
  if (!isVerifiedSeal(seal)) {
    return Object.freeze({ ok: false, seal });
  }

  return persistSealedAnalyzeTemplateRun(db, input, seal);
}

export async function persistAnalyzeTemplateRunAfterSnapshotSealWithPool(
  pool: AnalyzeTemplateRunClientPool,
  input: PersistAnalyzeTemplateRunInput,
): Promise<PersistAnalyzeTemplateRunResult> {
  validatePersistInput(input);

  // Run the seal callback BEFORE acquiring a write client: sealSnapshot
  // owns its own transaction (snapshot-sealer pins one), and the persist
  // step needs a fresh transaction client. Acquiring after the seal also
  // avoids holding a connection while the verifier walks the manifest.
  const seal = await input.sealSnapshot();
  if (!isVerifiedSeal(seal)) {
    return Object.freeze({ ok: false, seal });
  }

  const client = await pool.connect();
  let releaseError: Error | undefined;
  try {
    return await persistSealedAnalyzeTemplateRun(
      analyzeTemplateRunTransactionClient(client),
      input,
      seal,
    );
  } catch (error) {
    // Mirrors services/chat/src/messages.ts and snapshot-sealer.ts: when
    // the rollback path attached a rollback_error onto the original error,
    // hand the connection back to the pool as broken so it gets evicted
    // instead of returning a poisoned client to the next caller.
    if (
      error instanceof Error &&
      (error as { rollback_error?: unknown }).rollback_error !== undefined
    ) {
      releaseError = error;
    }
    throw error;
  } finally {
    client.release(releaseError);
  }
}

export function analyzeTemplateRunTransactionClient<T extends AnalyzeTemplateRunPersistenceDb>(
  client: T,
): T & AnalyzeTemplateRunTransactionClient {
  if (
    (client as Partial<AnalyzeTemplateRunTransactionClientBrand>)[
      ANALYZE_TEMPLATE_RUN_TRANSACTION_CLIENT
    ] === true
  ) {
    return client as T & AnalyzeTemplateRunTransactionClient;
  }
  if (isPoolLike(client)) {
    throw new Error(
      "persistAnalyzeTemplateRunAfterSnapshotSeal requires a pinned transaction client; use the *WithPool variant for pools",
    );
  }
  if (!isAcquiredClient(client)) {
    throw new Error(
      "persistAnalyzeTemplateRunAfterSnapshotSeal requires an acquired transaction client with release()",
    );
  }
  Object.defineProperty(client, ANALYZE_TEMPLATE_RUN_TRANSACTION_CLIENT, {
    value: true,
    enumerable: false,
    configurable: false,
  });
  return client as T & AnalyzeTemplateRunTransactionClient;
}

export async function getAnalyzeTemplateRun(
  db: AnalyzeTemplateRunPersistenceDb,
  runId: string,
): Promise<AnalyzeTemplateRunRow | null> {
  assertNonEmptyString(runId, "run_id");
  const { rows } = await db.query<AnalyzeTemplateRunDbRow>(
    `select ${SELECT_COLUMNS}
       from analyze_template_runs
      where run_id = $1::uuid`,
    [runId],
  );
  return rows[0] ? rowFromDb(rows[0]) : null;
}

export async function listAnalyzeTemplateRunsByTemplate(
  db: AnalyzeTemplateRunPersistenceDb,
  templateId: string,
): Promise<ReadonlyArray<AnalyzeTemplateRunRow>> {
  assertNonEmptyString(templateId, "template_id");
  const { rows } = await db.query<AnalyzeTemplateRunDbRow>(
    `select ${SELECT_COLUMNS}
       from analyze_template_runs
      where template_id = $1::uuid
      order by created_at desc`,
    [templateId],
  );
  return Object.freeze(rows.map(rowFromDb));
}

export async function listAnalyzeTemplateRunsByUser(
  db: AnalyzeTemplateRunPersistenceDb,
  input: {
    userId: string;
    limit: number;
    cursor?: string | null;
  },
): Promise<AnalyzeTemplateRunsPage> {
  assertNonEmptyString(input.userId, "user_id");
  assertPositiveInteger(input.limit, "limit");
  const cursor = input.cursor ? decodeRunCursor(input.cursor) : null;
  const values: unknown[] = [input.userId];
  const cursorClause = cursor
    ? " and (r.created_at, r.run_id) < ($2::timestamptz, $3::uuid)"
    : "";
  if (cursor) values.push(cursor.created_at, cursor.run_id);
  values.push(input.limit + 1);
  const limitPlaceholder = `$${values.length}`;
  const { rows } = await db.query<AnalyzeTemplateRunDbRow>(
    `select ${RUN_SUMMARY_SELECT_COLUMNS}
       from analyze_template_runs r
       join analyze_templates t on t.template_id = r.template_id
      where t.user_id = $1::uuid${cursorClause}
      order by r.created_at desc, r.run_id desc
      limit ${limitPlaceholder}::integer`,
    values,
  );
  const pageRows = rows.slice(0, input.limit).map(summaryRowFromDb);
  return Object.freeze({
    runs: Object.freeze(pageRows),
    next_cursor: rows.length > input.limit && pageRows.length > 0
      ? encodeRunCursor(pageRows[pageRows.length - 1])
      : null,
  });
}

export async function getAnalyzeTemplateRunForUser(
  db: AnalyzeTemplateRunPersistenceDb,
  input: {
    userId: string;
    runId: string;
  },
): Promise<AnalyzeTemplateRunWithTemplateRow | null> {
  assertNonEmptyString(input.userId, "user_id");
  assertNonEmptyString(input.runId, "run_id");
  const { rows } = await db.query<AnalyzeTemplateRunDbRow>(
    `select ${RUN_SELECT_COLUMNS},
            t.name as template_name
       from analyze_template_runs r
       join analyze_templates t on t.template_id = r.template_id
      where t.user_id = $1::uuid
        and r.run_id = $2::uuid`,
    [input.userId, input.runId],
  );
  return rows[0] ? rowWithTemplateFromDb(rows[0]) : null;
}

async function persistSealedAnalyzeTemplateRun(
  db: AnalyzeTemplateRunTransactionClient,
  input: PersistAnalyzeTemplateRunInput,
  seal: SnapshotSealResult & { ok: true },
): Promise<PersistAnalyzeTemplateRunResult & { ok: true }> {
  const snapshotId = seal.snapshot.snapshot_id;
  await db.query("begin");
  try {
    const { rows } = await db.query<AnalyzeTemplateRunDbRow>(
      `insert into analyze_template_runs
         (template_id, template_version, playbook_id, run_metadata, snapshot_id, blocks)
       values ($1::uuid, $2::integer, $3, $4::jsonb, $5::uuid, $6::jsonb)
       returning ${SELECT_COLUMNS}`,
      [
        input.template_id,
        input.template_version,
        input.playbook_id ?? null,
        serializeJsonValue(input.run_metadata),
        snapshotId,
        // ReadonlyArray<JsonValue> is structurally a JsonValue (a JSON array)
        // for serialization purposes, but the JsonValue alias spells the
        // array branch as mutable. Cast at the boundary.
        serializeJsonValue(input.blocks as JsonValue),
      ],
    );
    const row = rows[0];
    if (row === undefined) {
      throw new AnalyzeTemplateRunPersistenceError(
        "analyze_template_runs insert returned no row",
      );
    }

    await db.query("commit");
    return Object.freeze({ ok: true, seal, run: rowFromDb(row) });
  } catch (error) {
    try {
      await db.query("rollback");
    } catch (rollbackError) {
      if (error !== null && typeof error === "object") {
        (error as { rollback_error?: unknown }).rollback_error = rollbackError;
      }
    }
    throw error;
  }
}

function validatePersistInput(input: PersistAnalyzeTemplateRunInput): void {
  assertNonEmptyString(input.template_id, "template_id");
  if (
    typeof input.template_version !== "number" ||
    !Number.isInteger(input.template_version) ||
    input.template_version <= 0
  ) {
    throw new AnalyzeTemplateRunPersistenceError(
      `template_version: must be a positive integer (got ${input.template_version})`,
    );
  }
  // Type system says ReadonlyArray<JsonValue>; this catches callers who
  // reach in via `as any` or pass a plain object.
  if (!Array.isArray(input.blocks)) {
    throw new AnalyzeTemplateRunPersistenceError(
      "blocks: must be an array (memo Block[] per the BlockRegistry contract)",
    );
  }
  if (input.playbook_id !== undefined && input.playbook_id !== null) {
    assertNonEmptyString(input.playbook_id, "playbook_id");
  }
  try {
    serializeJsonValue(input.run_metadata);
  } catch (error) {
    throw new AnalyzeTemplateRunPersistenceError(`run_metadata: ${errorMessage(error)}`);
  }
  if (typeof input.sealSnapshot !== "function") {
    throw new AnalyzeTemplateRunPersistenceError(
      "sealSnapshot: must be a function returning a SnapshotSealResult",
    );
  }
}

function assertAnalyzeTemplateRunTransactionClient(
  db: AnalyzeTemplateRunPersistenceDb,
): asserts db is AnalyzeTemplateRunTransactionClient {
  if (
    (db as Partial<AnalyzeTemplateRunTransactionClientBrand>)[
      ANALYZE_TEMPLATE_RUN_TRANSACTION_CLIENT
    ] !== true
  ) {
    throw new Error("persistAnalyzeTemplateRunAfterSnapshotSeal requires a pinned transaction client");
  }
}

// A pg.Pool exposes .connect() but not .release(). A pg.PoolClient inherits
// .connect() from pg.Client AND adds .release() — so we can't distinguish
// "pool" from "acquired client" on .connect() alone. The acquired client
// is the one with .release(); anything else with .connect() is a pool.
function isPoolLike(db: AnalyzeTemplateRunPersistenceDb): boolean {
  return (
    typeof (db as { connect?: unknown }).connect === "function" &&
    typeof (db as { release?: unknown }).release !== "function"
  );
}

function isAcquiredClient(db: AnalyzeTemplateRunPersistenceDb): db is AnalyzeTemplateRunPoolClient {
  return typeof (db as { release?: unknown }).release === "function";
}

function isVerifiedSeal(seal: SnapshotSealResult): seal is SnapshotSealResult & { ok: true } {
  return seal.ok && seal.verification.ok;
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new AnalyzeTemplateRunPersistenceError(`${label}: must be a non-empty string`);
  }
}

function assertPositiveInteger(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new AnalyzeTemplateRunPersistenceError(`${label}: must be a positive integer`);
  }
}

function rowFromDb(row: AnalyzeTemplateRunDbRow): AnalyzeTemplateRunRow {
  if (row.blocks === undefined) {
    throw new Error("analyze_template_runs.blocks: expected jsonb array, got undefined");
  }
  return Object.freeze({
    run_id: row.run_id,
    template_id: row.template_id,
    template_version:
      typeof row.template_version === "string" ? Number(row.template_version) : row.template_version,
    playbook_id: row.playbook_id,
    run_metadata: parseJsonValue(row.run_metadata, "analyze_template_runs.run_metadata"),
    snapshot_id: row.snapshot_id,
    blocks: parseBlocks(row.blocks),
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  });
}

function rowWithTemplateFromDb(row: AnalyzeTemplateRunDbRow): AnalyzeTemplateRunWithTemplateRow {
  const templateName = row.template_name;
  if (typeof templateName !== "string" || templateName.length === 0) {
    throw new Error("analyze_template_runs.template_name: expected non-empty string");
  }
  return Object.freeze({
    ...rowFromDb(row),
    template_name: templateName,
  });
}

function summaryRowFromDb(row: AnalyzeTemplateRunDbRow): AnalyzeTemplateRunSummaryRow {
  const templateName = row.template_name;
  if (typeof templateName !== "string" || templateName.length === 0) {
    throw new Error("analyze_template_runs.template_name: expected non-empty string");
  }
  return Object.freeze({
    run_id: row.run_id,
    template_id: row.template_id,
    template_name: templateName,
    template_version:
      typeof row.template_version === "string" ? Number(row.template_version) : row.template_version,
    playbook_id: row.playbook_id,
    run_metadata: parseJsonValue(row.run_metadata, "analyze_template_runs.run_metadata"),
    snapshot_id: row.snapshot_id,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  });
}

function parseBlocks(value: unknown): ReadonlyArray<JsonValue> {
  // pg returns jsonb columns parsed; the column is typed Block[]. A
  // wire-format break that yielded a bare object would silently leak past
  // ReadonlyArray<JsonValue> consumers and surface deep in the renderer.
  // Same posture as services/themes/src/theme-repo.ts:rationaleClaimIds.
  if (!Array.isArray(value)) {
    throw new Error(
      "analyze_template_runs.blocks: expected jsonb array, got " + typeof value,
    );
  }
  return Object.freeze([...value]) as ReadonlyArray<JsonValue>;
}

function parseJsonValue(value: unknown, label: string): JsonValue {
  try {
    serializeJsonValue(value as JsonValue);
  } catch (error) {
    throw new Error(`${label}: ${errorMessage(error)}`);
  }
  return value as JsonValue;
}

function encodeRunCursor(run: Pick<AnalyzeTemplateRunSummaryRow, "created_at" | "run_id">): string {
  return Buffer.from(JSON.stringify({
    created_at: run.created_at,
    run_id: run.run_id,
  })).toString("base64url");
}

function decodeRunCursor(value: string): { created_at: string; run_id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    const createdAt = parsed.created_at;
    const runId = parsed.run_id;
    if (typeof createdAt !== "string" || createdAt.length === 0) {
      throw new Error("missing created_at");
    }
    if (typeof runId !== "string" || runId.length === 0) {
      throw new Error("missing run_id");
    }
    return { created_at: createdAt, run_id: runId };
  } catch {
    throw new AnalyzeTemplateRunPersistenceError("cursor is invalid");
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

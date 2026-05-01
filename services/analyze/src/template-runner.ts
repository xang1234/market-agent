import { serializeJsonValue, type JsonValue } from "../../observability/src/types.ts";
import type { SnapshotSealResult } from "../../snapshot/src/snapshot-sealer.ts";

// Mirrors services/chat/src/messages.ts. The persistence layer is
// snapshot-aware but does NOT itself stage manifests or seal — those are
// caller concerns delegated through the sealSnapshot() callback. The
// renderer that produces Block[] from a sealed snapshot is also a caller
// concern (sibling beads fra-i7z layout-hint rendering, fra-oc8
// source-category → bundle mapping). What this module owns: validate
// inputs, run the seal callback, persist the resulting (template_id,
// template_version, snapshot_id, blocks) row inside one transaction, and
// surface read paths for run history.

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

export class AnalyzeTemplateRunNotFoundError extends Error {
  constructor(message = "analyze template run not found") {
    super(message);
    this.name = "AnalyzeTemplateRunNotFoundError";
  }
}

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
  snapshot_id: string;
  blocks: JsonValue;
  created_at: string;
};

type AnalyzeTemplateRunDbRow = {
  run_id: string;
  template_id: string;
  template_version: number | string;
  snapshot_id: string;
  blocks: JsonValue;
  created_at: Date | string;
};

export type PersistAnalyzeTemplateRunInput = {
  template_id: string;
  // Pinned at run time. analyze_templates.version starts at 1 and only
  // increments; the caller passes the value they read off the template
  // when they kicked off the run, so a later edit to the template doesn't
  // rewrite this run's history.
  template_version: number;
  // The rendered memo. Block[] per the BlockRegistry contract; we don't
  // assert the per-element shape here (that's the renderer's job — fra-i7z),
  // only that the top level is an array.
  blocks: JsonValue;
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
       snapshot_id::text as snapshot_id,
       blocks,
       created_at`;

export async function persistAnalyzeTemplateRunAfterSnapshotSeal(
  db: AnalyzeTemplateRunTransactionClient,
  input: PersistAnalyzeTemplateRunInput,
): Promise<PersistAnalyzeTemplateRunResult> {
  assertAnalyzeTemplateRunTransactionClient(db);
  validatePersistInput(input);

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
    if (error !== null && typeof error === "object" && "rollback_error" in error) {
      releaseError = error as Error;
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
         (template_id, template_version, snapshot_id, blocks)
       values ($1::uuid, $2::integer, $3::uuid, $4::jsonb)
       returning ${SELECT_COLUMNS}`,
      [
        input.template_id,
        input.template_version,
        snapshotId,
        serializeJsonValue(input.blocks),
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
  if (!Array.isArray(input.blocks)) {
    throw new AnalyzeTemplateRunPersistenceError(
      "blocks: must be an array (memo Block[] per the BlockRegistry contract)",
    );
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

function rowFromDb(row: AnalyzeTemplateRunDbRow): AnalyzeTemplateRunRow {
  return Object.freeze({
    run_id: row.run_id,
    template_id: row.template_id,
    template_version:
      typeof row.template_version === "string" ? Number(row.template_version) : row.template_version,
    snapshot_id: row.snapshot_id,
    blocks: row.blocks,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  });
}

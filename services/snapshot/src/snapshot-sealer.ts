import {
  auditManifestToolCallLog,
  type QueryExecutor,
  type SnapshotManifestDraft,
} from "./manifest-staging.ts";
import {
  type SnapshotVerificationInput,
  type SnapshotVerificationResult,
  type SnapshotVerifierFailure,
  verifySnapshotSeal,
} from "./snapshot-verifier.ts";

export type SnapshotSealInput = Omit<SnapshotVerificationInput, "manifest"> & {
  manifest: SnapshotManifestDraft;
};

const SNAPSHOT_TRANSACTION_CLIENT: unique symbol = Symbol("snapshot.transactionClient");

type SnapshotTransactionClientBrand = {
  readonly [SNAPSHOT_TRANSACTION_CLIENT]: true;
};

export type SnapshotPoolClient = QueryExecutor & {
  release(error?: Error): void;
};

export type SnapshotTransactionClient = SnapshotPoolClient & SnapshotTransactionClientBrand;

export type SnapshotClientPool = {
  connect(): Promise<SnapshotPoolClient>;
};

export type SealedSnapshot = SnapshotManifestDraft & {
  snapshot_id: string;
  created_at: string;
};

export type SnapshotSealResult =
  | {
      ok: true;
      snapshot: SealedSnapshot;
      verification: SnapshotVerificationResult;
    }
  | {
      ok: false;
      verification: SnapshotVerificationResult;
    };

export function snapshotTransactionClient<T extends QueryExecutor>(
  client: T,
): T & SnapshotTransactionClient {
  if ((client as Partial<SnapshotTransactionClientBrand>)[SNAPSHOT_TRANSACTION_CLIENT] === true) {
    return client as T & SnapshotTransactionClient;
  }
  if (isPoolLike(client)) {
    throw new Error("sealSnapshot requires a pinned transaction client; use sealSnapshotWithPool for pools");
  }
  if (!isAcquiredClient(client)) {
    throw new Error("sealSnapshot requires an acquired transaction client with release()");
  }
  Object.defineProperty(client, SNAPSHOT_TRANSACTION_CLIENT, {
    value: true,
    enumerable: false,
    configurable: false,
  });
  return client as T & SnapshotTransactionClient;
}

export async function sealSnapshot(
  db: SnapshotTransactionClient,
  input: SnapshotSealInput,
): Promise<SnapshotSealResult> {
  assertSnapshotTransactionClient(db);

  const verificationInput = {
    ...input,
    manifest: {
      ...input.manifest,
      allowed_transforms: input.manifest.allowed_transforms ?? null,
    },
  };
  const verification = await verifySnapshotSeal(verificationInput, db);
  if (!verification.ok) {
    return Object.freeze({ ok: false, verification });
  }

  const toolCallAudit = await auditManifestToolCallLog(db, input.manifest, {
    ...(input.thread_id == null ? {} : { thread_id: input.thread_id }),
  });
  if (!toolCallAudit.ok) {
    const failure: SnapshotVerifierFailure = Object.freeze({
      reason_code: "tool_call_log_audit_failed",
      details: Object.freeze({
        missing_tool_call_ids: [...toolCallAudit.missing_tool_call_ids],
        mismatched_tool_call_ids: [...toolCallAudit.mismatched_tool_call_ids],
        extra_tool_call_ids: [...toolCallAudit.extra_tool_call_ids],
        duplicate_tool_call_ids: [...toolCallAudit.duplicate_tool_call_ids],
        missing_hash_tool_call_ids: [...toolCallAudit.missing_hash_tool_call_ids],
      }),
    });
    await writeSealFailure(db, input, failure);
    return Object.freeze({
      ok: false,
      verification: Object.freeze({
        ok: false,
        failures: Object.freeze([failure]),
      }),
    });
  }

  await db.query("begin");
  try {
    const { rows } = await db.query<{ snapshot_id: string; created_at: string }>(
      `insert into snapshots (
         snapshot_id,
         subject_refs,
         fact_refs,
         claim_refs,
         event_refs,
         document_refs,
         series_specs,
         source_ids,
         tool_call_ids,
         tool_call_result_hashes,
         as_of,
         basis,
         normalization,
         coverage_start,
         allowed_transforms,
         model_version,
         parent_snapshot
       )
       values (
         $1::uuid,
         $2::jsonb,
         $3::jsonb,
         $4::jsonb,
         $5::jsonb,
         $6::jsonb,
         $7::jsonb,
         $8::jsonb,
         $9::jsonb,
         $10::jsonb,
         $11::timestamptz,
         $12::text,
         $13::text,
         $14::timestamptz,
         $15::jsonb,
         $16::text,
         $17::uuid
       )
       returning snapshot_id::text as snapshot_id, created_at::text as created_at`,
      [
        input.snapshot_id,
        jsonParam(input.manifest.subject_refs),
        jsonParam(input.manifest.fact_refs),
        jsonParam(input.manifest.claim_refs),
        jsonParam(input.manifest.event_refs),
        jsonParam(input.manifest.document_refs),
        jsonParam(input.manifest.series_specs),
        jsonParam(input.manifest.source_ids),
        jsonParam(input.manifest.tool_call_ids),
        jsonParam(input.manifest.tool_call_result_hashes),
        input.manifest.as_of,
        input.manifest.basis,
        input.manifest.normalization,
        input.manifest.coverage_start,
        jsonParam(input.manifest.allowed_transforms),
        input.manifest.model_version,
        input.manifest.parent_snapshot,
      ],
    );
    const row = rows[0];
    if (row === undefined) {
      throw new Error("sealSnapshot: snapshot insert returned no row");
    }

    await db.query("commit");
    return Object.freeze({
      ok: true,
      verification,
      snapshot: Object.freeze({
        snapshot_id: row.snapshot_id,
        created_at: row.created_at,
        subject_refs: input.manifest.subject_refs,
        fact_refs: input.manifest.fact_refs,
        claim_refs: input.manifest.claim_refs,
        event_refs: input.manifest.event_refs,
        document_refs: input.manifest.document_refs,
        series_specs: input.manifest.series_specs,
        source_ids: input.manifest.source_ids,
        tool_call_ids: input.manifest.tool_call_ids,
        tool_call_result_hashes: input.manifest.tool_call_result_hashes,
        as_of: input.manifest.as_of,
        basis: input.manifest.basis,
        normalization: input.manifest.normalization,
        coverage_start: input.manifest.coverage_start,
        allowed_transforms: input.manifest.allowed_transforms,
        model_version: input.manifest.model_version,
        parent_snapshot: input.manifest.parent_snapshot,
      }),
    });
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

export async function sealSnapshotWithPool(
  pool: SnapshotClientPool,
  input: SnapshotSealInput,
): Promise<SnapshotSealResult> {
  const client = await pool.connect();
  let releaseError: Error | undefined;
  try {
    return await sealSnapshot(snapshotTransactionClient(client), input);
  } catch (error) {
    if (error instanceof Error && (error as { rollback_error?: unknown }).rollback_error !== undefined) {
      releaseError = error;
    }
    throw error;
  } finally {
    client.release(releaseError);
  }
}

function assertSnapshotTransactionClient(db: QueryExecutor): asserts db is SnapshotTransactionClient {
  if ((db as Partial<SnapshotTransactionClientBrand>)[SNAPSHOT_TRANSACTION_CLIENT] !== true) {
    throw new Error("sealSnapshot requires a pinned transaction client");
  }
}

function isPoolLike(db: QueryExecutor): boolean {
  const candidate = db as {
    connect?: unknown;
  };
  return typeof candidate.connect === "function";
}

function isAcquiredClient(db: QueryExecutor): db is SnapshotPoolClient {
  return typeof (db as { release?: unknown }).release === "function";
}

async function writeSealFailure(
  db: QueryExecutor,
  input: SnapshotSealInput,
  failure: SnapshotVerifierFailure,
): Promise<void> {
  await db.query(
    `insert into verifier_fail_logs
       (thread_id, snapshot_id, reason_code, details)
     values ($1, $2, $3, $4::jsonb)`,
    [
      input.thread_id ?? null,
      input.snapshot_id,
      failure.reason_code,
      JSON.stringify(failure.details),
    ],
  );
}

function jsonParam(value: unknown): string {
  return JSON.stringify(value);
}

import { createHash, randomUUID } from "node:crypto";

import {
  serializeJsonValue,
  type JsonValue,
} from "../../observability/src/types.ts";
import { deriveBlockProof, UNPROVEN, type BlockProof, type SealedSnapshotRecord } from "../../snapshot/src/block-proof.ts";
import type { SnapshotSealResult } from "../../snapshot/src/snapshot-sealer.ts";
import type {
  ChatAssistantMessagePersistence,
  ChatAssistantMessagePersistenceInput,
} from "./coordinator.ts";

export type ChatMessagePersistenceDb = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[] }>;
};

export class ChatMessageIdempotencyConflictError extends Error {
  constructor(message = "chat message idempotency key conflicts with a different payload") {
    super(message);
    this.name = "ChatMessageIdempotencyConflictError";
  }
}

// The snapshot verifier rejected the answer. Carries the verifier's failures so
// display_unverified mode can show why; strict mode surfaces it as turn.error.
export class ChatSnapshotSealError extends Error {
  readonly failures: ReadonlyArray<unknown>;

  constructor(failures: ReadonlyArray<unknown>) {
    super("snapshot seal failed; chat message was not persisted");
    this.name = "ChatSnapshotSealError";
    this.failures = failures;
  }
}

const CHAT_MESSAGE_TRANSACTION_CLIENT: unique symbol = Symbol("chat.messageTransactionClient");

type ChatMessageTransactionClientBrand = {
  readonly [CHAT_MESSAGE_TRANSACTION_CLIENT]: true;
};

export type ChatMessagePoolClient = ChatMessagePersistenceDb & {
  release(error?: Error): void;
};

export type ChatMessageTransactionClient = ChatMessagePoolClient & ChatMessageTransactionClientBrand;

export type ChatMessageClientPool = {
  connect(): Promise<ChatMessagePoolClient>;
};

export type ChatRole = "user" | "assistant" | "tool";

export type ChatMessageRow = {
  message_id: string;
  thread_id: string;
  role: ChatRole;
  snapshot_id: string;
  blocks: JsonValue;
  content_hash: string;
  created_at: string;
  // The model deployment that wrote an assistant message (#183); null otherwise.
  answered_by?: string | null;
};

// A read message: each block's evidence, calculation, and public-time claims,
// derived by the server on every read (#193), never stored or client-supplied.
export type ChatReadMessage = ChatMessageRow & { block_proofs: Record<string, BlockProof> };

export type ChatThreadMessagesResult = {
  messages: ChatReadMessage[];
};

export type PersistChatMessageAfterSnapshotSealInput = {
  thread_id: string;
  role: ChatRole;
  blocks: JsonValue;
  content_hash: string;
  answered_by?: string;
  // The research scope the message answered (research-scope.ts, #206).
  research_scope?: JsonValue;
  sealSnapshot(): Promise<SnapshotSealResult>;
};

export type PersistImportedArtifactMessageInput = {
  thread_id: string;
  user_id: string;
  role: Extract<ChatRole, "assistant">;
  snapshot_id: string;
  blocks: JsonValue;
  content_hash: string;
};

export type PersistUserChatMessageInput = {
  thread_id: string;
  user_id: string;
  content: string;
  message_id?: string;
  snapshot_id?: string;
};

export type ChatMessagePersistenceFactoryInput = {
  pool: ChatMessageClientPool;
  sealSnapshot(input: ChatAssistantMessagePersistenceInput): Promise<SnapshotSealResult>;
};

export type PersistChatMessageAfterSnapshotSealResult =
  | {
      ok: true;
      seal: SnapshotSealResult & { ok: true };
      message: ChatMessageRow;
    }
  | {
      ok: false;
      seal: SnapshotSealResult;
    };

export async function persistChatMessageAfterSnapshotSeal(
  db: ChatMessageTransactionClient,
  input: PersistChatMessageAfterSnapshotSealInput,
): Promise<PersistChatMessageAfterSnapshotSealResult> {
  assertChatMessageTransactionClient(db);

  const seal = await input.sealSnapshot();
  if (!isVerifiedSeal(seal)) {
    return Object.freeze({ ok: false, seal });
  }

  return persistSealedChatMessage(db, input, seal);
}

export async function persistChatMessageAfterSnapshotSealWithPool(
  pool: ChatMessageClientPool,
  input: PersistChatMessageAfterSnapshotSealInput,
): Promise<PersistChatMessageAfterSnapshotSealResult> {
  const seal = await input.sealSnapshot();
  if (!isVerifiedSeal(seal)) {
    return Object.freeze({ ok: false, seal });
  }

  const client = await pool.connect();
  let releaseError: Error | undefined;
  try {
    return await persistSealedChatMessage(chatMessageTransactionClient(client), input, seal);
  } catch (error) {
    if (error instanceof Error && (error as { rollback_error?: unknown }).rollback_error !== undefined) {
      releaseError = error;
    }
    throw error;
  } finally {
    client.release(releaseError);
  }
}

export function createChatMessagePersistence(
  input: ChatMessagePersistenceFactoryInput,
): ChatAssistantMessagePersistence {
  return async (message) => {
    const result = await persistChatMessageAfterSnapshotSealWithPool(input.pool, {
      thread_id: message.threadId,
      role: message.role,
      blocks: message.blocks as JsonValue,
      content_hash: message.content_hash,
      ...(message.answered_by ? { answered_by: message.answered_by } : {}),
      ...(message.research_scope ? { research_scope: message.research_scope as JsonValue } : {}),
      sealSnapshot: () => input.sealSnapshot(message),
    });

    if (!result.ok) {
      throw new ChatSnapshotSealError(result.seal.verification.failures);
    }

    return {
      snapshot_id: result.seal.snapshot.snapshot_id,
      message_id: result.message.message_id,
    };
  };
}

export async function listChatMessagesForThread(
  db: ChatMessagePersistenceDb,
  input: { thread_id: string; user_id: string },
): Promise<ChatThreadMessagesResult | null> {
  const owner = await db.query<{ owned: boolean }>(
    `select true as owned
       from chat_threads
      where thread_id = $1::uuid
        and user_id = $2::uuid
      limit 1`,
    [input.thread_id, input.user_id],
  );
  if (owner.rows.length === 0) return null;

  const { rows } = await db.query<ChatMessageRow>(
    `select m.message_id::text as message_id,
            m.thread_id::text as thread_id,
            m.role,
            m.snapshot_id::text as snapshot_id,
            m.blocks,
            m.content_hash,
            m.created_at::text as created_at,
            m.answered_by
       from chat_messages m
      where m.thread_id = $1::uuid
      order by m.created_at asc, m.message_id asc`,
    [input.thread_id],
  );
  // Every snapshot a message or any of its blocks names: an imported block keeps
  // the snapshot it came from.
  const snapshots = await loadSealedSnapshots(db, rows.flatMap((row) => [row.snapshot_id, ...blockSnapshotIds(row.blocks)]));
  return {
    messages: rows.map((row) => Object.freeze({ ...row, block_proofs: blockProofs(row, snapshots) })),
  };
}

function blockSnapshotIds(blocks: JsonValue): string[] {
  return (Array.isArray(blocks) ? blocks : []).flatMap((block) =>
    block !== null && typeof block === "object" && !Array.isArray(block) && typeof block.snapshot_id === "string" ? [block.snapshot_id] : []
  );
}

// Each block is judged against its own snapshot (the message's when it names none).
function blockProofs(row: ChatMessageRow, snapshots: ReadonlyMap<string, SealedSnapshotRecord>): Record<string, BlockProof> {
  // No prototype: any string is a valid block id, "__proto__" included.
  const proofs: Record<string, BlockProof> = Object.create(null);
  const seen = new Set<string>();
  for (const block of Array.isArray(row.blocks) ? row.blocks : []) {
    const id = block !== null && typeof block === "object" && !Array.isArray(block) ? block.id : undefined;
    if (typeof id !== "string") continue;
    // Proofs are keyed by block id: an id used twice cannot say which block a
    // claim belongs to, so it claims nothing rather than lend one block's
    // proof to its namesake.
    const snapshotId = typeof (block as { snapshot_id?: unknown }).snapshot_id === "string"
      ? (block as { snapshot_id: string }).snapshot_id
      : row.snapshot_id;
    const snapshot = (snapshotId && snapshots.get(snapshotId)) || null;
    proofs[id] = seen.has(id) ? UNPROVEN : deriveBlockProof(block, snapshot);
    seen.add(id);
  }
  return proofs;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Each sealed snapshot's manifest and the financial certificates recorded for it.
async function loadSealedSnapshots(
  db: ChatMessagePersistenceDb,
  snapshotIds: ReadonlyArray<string | null>,
): Promise<Map<string, SealedSnapshotRecord>> {
  // Only well-formed ids reach the uuid[] cast: a malformed one in a stored
  // block has no sealed snapshot, and must not fail the whole read.
  const ids = [...new Set(snapshotIds.filter((id): id is string => typeof id === "string" && UUID.test(id)))];
  if (ids.length === 0) return new Map();
  const [manifests, certificates] = await Promise.all([
    db.query<{
      snapshot_id: string;
      fact_refs: string[];
      claim_refs: string[];
      event_refs: string[];
      document_refs: string[];
      source_ids: string[];
      series_specs: Array<{ series_ref?: unknown }>;
    }>(
      `select snapshot_id::text as snapshot_id, fact_refs, claim_refs, event_refs, document_refs, source_ids, series_specs
         from snapshots
        where snapshot_id = any($1::uuid[])`,
      [ids],
    ),
    db.query<{ snapshot_id: string; run_id: string; unit_id: string; presentation_hash: string }>(
      `select snapshot_id::text as snapshot_id, run_id::text as run_id, unit_id, presentation_hash
         from snapshot_financial_runs
        where snapshot_id = any($1::uuid[])`,
      [ids],
    ),
  ]);
  const certificatesBySnapshot = new Map<string, Array<{ run_id: string; unit_id: string; presentation_hash: string }>>();
  for (const certificate of certificates.rows) {
    const list = certificatesBySnapshot.get(certificate.snapshot_id) ?? [];
    list.push(certificate);
    certificatesBySnapshot.set(certificate.snapshot_id, list);
  }
  return new Map(manifests.rows.map((row) => [row.snapshot_id, {
    fact_refs: row.fact_refs ?? [],
    claim_refs: row.claim_refs ?? [],
    event_refs: row.event_refs ?? [],
    document_refs: row.document_refs ?? [],
    source_ids: row.source_ids ?? [],
    series_refs: (row.series_specs ?? []).flatMap((spec) => typeof spec?.series_ref === "string" ? [spec.series_ref] : []),
    certificates: certificatesBySnapshot.get(row.snapshot_id) ?? [],
  }]));
}

export async function persistImportedArtifactMessage(
  db: ChatMessagePersistenceDb,
  input: PersistImportedArtifactMessageInput,
): Promise<ChatMessageRow | null> {
  const owner = await db.query<{ owned: boolean }>(
    `select true as owned
       from chat_threads
      where thread_id = $1::uuid
        and user_id = $2::uuid
      limit 1`,
    [input.thread_id, input.user_id],
  );
  if (owner.rows.length === 0) return null;

  const { rows } = await db.query<ChatMessageRow>(
    `insert into chat_messages
       (thread_id, role, snapshot_id, blocks, content_hash)
     values ($1::uuid, $3::chat_role, $4::uuid, $5::jsonb, $6)
     returning
       message_id::text as message_id,
       thread_id::text as thread_id,
       role,
       snapshot_id::text as snapshot_id,
       blocks,
       content_hash,
       created_at::text as created_at`,
    [
      input.thread_id,
      input.user_id,
      input.role,
      input.snapshot_id,
      serializeJsonValue(input.blocks),
      input.content_hash,
    ],
  );
  const message = rows[0];
  if (message === undefined) {
    throw new Error("persistImportedArtifactMessage: chat message insert returned no row");
  }
  return Object.freeze({ ...message });
}

export async function persistUserChatMessage(
  db: ChatMessagePersistenceDb,
  input: PersistUserChatMessageInput,
): Promise<ChatMessageRow | null> {
  const client = await acquireChatMessageClient(db);
  let completed = false;
  let releaseError: Error | undefined;
  const messageId = input.message_id ?? randomUUID();
  const snapshotId = input.snapshot_id ?? randomUUID();
  const asOf = new Date().toISOString();
  const blocks = [
    {
      id: messageId,
      kind: "rich_text",
      snapshot_id: snapshotId,
      data_ref: { kind: "chat_turn", id: messageId },
      source_refs: [],
      as_of: asOf,
      segments: [{ type: "text", text: input.content }],
    },
  ] satisfies JsonValue[];
  const contentHash = hashJson(blocks);

  await client.query("begin");
  try {
    const owner = await client.query<{ owned: boolean }>(
      `select true as owned
         from chat_threads
        where thread_id = $1::uuid
          and user_id = $2::uuid
        limit 1`,
      [input.thread_id, input.user_id],
    );
    if (owner.rows.length === 0) {
      await client.query("rollback");
      completed = true;
      return null;
    }

    await client.query(
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
         '[]'::jsonb,
         '[]'::jsonb,
         '[]'::jsonb,
         '[]'::jsonb,
         '[]'::jsonb,
         '[]'::jsonb,
         '[]'::jsonb,
         '[]'::jsonb,
         '[]'::jsonb,
         $2::timestamptz,
         'user_input',
         'none',
         null,
         '{}'::jsonb,
         'chat-user-message',
         null
       )
       on conflict (snapshot_id) do nothing`,
      [snapshotId, asOf],
    );

    const { rows } = await client.query<ChatMessageRow>(
      `insert into chat_messages
         (message_id, thread_id, role, snapshot_id, blocks, content_hash)
       values ($1::uuid, $2::uuid, 'user'::chat_role, $3::uuid, $4::jsonb, $5)
       on conflict (message_id) do update
         set content_hash = chat_messages.content_hash
        where chat_messages.thread_id = excluded.thread_id
          and chat_messages.snapshot_id = excluded.snapshot_id
          and chat_messages.content_hash = excluded.content_hash
          and chat_messages.blocks = excluded.blocks
       returning
         message_id::text as message_id,
         thread_id::text as thread_id,
         role,
         snapshot_id::text as snapshot_id,
         blocks,
         content_hash,
         created_at::text as created_at`,
      [
        messageId,
        input.thread_id,
        snapshotId,
        serializeJsonValue(blocks),
        contentHash,
      ],
    );
    const message = rows[0];
    if (message === undefined) {
      throw new ChatMessageIdempotencyConflictError();
    }

    await client.query(
      `update chat_threads
          set latest_snapshot_id = $2::uuid,
              updated_at = now()
        where thread_id = $1::uuid`,
      [input.thread_id, message.snapshot_id],
    );
    await client.query("commit");
    completed = true;

    return Object.freeze({ ...message });
  } catch (error) {
    try {
      if (!completed) await client.query("rollback");
    } catch (rollbackError) {
      if (error !== null && typeof error === "object") {
        (error as { rollback_error?: unknown }).rollback_error = rollbackError;
      }
    }
    if (error instanceof Error && (error as { rollback_error?: unknown }).rollback_error !== undefined) {
      releaseError = error;
    }
    throw error;
  } finally {
    releaseChatMessageClient(client, releaseError);
  }
}

export function chatMessageTransactionClient<T extends ChatMessagePersistenceDb>(
  client: T,
): T & ChatMessageTransactionClient {
  if ((client as Partial<ChatMessageTransactionClientBrand>)[CHAT_MESSAGE_TRANSACTION_CLIENT] === true) {
    return client as T & ChatMessageTransactionClient;
  }
  if (isPoolLike(client)) {
    throw new Error(
      "persistChatMessageAfterSnapshotSeal requires a pinned transaction client; use persistChatMessageAfterSnapshotSealWithPool for pools",
    );
  }
  if (!isAcquiredClient(client)) {
    throw new Error("persistChatMessageAfterSnapshotSeal requires an acquired transaction client with release()");
  }
  Object.defineProperty(client, CHAT_MESSAGE_TRANSACTION_CLIENT, {
    value: true,
    enumerable: false,
    configurable: false,
  });
  return client as T & ChatMessageTransactionClient;
}

async function persistSealedChatMessage(
  db: ChatMessageTransactionClient,
  input: PersistChatMessageAfterSnapshotSealInput,
  seal: SnapshotSealResult & { ok: true },
): Promise<PersistChatMessageAfterSnapshotSealResult & { ok: true }> {
  const snapshotId = seal.snapshot.snapshot_id;
  await db.query("begin");
  try {
    const { rows } = await db.query<ChatMessageRow>(
      `insert into chat_messages
         (thread_id, role, snapshot_id, blocks, content_hash, answered_by, research_scope)
       values ($1::uuid, $2::chat_role, $3::uuid, $4::jsonb, $5, $6, $7::jsonb)
       returning
         message_id::text as message_id,
         thread_id::text as thread_id,
         role,
         snapshot_id::text as snapshot_id,
         blocks,
         content_hash,
         created_at::text as created_at,
         answered_by`,
      [
        input.thread_id,
        input.role,
        snapshotId,
        serializeJsonValue(input.blocks),
        input.content_hash,
        input.answered_by ?? null,
        input.research_scope === undefined ? null : serializeJsonValue(input.research_scope),
      ],
    );
    const message = rows[0];
    if (message === undefined) {
      throw new Error("persistChatMessageAfterSnapshotSeal: chat message insert returned no row");
    }

    await db.query(
      `update chat_threads
          set latest_snapshot_id = $2::uuid,
              updated_at = now()
        where thread_id = $1::uuid`,
      [input.thread_id, snapshotId],
    );
    await db.query("commit");

    return Object.freeze({
      ok: true,
      seal,
      message: Object.freeze(message),
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

function assertChatMessageTransactionClient(
  db: ChatMessagePersistenceDb,
): asserts db is ChatMessageTransactionClient {
  if ((db as Partial<ChatMessageTransactionClientBrand>)[CHAT_MESSAGE_TRANSACTION_CLIENT] !== true) {
    throw new Error("persistChatMessageAfterSnapshotSeal requires a pinned transaction client");
  }
}

function isPoolLike(db: ChatMessagePersistenceDb): boolean {
  return (
    typeof (db as { connect?: unknown }).connect === "function" &&
    typeof (db as { release?: unknown }).release !== "function"
  );
}

function isAcquiredClient(db: ChatMessagePersistenceDb): db is ChatMessagePoolClient {
  return typeof (db as { release?: unknown }).release === "function";
}

function isVerifiedSeal(seal: SnapshotSealResult): seal is SnapshotSealResult & { ok: true } {
  return seal.ok && seal.verification.ok;
}

function hashJson(value: JsonValue): string {
  return `sha256:${createHash("sha256").update(serializeJsonValue(value)).digest("hex")}`;
}

async function acquireChatMessageClient(
  db: ChatMessagePersistenceDb,
): Promise<ChatMessagePersistenceDb | ChatMessagePoolClient> {
  if (isAcquiredClient(db)) return db;
  const connect = (db as Partial<ChatMessageClientPool>).connect;
  if (typeof connect !== "function") return db;
  return connect.call(db);
}

function releaseChatMessageClient(
  client: ChatMessagePersistenceDb | ChatMessagePoolClient,
  error: Error | undefined,
) {
  if (isAcquiredClient(client)) client.release(error);
}

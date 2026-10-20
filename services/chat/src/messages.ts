import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { PERF_POINTS } from "../../market/src/perf-points.ts";

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
import { isUuid } from "./chat-ids.ts";

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

// The message row committed, but reading it back failed. The answer is saved,
// so its turn completes with the id alone and the client reloads the thread.
export class ChatMessageUnreadError extends Error {
  readonly message_id: string;
  readonly snapshot_id: string;

  constructor(messageId: string, snapshotId: string, cause: unknown) {
    super(`the committed message ${messageId} could not be read back`, { cause });
    this.name = "ChatMessageUnreadError";
    this.message_id = messageId;
    this.snapshot_id = snapshotId;
  }
}

export function logUnreadMessage(messageId: string, cause: unknown): void {
  console.error(`[chat] the committed message ${messageId} could not be read back; its turn completes without it`, cause);
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

// A committed assistant message: its read, or null when the read after the
// commit failed (logged), so only its ids are known.
export type ChatCommittedMessage = Readonly<{ message_id: string; snapshot_id: string; message: ChatReadMessage | null }>;

export function sealedCompletion(
  committed: Pick<ChatCommittedMessage, "message_id" | "message"> | null,
  fallbackMessageId: string,
): { message_id: string; message?: ChatReadMessage } {
  if (committed === null) return { message_id: fallbackMessageId };
  return committed.message ? { message_id: committed.message_id, message: committed.message } : { message_id: committed.message_id };
}

export type ChatThreadMessagesResult = {
  messages: ChatReadMessage[];
};

export type PersistChatMessageAfterSnapshotSealInput = {
  message_id?: string;
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
      message: ChatReadMessage;
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
  input: PersistChatMessageAfterSnapshotSealInput & {
    // Between the seal and the save: given the sealed snapshot and the proofs
    // of the blocks it sealed, the blocks to save instead. No connection is
    // held while it runs.
    reveal?: (sealed: { snapshot_id: string; block_proofs: Readonly<Record<string, BlockProof>> }) =>
      Promise<{ blocks: JsonValue; content_hash: string }>;
  },
): Promise<PersistChatMessageAfterSnapshotSealResult> {
  const seal = await input.sealSnapshot();
  if (!isVerifiedSeal(seal)) {
    return Object.freeze({ ok: false, seal });
  }
  const saved = input.reveal ? { ...input, ...(await revealed(pool, input.blocks, seal.snapshot.snapshot_id, input.reveal)) } : input;

  const client = await pool.connect();
  let releaseError: Error | undefined;
  try {
    return await persistSealedChatMessage(chatMessageTransactionClient(client), saved, seal);
  } catch (error) {
    if (error instanceof Error && (error as { rollback_error?: unknown }).rollback_error !== undefined) {
      releaseError = error;
    }
    throw error;
  } finally {
    client.release(releaseError);
  }
}

// The blocks a reveal returns, once their proofs are read off the snapshot
// just sealed, as a message read would. They must read as the sealed blocks
// do to the verifier and to a proof, which read every block whole but a
// rich_text block's text segments (snapshot-verifier.ts extractBlockRefs and
// its ref format checks, block-proof.ts): anything else is not saved.
async function revealed(
  pool: ChatMessageClientPool,
  blocks: JsonValue,
  snapshotId: string,
  reveal: NonNullable<Parameters<typeof persistChatMessageAfterSnapshotSealWithPool>[1]["reveal"]>,
): Promise<{ blocks: JsonValue; content_hash: string }> {
  const client = await pool.connect();
  let snapshots: Map<string, SealedSnapshotRecord>;
  try {
    snapshots = await loadSealedSnapshots(client, [snapshotId, ...blockSnapshotIds(blocks)]);
  } finally {
    client.release();
  }
  const shown = await reveal({ snapshot_id: snapshotId, block_proofs: blockProofs({ blocks, snapshot_id: snapshotId }, snapshots) });
  if (!isDeepStrictEqual(sealedView(shown.blocks), sealedView(blocks))) {
    throw new Error("a revealed answer may differ from the sealed one only in its text; it was not saved");
  }
  return shown;
}

function sealedView(blocks: JsonValue): unknown[] {
  const isText = (segment: unknown) => (segment as { type?: unknown } | null)?.type === "text";
  return (Array.isArray(blocks) ? blocks : []).map((block) =>
    block !== null && typeof block === "object" && !Array.isArray(block) && block.kind === "rich_text" && Array.isArray(block.segments)
      ? { ...block, segments: block.segments.filter((segment: unknown) => !isText(segment)) }
      : block
  );
}

export function createChatMessagePersistence(
  input: ChatMessagePersistenceFactoryInput,
): ChatAssistantMessagePersistence {
  return async (message) => {
    const result = await persistChatMessageAfterSnapshotSealWithPool(input.pool, {
      message_id: message.message_id,
      thread_id: message.threadId,
      role: message.role,
      blocks: message.blocks as JsonValue,
      content_hash: message.content_hash,
      ...(message.answered_by ? { answered_by: message.answered_by } : {}),
      ...(message.research_scope ? { research_scope: message.research_scope as JsonValue } : {}),
      ...(message.reveal
        ? {
          reveal: async (sealed: { snapshot_id: string; block_proofs: Readonly<Record<string, BlockProof>> }) => {
            const shown = await message.reveal!(sealed);
            return { blocks: shown.blocks as JsonValue, content_hash: shown.content_hash };
          },
        }
        : {}),
      sealSnapshot: () => input.sealSnapshot(message),
    });

    if (!result.ok) {
      throw new ChatSnapshotSealError(result.seal.verification.failures);
    }

    return result.message;
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

  return { messages: await readMessages(db, "m.thread_id = $1::uuid", [input.thread_id]) };
}

/**
 * One message of a thread, read exactly as listChatMessagesForThread reads it;
 * null when the thread has no such message. It checks no owner: callers read
 * a message they just wrote under an authorized thread.
 */
export async function readChatMessage(
  db: ChatMessagePersistenceDb,
  input: { thread_id: string; message_id: string },
): Promise<ChatReadMessage | null> {
  const [message] = await readMessages(db, "m.message_id = $1::uuid and m.thread_id = $2::uuid", [input.message_id, input.thread_id]);
  return message ?? null;
}

// The read model behind every message read, so the GET and the turn's
// completion (#331) return the same columns and the same proofs.
async function readMessages(db: ChatMessagePersistenceDb, where: string, values: unknown[]): Promise<ChatReadMessage[]> {
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
      where ${where}
      order by m.created_at asc, m.message_id asc`,
    values,
  );
  // Every snapshot a message or any of its blocks names: an imported block keeps
  // the snapshot it came from.
  const snapshots = await loadSealedSnapshots(db, rows.flatMap((row) => [row.snapshot_id, ...blockSnapshotIds(row.blocks)]));
  return rows.map((row) => Object.freeze({ ...row, block_proofs: blockProofs(row, snapshots) }));
}

export function firstBlockId(message: Pick<ChatMessageRow, "blocks">): string | null {
  const [block] = Array.isArray(message.blocks) ? message.blocks : [];
  return block !== null && typeof block === "object" && !Array.isArray(block) && typeof block.id === "string" ? block.id : null;
}

function blockSnapshotIds(blocks: JsonValue): string[] {
  return (Array.isArray(blocks) ? blocks : []).flatMap((block) =>
    block !== null && typeof block === "object" && !Array.isArray(block) && typeof block.snapshot_id === "string" ? [block.snapshot_id] : []
  );
}

// Each block is judged against its own snapshot (the message's when it names none).
function blockProofs(row: Pick<ChatMessageRow, "blocks" | "snapshot_id">, snapshots: ReadonlyMap<string, SealedSnapshotRecord>): Record<string, BlockProof> {
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

// Each sealed snapshot's manifest and the financial certificates recorded for it.
async function loadSealedSnapshots(
  db: ChatMessagePersistenceDb,
  snapshotIds: ReadonlyArray<string | null>,
): Promise<Map<string, SealedSnapshotRecord>> {
  // Only well-formed ids reach the uuid[] cast: a malformed one in a stored
  // block has no sealed snapshot, and must not fail the whole read.
  const ids = [...new Set(snapshotIds.filter((id): id is string => typeof id === "string" && isUuid(id)))];
  if (ids.length === 0) return new Map();
  const [manifests, certificates] = await Promise.all([
    db.query<{
      snapshot_id: string;
      fact_refs: string[];
      claim_refs: string[];
      event_refs: string[];
      document_refs: string[];
      source_ids: string[];
      series_specs: Array<{ series_ref?: unknown; points?: unknown }>;
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
    checked_series_refs: (row.series_specs ?? []).flatMap((spec) =>
      typeof spec?.series_ref === "string" && spec.points === PERF_POINTS ? [spec.series_ref] : []
    ),
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
     values ($1::uuid, $2::chat_role, $3::uuid, $4::jsonb, $5)
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
  let messageId: string;
  await db.query("begin");
  try {
    const { rows } = await db.query<{ message_id: string }>(
      `insert into chat_messages
         (message_id, thread_id, role, snapshot_id, blocks, content_hash, answered_by, research_scope)
       values ($8::uuid, $1::uuid, $2::chat_role, $3::uuid, $4::jsonb, $5, $6, $7::jsonb)
       on conflict (message_id) do nothing
       returning message_id::text as message_id`,
      [
        input.thread_id,
        input.role,
        snapshotId,
        serializeJsonValue(input.blocks),
        input.content_hash,
        input.answered_by ?? null,
        input.research_scope === undefined ? null : serializeJsonValue(input.research_scope),
        input.message_id ?? randomUUID(),
      ],
    );
    const inserted = rows[0];
    if (inserted === undefined) {
      if (input.message_id === undefined) {
        throw new Error("persistChatMessageAfterSnapshotSeal: chat message insert returned no row");
      }
      // A turn re-run after a restart keeps the answer its first attempt saved.
      messageId = input.message_id;
    } else {
      messageId = inserted.message_id;
      await db.query(
        `update chat_threads
            set latest_snapshot_id = $2::uuid,
                updated_at = now()
          where thread_id = $1::uuid`,
        [input.thread_id, snapshotId],
      );
    }
    await db.query("commit");
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

  // Read back through the read model, so the caller holds what any later read returns.
  let message: ChatReadMessage | null;
  try {
    message = await readChatMessage(db, { thread_id: input.thread_id, message_id: messageId });
  } catch (error) {
    throw new ChatMessageUnreadError(messageId, snapshotId, error);
  }
  if (message === null) {
    throw new Error(`persistChatMessageAfterSnapshotSeal: the committed message ${messageId} could not be read back`);
  }
  return Object.freeze({ ok: true, seal, message });
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

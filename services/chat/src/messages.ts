import { createHash, randomUUID } from "node:crypto";

import {
  serializeJsonValue,
  type JsonValue,
} from "../../observability/src/types.ts";
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
};

export type ChatThreadMessagesResult = {
  messages: ChatMessageRow[];
};

export type PersistChatMessageAfterSnapshotSealInput = {
  thread_id: string;
  role: ChatRole;
  blocks: JsonValue;
  content_hash: string;
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
      sealSnapshot: () => input.sealSnapshot(message),
    });

    if (!result.ok) {
      throw new Error("snapshot seal failed; chat message was not persisted");
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
            m.created_at::text as created_at
       from chat_messages m
      where m.thread_id = $1::uuid
      order by m.created_at asc, m.message_id asc`,
    [input.thread_id],
  );
  return {
    messages: rows.map((row) => Object.freeze({ ...row })),
  };
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
  const owner = await db.query<{ owned: boolean }>(
    `select true as owned
       from chat_threads
      where thread_id = $1::uuid
        and user_id = $2::uuid
      limit 1`,
    [input.thread_id, input.user_id],
  );
  if (owner.rows.length === 0) return null;

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

  await db.query(
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

  const { rows } = await db.query<ChatMessageRow>(
    `insert into chat_messages
       (message_id, thread_id, role, snapshot_id, blocks, content_hash)
     values ($1::uuid, $2::uuid, 'user'::chat_role, $3::uuid, $4::jsonb, $5)
     on conflict (message_id) do update
       set content_hash = chat_messages.content_hash
      where chat_messages.thread_id = excluded.thread_id
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
    throw new Error("persistUserChatMessage: chat message insert returned no row");
  }

  await db.query(
    `update chat_threads
        set latest_snapshot_id = $2::uuid,
            updated_at = now()
      where thread_id = $1::uuid`,
    [input.thread_id, message.snapshot_id],
  );

  return Object.freeze({ ...message });
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
        snapshotId,
        serializeJsonValue(input.blocks),
        input.content_hash,
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

// fra-asy: this misclassifies acquired pg.PoolClients (they inherit
// .connect from pg.Client AND have .release), so callers using the
// *WithPool variant correctly hit the wrong error. Fixed in
// services/analyze/src/template-runner.ts; consolidate when fra-asy lands.
function isPoolLike(db: ChatMessagePersistenceDb): boolean {
  const candidate = db as {
    connect?: unknown;
  };
  return typeof candidate.connect === "function";
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

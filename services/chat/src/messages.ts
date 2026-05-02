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

export type PersistChatMessageAfterSnapshotSealInput = {
  thread_id: string;
  role: ChatRole;
  blocks: JsonValue;
  content_hash: string;
  sealSnapshot(): Promise<SnapshotSealResult>;
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

// A pg.Pool exposes .connect() but not .release(). A pg.PoolClient inherits
// .connect() from pg.Client AND adds .release() — so we can't distinguish
// "pool" from "acquired client" on .connect() alone. The acquired client
// is the one with .release(); anything else with .connect() is a pool.
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

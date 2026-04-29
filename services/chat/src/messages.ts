import {
  serializeJsonValue,
  type JsonValue,
} from "../../observability/src/types.ts";
import type { SnapshotSealResult } from "../../snapshot/src/snapshot-sealer.ts";

export type ChatMessagePersistenceDb = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[] }>;
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

export type PersistChatMessageAfterSnapshotSealResult =
  | {
      ok: true;
      seal: SnapshotSealResult & { ok: true };
      message: ChatMessageRow;
    }
  | {
      ok: false;
      seal: SnapshotSealResult & { ok: false };
    };

export async function persistChatMessageAfterSnapshotSeal(
  db: ChatMessagePersistenceDb,
  input: PersistChatMessageAfterSnapshotSealInput,
): Promise<PersistChatMessageAfterSnapshotSealResult> {
  const seal = await input.sealSnapshot();
  if (!seal.ok) {
    return Object.freeze({ ok: false, seal });
  }

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

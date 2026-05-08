import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";

import type { Client } from "pg";

import {
  bootstrapDatabase,
  connectedClient,
  dockerAvailable,
  registerLifoCleanup,
} from "../../../db/test/docker-pg.ts";
import { createClaimArgument } from "../../evidence/src/claim-argument-repo.ts";
import { createClaimEvidence } from "../../evidence/src/claim-evidence-repo.ts";
import { createClaim } from "../../evidence/src/claim-repo.ts";
import { createDocument } from "../../evidence/src/document-repo.ts";
import { ephemeralRawBlobIdForSource } from "../../evidence/src/object-store.ts";
import { createSource } from "../../evidence/src/source-repo.ts";
import {
  analystToolRuntime,
  closeLocalRuntimePoolForTests,
  persistAssistantMessage,
} from "../src/local-runtime.ts";
import { createThread } from "../src/threads-repo.ts";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "10000000-0000-4000-8000-000000000099";
const RUN_ID = "20000000-0000-4000-8000-000000000002";
const TURN_ID = "30000000-0000-4000-8000-000000000003";

async function seedUser(client: Client, userId = USER_ID): Promise<void> {
  await client.query(
    `insert into users (user_id, email) values ($1::uuid, $2)`,
    [userId, `${userId}@chat-local-runtime.example.test`],
  );
}

async function seedExistingEvidence(
  client: Client,
  subjectId: string,
  input: { userId?: string | null; label: string },
): Promise<{ claimId: string; documentId: string; sourceId: string }> {
  const asOf = "2026-05-07T00:00:00.000Z";
  const hashDigit = input.label === "owned" ? "3" : "7";
  const source = await createSource(client, {
    provider: `seeded-chat-evidence-${input.label}`,
    kind: "article",
    trust_tier: "secondary",
    license_class: "public",
    retrieved_at: asOf,
    content_hash: `sha256:${hashDigit.repeat(64)}`,
    user_id: input.userId ?? null,
  });
  const document = (await createDocument(client, {
    source_id: source.source_id,
    kind: "article",
    title: `Seeded chat evidence (${input.label})`,
    published_at: asOf,
    content_hash: `sha256:${(input.label === "owned" ? "4" : "6").repeat(64)}`,
    raw_blob_id: ephemeralRawBlobIdForSource(source.source_id),
    parse_status: "parsed",
  })).document;
  const claim = await createClaim(client, {
    document_id: document.document_id,
    predicate: "chat.local_runtime",
    text_canonical: `${input.label} seeded chat evidence says product demand improved.`,
    polarity: "positive",
    modality: "asserted",
    reported_by_source_id: source.source_id,
    effective_time: asOf,
    confidence: 0.81,
    status: "extracted",
  });
  await createClaimArgument(client, {
    claim_id: claim.claim_id,
    subject_kind: "screen",
    subject_id: subjectId,
    role: "subject",
  });
  await createClaimEvidence(client, {
    claim_id: claim.claim_id,
    document_id: document.document_id,
    locator: { kind: "paragraph", index: 1 },
    confidence: 0.81,
  });
  return { claimId: claim.claim_id, documentId: document.document_id, sourceId: source.source_id };
}

test("default local chat runtime persists a verifier-valid assistant message from existing evidence", {
  skip: !dockerAvailable(),
  timeout: 120_000,
}, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "chat-local-runtime");
  const previousChatUrl = process.env.CHAT_DATABASE_URL;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousStub = process.env.CHAT_LOCAL_TOOL_EXECUTOR;
  process.env.CHAT_DATABASE_URL = databaseUrl;
  delete process.env.CHAT_LOCAL_TOOL_EXECUTOR;
  registerLifoCleanup(t, async () => {
    await closeLocalRuntimePoolForTests();
    restoreEnv("CHAT_DATABASE_URL", previousChatUrl);
    restoreEnv("DATABASE_URL", previousDatabaseUrl);
    restoreEnv("CHAT_LOCAL_TOOL_EXECUTOR", previousStub);
  });

  const client = await connectedClient(t, databaseUrl);
  await seedUser(client);
  await seedUser(client, OTHER_USER_ID);
  const thread = await createThread(client, USER_ID, { title: "Local runtime" });
  const otherUserSeeded = await seedExistingEvidence(client, thread.thread_id, {
    userId: OTHER_USER_ID,
    label: "other-user",
  });
  const seeded = await seedExistingEvidence(client, thread.thread_id, {
    userId: USER_ID,
    label: "owned",
  });

  const result = await analystToolRuntime({
    threadId: thread.thread_id,
    runId: RUN_ID,
    turnId: TURN_ID,
    userId: USER_ID,
    bundleId: "single_subject_analysis",
    userIntent: "Summarize demand",
    emit: (() => ({}) as never),
  });

  assert.equal(result.blocks.length, 1);
  assert.deepEqual(result.blocks[0]?.source_refs, [seeded.sourceId]);
  assert.deepEqual(result.blocks[0]?.claim_refs, [seeded.claimId]);
  assert.deepEqual(result.blocks[0]?.document_refs, [seeded.documentId]);
  assert.equal((result.blocks[0]?.claim_refs as unknown[]).includes(otherUserSeeded.claimId), false);
  assert.doesNotMatch(JSON.stringify(result.blocks[0]), /other-user seeded chat evidence/);
  assert.ok(Array.isArray(result.blocks[0]?.tool_call_ids));

  const persisted = await persistAssistantMessage({
    threadId: thread.thread_id,
    runId: RUN_ID,
    turnId: TURN_ID,
    role: "assistant",
    blocks: result.blocks,
    content_hash: contentHash(JSON.stringify(result.blocks)),
  });
  assert.equal(persisted.snapshot_id, result.snapshot_id);

  const snapshotRows = (await client.query<{
    claim_refs: unknown;
    document_refs: unknown;
    source_ids: unknown;
    tool_call_ids: unknown;
  }>(
    `select claim_refs, document_refs, source_ids, tool_call_ids
       from snapshots
      where snapshot_id = $1::uuid`,
    [result.snapshot_id],
  )).rows;
  assert.equal(snapshotRows.length, 1);
  assert.deepEqual(snapshotRows[0]?.claim_refs, [seeded.claimId]);
  assert.deepEqual(snapshotRows[0]?.document_refs, [seeded.documentId]);
  assert.deepEqual(snapshotRows[0]?.source_ids, [seeded.sourceId]);
  assert.equal(Array.isArray(snapshotRows[0]?.tool_call_ids), true);

  const messageRows = (await client.query<{ message_id: string }>(
    `select message_id::text as message_id
       from chat_messages
      where message_id = $1::uuid`,
    [persisted.message_id],
  )).rows;
  assert.equal(messageRows.length, 1);

  const toolRows = (await client.query<{ result_hash: string | null }>(
    `select result_hash
       from tool_call_logs
      where thread_id = $1::uuid`,
    [thread.thread_id],
  )).rows;
  assert.equal(toolRows.length, 1);
  assert.match(toolRows[0]?.result_hash ?? "", /^sha256:/);
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

function contentHash(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

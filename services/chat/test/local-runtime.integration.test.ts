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
import { ChatSnapshotSealError } from "../src/messages.ts";
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

test("default local chat runtime persists a verifier-valid assistant message from the user's own evidence, citing none it does not quote (#398)", {
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
  await seedExistingEvidence(client, thread.thread_id, {
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
  const [loaded] = result.tool_calls ?? [];
  assert.deepEqual((loaded?.result as { evidence: { claim_refs: string[] } }).evidence.claim_refs, [seeded.claimId], "only the user's own claim is read");
  // No model writes this answer, so it quotes no claim and cites none.
  assert.deepEqual([result.blocks[0]?.source_refs, result.blocks[0]?.claim_refs, result.blocks[0]?.document_refs], [[], [], []]);
  assert.doesNotMatch(JSON.stringify(result.blocks[0]), /other-user seeded chat evidence/);
  const runtimeToolCallIds = result.blocks[0]?.tool_call_ids;
  assert.ok(Array.isArray(runtimeToolCallIds));
  assert.ok(runtimeToolCallIds.length > 0);
  assert.equal(runtimeToolCallIds.every((id) => typeof id === "string" && id.length > 0), true);

  const persisted = await persistAssistantMessage({
    message_id: "44444444-4444-4444-a444-444444444444",
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
    fact_refs: unknown;
    tool_call_ids: unknown;
  }>(
    `select claim_refs, document_refs, source_ids, fact_refs, tool_call_ids
       from snapshots
      where snapshot_id = $1::uuid`,
    [result.snapshot_id],
  )).rows;
  assert.equal(snapshotRows.length, 1);
  assert.deepEqual([snapshotRows[0]?.claim_refs, snapshotRows[0]?.document_refs, snapshotRows[0]?.source_ids, snapshotRows[0]?.fact_refs], [[], [], [], []]);
  const persistedToolCallIds = snapshotRows[0]?.tool_call_ids;
  assert.ok(Array.isArray(persistedToolCallIds));
  assert.ok(persistedToolCallIds.length > 0);
  assert.equal(persistedToolCallIds.every((id) => typeof id === "string" && id.length > 0), true);
  assert.deepEqual(persistedToolCallIds, runtimeToolCallIds);

  const messageRows = (await client.query<{ message_id: string }>(
    `select message_id::text as message_id
       from chat_messages
      where message_id = $1::uuid`,
    [persisted.message_id],
  )).rows;
  assert.equal(messageRows.length, 1);
  assert.equal(persisted.message_id, "44444444-4444-4444-a444-444444444444");

  const rerunBlocks = result.blocks.map((block) => ({ ...block, snapshot_id: "55555555-5555-4555-a555-555555555555" }));
  const again = await persistAssistantMessage({
    message_id: persisted.message_id,
    threadId: thread.thread_id,
    runId: RUN_ID,
    turnId: TURN_ID,
    role: "assistant",
    blocks: rerunBlocks,
    content_hash: contentHash(JSON.stringify(rerunBlocks)),
  });
  assert.equal(again.snapshot_id, persisted.snapshot_id);
  assert.equal(again.message_id, persisted.message_id);
  assert.equal((await client.query(`select 1 from chat_messages where thread_id = $1::uuid`, [thread.thread_id])).rows.length, 1);

  const toolRows = (await client.query<{ result_hash: string | null }>(
    `select result_hash
       from tool_call_logs
      where thread_id = $1::uuid`,
    [thread.thread_id],
  )).rows;
  assert.equal(toolRows.length, 1);
  assert.match(toolRows[0]?.result_hash ?? "", /^sha256:/);
});

test("an answer's seal takes no second connection while its transaction holds the first, so a full pool cannot stall it (#557)", {
  skip: !dockerAvailable(),
  timeout: 120_000,
}, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "chat-local-runtime-one-connection");
  const previousChatUrl = process.env.CHAT_DATABASE_URL;
  const previousStub = process.env.CHAT_LOCAL_TOOL_EXECUTOR;
  process.env.CHAT_DATABASE_URL = databaseUrl;
  delete process.env.CHAT_LOCAL_TOOL_EXECUTOR;
  registerLifoCleanup(t, async () => {
    await closeLocalRuntimePoolForTests();
    restoreEnv("CHAT_DATABASE_URL", previousChatUrl);
    restoreEnv("CHAT_LOCAL_TOOL_EXECUTOR", previousStub);
  });
  const client = await connectedClient(t, databaseUrl);
  await seedUser(client);
  const thread = await createThread(client, USER_ID, { title: "One connection" });
  await seedExistingEvidence(client, thread.thread_id, { userId: USER_ID, label: "owned" });
  const result = await analystToolRuntime({
    threadId: thread.thread_id,
    runId: RUN_ID,
    turnId: TURN_ID,
    userId: USER_ID,
    bundleId: "single_subject_analysis",
    userIntent: "Summarize demand",
    emit: (() => ({}) as never),
  });
  assert.ok((result.blocks[0]?.tool_call_ids as unknown[]).length > 0, "the seal reads the tool calls' results");

  // The seal's own pool, on a role Postgres lets hold one connection.
  // Roles are the cluster's, so each run has its own.
  const role = `chat_one_connection_${process.pid}_${Date.now()}`;
  await client.query(`create role ${role} login password 'one' connection limit 1`);
  registerLifoCleanup(t, async () => {
    await closeLocalRuntimePoolForTests();
    await client.query(`drop owned by ${role}`);
    await client.query(`drop role ${role}`);
  });
  await client.query(`grant all on all tables in schema public to ${role}`);
  await client.query(`grant all on all sequences in schema public to ${role}`);
  const oneConnection = new URL(databaseUrl);
  oneConnection.username = role;
  oneConnection.password = "one";
  await closeLocalRuntimePoolForTests();
  process.env.CHAT_DATABASE_URL = oneConnection.toString();

  const persisted = await persistAssistantMessage({
    message_id: "44444444-4444-4444-a444-444444444557",
    threadId: thread.thread_id,
    runId: RUN_ID,
    turnId: TURN_ID,
    role: "assistant",
    blocks: result.blocks,
    content_hash: contentHash(JSON.stringify(result.blocks)),
  });
  assert.deepEqual([persisted.message_id, persisted.snapshot_id], ["44444444-4444-4444-a444-444444444557", result.snapshot_id]);
});

test("a seal that would leave out a claim its blocks quote, with no way to render them without it, is refused (#557)", {
  skip: !dockerAvailable(),
  timeout: 120_000,
}, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "chat-local-runtime-seal-refused");
  const previousChatUrl = process.env.CHAT_DATABASE_URL;
  const previousStub = process.env.CHAT_LOCAL_TOOL_EXECUTOR;
  process.env.CHAT_DATABASE_URL = databaseUrl;
  delete process.env.CHAT_LOCAL_TOOL_EXECUTOR;
  registerLifoCleanup(t, async () => {
    await closeLocalRuntimePoolForTests();
    restoreEnv("CHAT_DATABASE_URL", previousChatUrl);
    restoreEnv("CHAT_LOCAL_TOOL_EXECUTOR", previousStub);
  });
  const client = await connectedClient(t, databaseUrl);
  await seedUser(client);
  const thread = await createThread(client, USER_ID, { title: "Seal refused" });
  const seeded = await seedExistingEvidence(client, thread.thread_id, { userId: USER_ID, label: "owned" });
  const result = await analystToolRuntime({
    threadId: thread.thread_id,
    runId: RUN_ID,
    turnId: TURN_ID,
    userId: USER_ID,
    bundleId: "single_subject_analysis",
    userIntent: "Summarize demand",
    emit: (() => ({}) as never),
  });
  const blocks = [{ ...result.blocks[0]!, claim_refs: [seeded.claimId], document_refs: [seeded.documentId], source_refs: [seeded.sourceId] }, ...result.blocks.slice(1)];

  const writer = await connectedClient(t, databaseUrl);
  await writer.query("begin");
  await writer.query(`update documents set deleted_at = now() where document_id = $1::uuid`, [seeded.documentId]);
  try {
    await assert.rejects(
      persistAssistantMessage({
        message_id: "44444444-4444-4444-a444-444444445557",
        threadId: thread.thread_id,
        runId: RUN_ID,
        turnId: TURN_ID,
        role: "assistant",
        blocks,
        content_hash: contentHash(JSON.stringify(blocks)),
      }),
      (error: unknown) => {
        assert.ok(error instanceof ChatSnapshotSealError);
        assert.deepEqual(error.failures, [{ reason_code: "missing_claim_ref", details: { withdrawn: [], unchecked: [seeded.claimId] } }]);
        return true;
      },
    );
  } finally {
    await writer.query("rollback");
  }
  const { rows } = await client.query(`select 1 from chat_messages where thread_id = $1::uuid and role = 'assistant'`, [thread.thread_id]);
  assert.equal(rows.length, 0, "no message is saved");
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

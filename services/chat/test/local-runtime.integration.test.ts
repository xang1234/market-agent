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
import { createFact } from "../../evidence/src/fact-repo.ts";
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
  const runtimeToolCallIds = result.blocks[0]?.tool_call_ids;
  assert.ok(Array.isArray(runtimeToolCallIds));
  assert.ok(runtimeToolCallIds.length > 0);
  assert.equal(runtimeToolCallIds.every((id) => typeof id === "string" && id.length > 0), true);

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

  const toolRows = (await client.query<{ result_hash: string | null }>(
    `select result_hash
       from tool_call_logs
      where thread_id = $1::uuid`,
    [thread.thread_id],
  )).rows;
  assert.equal(toolRows.length, 1);
  assert.match(toolRows[0]?.result_hash ?? "", /^sha256:/);
});

test("chat snapshot cites fundamentals fact_refs and their source for a resolved issuer", {
  skip: !dockerAvailable(),
  timeout: 120_000,
}, async (t) => {
  const ISSUER_ID = "40000000-0000-4000-8000-000000000004";
  const { databaseUrl } = await bootstrapDatabase(t, "chat-provenance");
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
  const thread = await createThread(client, USER_ID, { title: "Provenance" });

  // Public source (user_id null) + revenue metric + one authoritative app-entitled FY fact.
  const sourceId = (await client.query<{ source_id: string }>(
    `insert into sources (provider, kind, trust_tier, license_class, retrieved_at)
     values ('test', 'filing', 'primary', 'test', now())
     returning source_id::text as source_id`,
  )).rows[0].source_id;
  const metricId = (await client.query<{ metric_id: string }>(
    `insert into metrics (metric_key, display_name, unit_class, aggregation, interpretation, canonical_source_class)
     values ('revenue', 'Revenue', 'currency', 'sum', 'higher_is_better', 'gaap')
     returning metric_id::text as metric_id`,
  )).rows[0].metric_id;
  const fact = await createFact(client, {
    subject_kind: "issuer",
    subject_id: ISSUER_ID,
    metric_id: metricId,
    period_kind: "fiscal_y",
    fiscal_year: 2024,
    fiscal_period: "FY",
    value_num: 100,
    unit: "currency",
    currency: "USD",
    as_of: "2026-05-08T00:00:00.000Z",
    observed_at: "2026-05-08T00:00:00.000Z",
    source_id: sourceId,
    method: "reported",
    verification_status: "authoritative",
    freshness_class: "filing_time",
    coverage_level: "full",
    entitlement_channels: ["app"],
    confidence: 1,
  });
  const factId = fact.fact_id;

  // Minimal resolved handoff so structuredRefsFromHandoff yields the issuer
  // (handoff.subject_ref.kind === "issuer"); no listings → no quote.
  const issuerRef = { kind: "issuer" as const, id: ISSUER_ID };
  const result = await analystToolRuntime({
    threadId: thread.thread_id,
    runId: RUN_ID,
    turnId: TURN_ID,
    userId: USER_ID,
    bundleId: "single_subject_analysis",
    userIntent: "Summarize revenue",
    emit: (() => ({}) as never),
    subjectPreResolution: {
      status: "resolved",
      subject_ref: issuerRef,
      handoff: { subject_ref: issuerRef, context: {} },
    } as never,
  });

  // The answer's blocks carry the fundamentals fact as provenance + its source.
  assert.ok((result.blocks[0]?.provenance_fact_refs as unknown[]).includes(factId));
  assert.ok((result.blocks[0]?.source_refs as unknown[]).includes(sourceId));

  const persisted = await persistAssistantMessage({
    threadId: thread.thread_id,
    runId: RUN_ID,
    turnId: TURN_ID,
    role: "assistant",
    blocks: result.blocks,
    content_hash: contentHash(JSON.stringify(result.blocks)),
  });
  // Seal verified (no throw) and the manifest carries the provenance.
  assert.equal(persisted.snapshot_id, result.snapshot_id);

  const snap = (await client.query<{ fact_refs: unknown; source_ids: unknown }>(
    `select fact_refs, source_ids from snapshots where snapshot_id = $1::uuid`,
    [result.snapshot_id],
  )).rows[0];
  assert.deepEqual(snap?.fact_refs, [factId]);
  assert.ok((snap?.source_ids as string[]).includes(sourceId));
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

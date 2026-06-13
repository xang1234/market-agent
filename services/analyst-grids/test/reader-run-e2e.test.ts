import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { bootstrapDatabase, connectedPool } from "../../../db/test/docker-pg.ts";
import { createGrid, getRunDetail } from "../src/queries.ts";
import { startGridRun } from "../src/run-engine.ts";
import { createUniverseResolverDeps } from "../src/universe-wiring.ts";
import type { QueryExecutor } from "../src/types.ts";
import type { ReaderColumnDeps } from "../src/column-catalog.ts";

// ─── Shared polling helper (mirrors run-engine.test.ts) ──────────────────────
async function poll<T>(fn: () => Promise<T>, until: (v: T) => boolean, tries = 120): Promise<T> {
  for (let i = 0; i < tries; i++) {
    const v = await fn();
    if (until(v)) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("poll timed out");
}

// ─── Scenario A — sealed claim-backed cell end-to-end ────────────────────────
test("Scenario A: reader_question column produces a sealed claim-backed cell", async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "reader-run-e2e-a");
  const pool = await connectedPool(t, databaseUrl);
  const db = pool as unknown as QueryExecutor;

  // Fixed IDs
  const userId = randomUUID();
  const sourceId = randomUUID();
  const issuerId = randomUUID();

  // Seed: user
  await pool.query(
    `insert into users (user_id, email, display_name) values ($1, $2, 'Test User') on conflict (user_id) do nothing`,
    [userId, `${userId}@test.example`],
  );

  // Seed: source (filing, public, primary, no user_id → public)
  await pool.query(
    `insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at)
     values ($1, 'SEC EDGAR', 'filing', 'primary', 'public', now())`,
    [sourceId],
  );

  // Seed: issuer
  await pool.query(
    `insert into issuers (issuer_id, legal_name) values ($1, 'Test Issuer X')`,
    [issuerId],
  );

  // Seed: document
  const rawBlobId = "sha256:" + "a".repeat(64);
  const contentHash = "hash-reader-e2e-" + randomUUID();
  const docResult = await pool.query<{ document_id: string }>(
    `insert into documents (source_id, kind, published_at, raw_blob_id, content_hash)
     values ($1, 'filing', now() - interval '7 days', $2, $3)
     returning document_id::text as document_id`,
    [sourceId, rawBlobId, contentHash],
  );
  const documentId = docResult.rows[0].document_id;

  // Seed: mention binding document → issuer
  await pool.query(
    `insert into mentions (document_id, subject_kind, subject_id, prominence, mention_count, confidence)
     values ($1, 'issuer', $2, 'body', 1, 0.9)`,
    [documentId, issuerId],
  );

  // Create grid
  const grid = await createGrid(db, userId, {
    name: "e2e reader test",
    description: null,
    universe_spec: {
      source: "manual",
      subject_refs: [{ kind: "issuer", id: issuerId }],
    },
    column_specs: [
      {
        column_key: "reader_question",
        params: { prompt: "Any China exposure flagged in risk factors?" },
      },
    ],
  });

  // Fake reader deps
  const filingText = "Item 1A. Risk Factors: The Company faces tariff exposure from Chinese operations.";
  const fakeReader: ReaderColumnDeps = {
    loadDocumentText: async (blobId: string) => {
      if (blobId === rawBlobId) return filingText;
      return null;
    },
    llm: {
      complete: async (_request) => {
        const response = JSON.stringify({
          answer: "Yes — tariff exposure flagged in Item 1A.",
          claims: [
            {
              document_id: documentId,
              predicate: "china_tariff_exposure",
              text_canonical: "The Company faces tariff exposure from Chinese operations.",
              polarity: "negative",
              modality: "asserted",
              confidence: 0.85,
            },
          ],
          not_discussed: false,
        });
        return { text: response };
      },
    },
  };

  // Drive startGridRun
  const universe = createUniverseResolverDeps(db);
  const { runId } = await startGridRun(
    { db, pool, universe, reader: fakeReader },
    { gridId: grid.grid_id, userId, asOf: new Date().toISOString() },
  );

  // Poll until terminal
  const detail = await poll(
    () => getRunDetail(db, runId),
    (d) => ["completed", "partial", "failed"].includes(d.run.status),
  );

  // 1. run status === "completed"
  assert.equal(detail.run.status, "completed", `run failed: ${JSON.stringify(detail.run)}`);

  // 2. single cell assertions
  assert.equal(detail.cells.length, 1);
  const cell = detail.cells[0];
  assert.equal(cell.status, "ok", `cell status: ${cell.status}`);
  assert.equal(cell.display?.value, "Yes — tariff exposure flagged in Item 1A.");
  assert.equal(cell.primary_ref?.kind, "claim");
  assert.ok(cell.snapshot_id, "cell must carry a sealed snapshot_id");

  // 3. snapshots row — claim_refs and tool_call_ids
  const snapRes = await pool.query<{
    claim_refs: string;
    tool_call_ids: string;
    tool_call_result_hashes: string;
  }>(
    `select claim_refs::text as claim_refs,
            tool_call_ids::text as tool_call_ids,
            tool_call_result_hashes::text as tool_call_result_hashes
       from snapshots where snapshot_id = $1`,
    [cell.snapshot_id],
  );
  assert.equal(snapRes.rows.length, 1, "snapshot row must exist");
  const snapRow = snapRes.rows[0];

  const claimRefs: string[] = JSON.parse(snapRow.claim_refs);
  assert.ok(claimRefs.length > 0, "snapshot must have at least one claim_ref");
  // The claim referenced by the cell must appear in the snapshot
  assert.ok(
    claimRefs.includes(cell.primary_ref!.id),
    `snapshot.claim_refs must include cell's claim id (${cell.primary_ref!.id})`,
  );

  const toolCallIds: string[] = JSON.parse(snapRow.tool_call_ids);
  assert.ok(toolCallIds.length > 0, "snapshot must have at least one tool_call_id");

  // 4. tool_call_logs row
  const tclRes = await pool.query<{
    tool_call_id: string;
    tool_name: string;
    result_hash: string;
  }>(
    `select tool_call_id::text as tool_call_id, tool_name, result_hash
       from tool_call_logs where tool_call_id = $1`,
    [toolCallIds[0]],
  );
  assert.equal(tclRes.rows.length, 1, "tool_call_logs row must exist");
  const tcl = tclRes.rows[0];
  assert.equal(tcl.tool_name, "grid_reader_question");
  assert.match(
    tcl.result_hash,
    /^sha256:[0-9a-f]{64}$/,
    `result_hash must be sha256:<64hex>, got: ${tcl.result_hash}`,
  );

  // Verify the audit actually passed: result_hash in tool_call_logs must match
  // what the snapshot's tool_call_result_hashes references.
  const tcrh: Array<{ tool_call_id: string; result_hash: string }> = JSON.parse(
    snapRow.tool_call_result_hashes,
  );
  const snapshotHash = tcrh.find((e) => e.tool_call_id === toolCallIds[0])?.result_hash;
  assert.equal(
    snapshotHash,
    tcl.result_hash,
    "snapshot's tool_call_result_hashes must match the tool_call_logs row's result_hash",
  );

  // 5. claims row
  const claimRes = await pool.query<{
    claim_id: string;
    status: string;
    document_id: string;
    reported_by_source_id: string;
  }>(
    `select claim_id::text as claim_id, status, document_id::text as document_id,
            reported_by_source_id::text as reported_by_source_id
       from claims where claim_id = $1`,
    [cell.primary_ref!.id],
  );
  assert.equal(claimRes.rows.length, 1, "claims row must exist");
  const claim = claimRes.rows[0];
  assert.equal(claim.status, "extracted");
  assert.equal(claim.document_id, documentId);
  assert.equal(claim.reported_by_source_id, sourceId);
});

// ─── Scenario B — honest no-coverage ─────────────────────────────────────────
test("Scenario B: reader_question column returns no_coverage when issuer has no documents", async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "reader-run-e2e-b");
  const pool = await connectedPool(t, databaseUrl);
  const db = pool as unknown as QueryExecutor;

  const userId = randomUUID();
  const issuerY = randomUUID();

  // Seed: user + issuer Y (no documents)
  await pool.query(
    `insert into users (user_id, email, display_name) values ($1, $2, 'User B') on conflict (user_id) do nothing`,
    [userId, `${userId}@test.example`],
  );
  await pool.query(
    `insert into issuers (issuer_id, legal_name) values ($1, 'Issuer Y — no docs')`,
    [issuerY],
  );

  // Create grid
  const grid = await createGrid(db, userId, {
    name: "no-coverage test",
    description: null,
    universe_spec: {
      source: "manual",
      subject_refs: [{ kind: "issuer", id: issuerY }],
    },
    column_specs: [
      {
        column_key: "reader_question",
        params: { prompt: "Any China exposure flagged in risk factors?" },
      },
    ],
  });

  // Fake reader deps — should never be called, but we need them
  const fakeReader: ReaderColumnDeps = {
    loadDocumentText: async (_blobId) => null,
    llm: {
      complete: async (_request) => {
        throw new Error("llm.complete should not be called when there are no documents");
      },
    },
  };

  const universe = createUniverseResolverDeps(db);
  const { runId } = await startGridRun(
    { db, pool, universe, reader: fakeReader },
    { gridId: grid.grid_id, userId, asOf: new Date().toISOString() },
  );

  // Poll until terminal
  const detail = await poll(
    () => getRunDetail(db, runId),
    (d) => ["completed", "partial", "failed"].includes(d.run.status),
  );

  assert.equal(detail.run.status, "completed", `run failed: ${JSON.stringify(detail.run)}`);
  assert.equal(detail.cells.length, 1);
  const cell = detail.cells[0];
  assert.equal(cell.status, "no_coverage");
  assert.equal(cell.coverage_flag, "no_documents");
  assert.equal(cell.snapshot_id, null, "no_coverage cell must not have a snapshot_id");
});

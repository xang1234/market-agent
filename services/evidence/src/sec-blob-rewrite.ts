// One-off rewrite of stored filing blobs to what ingest now stores (#757): each
// EDGAR submission without its uuencoded bodies (sec-submission-strip.ts).
// A document keeps its content_hash, which names SEC's bytes and which
// attestations and campaign quotes cite. Its raw_blob_id moves to the stripped
// bytes, raw_blob_transform records how they were made, and the blob it
// replaced is queued for deletion in the same transaction.
//
// A document cited by an offset into text read from its whole blob (a 10-K
// item, a campaign quote) keeps its blob, since the removed lines would shift
// the offset. An exhibit locator indexes one EX-99 document, which stripping
// leaves byte for byte, so it does not hold a blob back.
//
// Idempotent and resumable: a rewritten document leaves the candidate set, so
// a rerun reads only what is left, and drains deletions a crash left queued.
import { runObjectBlobGcBatchWithPool, type ObjectBlobGcClientPool } from "./blob-gc-repo.ts";
import { deleteBlobIfUnnamed } from "./ingest.ts";
import { rawBlobIdFromBytes, type ObjectStore } from "./object-store.ts";
import { SEC_UUENCODED_BODIES_REMOVED, stripUuencodedBodies } from "./sec-submission-strip.ts";
import { withTransaction } from "./transaction.ts";
import type { QueryExecutor } from "./types.ts";

export type BlobRewriteOutcome = "stripped" | "cited" | "verbatim" | "missing" | "raced" | "failed";

export type FormTally = Record<BlobRewriteOutcome, number> & { documents: number; bytes_before: number; bytes_after: number };

export type BlobRewriteReport = {
  forms: Record<string, FormTally>;
  // The last document read, for --after.
  cursor: string | null;
  blobs_deleted: number;
  blob_deletes_failed: number;
};

type Candidate = { document_id: string; form: string; content_hash: string; raw_blob_id: string; cited: boolean };

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

// Offsets into text read from the whole blob, which stripping would shift.
// ponytail: claim_evidence has no document_id index, so each check scans it;
// fine for a one-off pass, add the index if this ever runs on a schedule.
const CITED_BY_OFFSET = `(exists (select 1 from claim_evidence ce where ce.document_id = d.document_id and not (ce.locator ? 'exhibit'))
    or exists (select 1 from discovery_quote_claims q where q.document_id = d.document_id))`;

export async function rewriteFilingBlobs(
  deps: { db: QueryExecutor & ObjectBlobGcClientPool; objectStore: ObjectStore },
  opts: { dryRun: boolean; after?: string; pageSize?: number; onDocument?: (candidate: Candidate, outcome: BlobRewriteOutcome, error?: unknown) => void },
): Promise<BlobRewriteReport> {
  const report: BlobRewriteReport = { forms: {}, cursor: null, blobs_deleted: 0, blob_deletes_failed: 0 };
  // Queued blobs this run tried and kept (still named, or the delete failed).
  const tried = new Set<string>();
  if (!opts.dryRun) await drainDeletions(deps, report, tried);
  let cursor = opts.after ?? ZERO_UUID;
  for (;;) {
    const { rows: page } = await deps.db.query<Candidate>(
      `select d.document_id::text as document_id, coalesce(d.title, 'untitled') as form, d.content_hash, d.raw_blob_id, ${CITED_BY_OFFSET} as cited
         from documents d
        where d.kind = 'filing' and d.raw_blob_transform is null and d.raw_blob_id like 'sha256:%' and d.document_id > $1::uuid
        order by d.document_id
        limit $2`,
      [cursor, opts.pageSize ?? 50],
    );
    if (page.length === 0) break;
    for (const candidate of page) {
      cursor = candidate.document_id;
      const tally = (report.forms[candidate.form] ??= { documents: 0, stripped: 0, cited: 0, verbatim: 0, missing: 0, raced: 0, failed: 0, bytes_before: 0, bytes_after: 0 });
      tally.documents += 1;
      try {
        const { outcome, before, after, queued } = await rewriteOne(deps, candidate, opts.dryRun);
        // Queued just now, so the next drain tries it even if an earlier one did.
        if (queued !== undefined) tried.delete(queued);
        tally[outcome] += 1;
        tally.bytes_before += before;
        tally.bytes_after += after;
        opts.onDocument?.(candidate, outcome);
      } catch (error) {
        tally.failed += 1;
        opts.onDocument?.(candidate, "failed", error);
      }
    }
    report.cursor = cursor;
    if (!opts.dryRun) await drainDeletions(deps, report, tried);
  }
  return report;
}

async function rewriteOne(
  deps: { db: QueryExecutor; objectStore: ObjectStore },
  candidate: Candidate,
  dryRun: boolean,
): Promise<{ outcome: BlobRewriteOutcome; before: number; after: number; queued?: string }> {
  const blob = await deps.objectStore.get(candidate.raw_blob_id);
  if (blob === null) return { outcome: "missing", before: 0, after: 0 };
  const before = blob.bytes.length;
  const stripped = stripUuencodedBodies(blob.bytes);
  if (stripped === null) return { outcome: "verbatim", before, after: before };
  if (candidate.cited) return { outcome: "cited", before, after: before };
  if (dryRun) return { outcome: "stripped", before, after: stripped.length };

  const strippedId = rawBlobIdFromBytes(stripped);
  const moved = await withTransaction(deps.db, async (tx) => {
    // Lock, then put, as ingest does. A GC batch deletes the blob only under
    // this lock and only once no document names it, so it cannot delete the
    // copy between this put and the update that names it.
    await tx.db.query("select pg_advisory_xact_lock(hashtext($1))", [strippedId]);
    const put = await deps.objectStore.put(stripped);
    if (put.status === "created") tx.onRollback((error) => deleteBlobIfUnnamed(tx.db, deps.objectStore, put.blob.raw_blob_id, error));
    return moveToStripped(tx.db, candidate, strippedId, put.blob.raw_blob_id);
  });
  return moved
    ? { outcome: "stripped", before, after: stripped.length, queued: candidate.raw_blob_id }
    : { outcome: "raced", before, after: before, queued: strippedId };
}

// Names the stripped copy and queues the blob no document now names: SEC's
// bytes, or the stripped copy when the document changed under this run.
async function moveToStripped(db: QueryExecutor, candidate: Candidate, strippedId: string, storedId: string): Promise<boolean> {
  if (storedId !== strippedId) throw new Error("object store returned a blob id that does not match the stripped bytes");
  const update = await db.query(
    `update documents d
        set raw_blob_id = $3, raw_blob_transform = $4, updated_at = now()
      where d.document_id = $1::uuid and d.raw_blob_id = $2 and d.raw_blob_transform is null
        and not ${CITED_BY_OFFSET}
        and not exists (select 1 from documents o where o.content_hash = d.content_hash and o.raw_blob_id = $3)`,
    [candidate.document_id, candidate.raw_blob_id, strippedId, SEC_UUENCODED_BODIES_REMOVED],
  );
  const moved = update.rowCount === 1;
  await db.query(
    `insert into object_blob_gc_queue (raw_blob_id, reason) values ($1, 'blob_rewrite')
     on conflict (raw_blob_id) do update
           set next_attempt_at = now(), deleted_at = null, last_checked_at = null, last_error = null, updated_at = now()`,
    [moved ? candidate.raw_blob_id : strippedId],
  );
  return moved;
}

// Deletes every queued blob that is due and unreferenced, trying each at most
// once per run. A blob still named, or whose delete failed, waits out the GC's
// backoff and is left to a later run; a batch with nothing due ends the drain.
async function drainDeletions(
  deps: { db: ObjectBlobGcClientPool; objectStore: ObjectStore },
  report: BlobRewriteReport,
  tried: Set<string>,
): Promise<void> {
  for (;;) {
    const batch = await runObjectBlobGcBatchWithPool(deps.db, deps.objectStore, { skipRawBlobIds: [...tried] });
    report.blobs_deleted += batch.deleted_raw_blob_ids.length;
    report.blob_deletes_failed += batch.failed_raw_blob_ids.length;
    for (const id of [...batch.skipped_referenced_raw_blob_ids, ...batch.failed_raw_blob_ids]) tried.add(id);
    if (batch.deleted_raw_blob_ids.length + batch.skipped_referenced_raw_blob_ids.length + batch.failed_raw_blob_ids.length === 0) return;
  }
}

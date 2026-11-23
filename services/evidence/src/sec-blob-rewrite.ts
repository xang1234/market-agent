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
  if (!opts.dryRun) await drainDeletions(deps, report);
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
        const { outcome, before, after } = await rewriteOne(deps, candidate, opts.dryRun);
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
    if (!opts.dryRun) await drainDeletions(deps, report);
  }
  return report;
}

async function rewriteOne(
  deps: { db: QueryExecutor; objectStore: ObjectStore },
  candidate: Candidate,
  dryRun: boolean,
): Promise<{ outcome: BlobRewriteOutcome; before: number; after: number }> {
  const blob = await deps.objectStore.get(candidate.raw_blob_id);
  if (blob === null) return { outcome: "missing", before: 0, after: 0 };
  const before = blob.bytes.length;
  const stripped = stripUuencodedBodies(blob.bytes);
  if (stripped === null) return { outcome: "verbatim", before, after: before };
  if (candidate.cited) return { outcome: "cited", before, after: before };
  if (dryRun) return { outcome: "stripped", before, after: stripped.length };

  // Put first: a crash before the update leaves an unreferenced blob that a
  // rerun puts again, never a document naming bytes that are not stored.
  const { blob: { raw_blob_id: strippedId } } = await deps.objectStore.put(stripped);
  if (strippedId !== rawBlobIdFromBytes(stripped)) throw new Error("object store returned a blob id that does not match the stripped bytes");
  const moved = await withTransaction(deps.db, async (tx) => {
    await tx.db.query("select pg_advisory_xact_lock(hashtext($1))", [strippedId]);
    const update = await tx.db.query(
      `update documents d
          set raw_blob_id = $3, raw_blob_transform = $4, updated_at = now()
        where d.document_id = $1::uuid and d.raw_blob_id = $2 and d.raw_blob_transform is null
          and not ${CITED_BY_OFFSET}
          and not exists (select 1 from documents o where o.content_hash = d.content_hash and o.raw_blob_id = $3)`,
      [candidate.document_id, candidate.raw_blob_id, strippedId, SEC_UUENCODED_BODIES_REMOVED],
    );
    const moved = update.rowCount === 1;
    // The blob no document now names: SEC's bytes, or the stripped copy when
    // the document changed under this run. Deleted only once unreferenced.
    await tx.db.query(
      `insert into object_blob_gc_queue (raw_blob_id, reason) values ($1, 'blob_rewrite')
       on conflict (raw_blob_id) do update
             set next_attempt_at = now(), deleted_at = null, last_checked_at = null, last_error = null, updated_at = now()`,
      [moved ? candidate.raw_blob_id : strippedId],
    );
    return moved;
  });
  return moved ? { outcome: "stripped", before, after: stripped.length } : { outcome: "raced", before, after: before };
}

// Deletes every queued blob that is due and unreferenced. A delete that fails
// is due again at once, so the next run retries it; a batch that deletes
// nothing ends the drain.
async function drainDeletions(
  deps: { db: ObjectBlobGcClientPool; objectStore: ObjectStore },
  report: BlobRewriteReport,
): Promise<void> {
  for (;;) {
    const batch = await runObjectBlobGcBatchWithPool(deps.db, deps.objectStore, { failureRetryAfterMs: 0 });
    report.blobs_deleted += batch.deleted_raw_blob_ids.length;
    report.blob_deletes_failed += batch.failed_raw_blob_ids.length;
    if (batch.deleted_raw_blob_ids.length === 0) return;
  }
}

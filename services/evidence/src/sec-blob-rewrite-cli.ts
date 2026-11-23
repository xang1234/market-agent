// Rewrite stored filing blobs without their uuencoded attachments (#757,
// sec-blob-rewrite.ts). No SEC request and no model call.
//
//   DATABASE_URL=... S3_* =... npm run rewrite:sec-blobs -- --dry-run
//   DATABASE_URL=... S3_* =... npm run rewrite:sec-blobs [-- --after <document_id>]
//
// --dry-run reads every stored filing and reports, per form, what the rewrite
// would save, writing nothing. Without it each stripped blob replaces SEC's
// copy and the copy is deleted. Idempotent: a rerun reads only filings not yet
// rewritten, and finishes deletions an earlier run left. --after skips the
// filings up to a cursor a progress line printed. Run it while no discovery
// campaign is running: a campaign quotes offsets into the text it loaded.
// Exits non-zero when any filing failed, so a rerun reads it again.
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createEvidenceStoreRuntime } from "./evidence-cli-runtime.ts";
import { rewriteFilingBlobs, type BlobRewriteReport } from "./sec-blob-rewrite.ts";

const MB = 1024 * 1024;

function reportLines(report: BlobRewriteReport): string[] {
  const forms = Object.entries(report.forms).sort(([a], [b]) => a.localeCompare(b));
  const total = forms.reduce((sum, [, tally]) => ({ before: sum.before + tally.bytes_before, after: sum.after + tally.bytes_after }), { before: 0, after: 0 });
  const mb = (bytes: number) => (bytes / MB).toFixed(1);
  return [
    "form\tdocuments\tstripped\tcited\tverbatim\tmissing\traced\tfailed\tMB before\tMB after\tMB saved",
    ...forms.map(([form, t]) =>
      [form, t.documents, t.stripped, t.cited, t.verbatim, t.missing, t.raced, t.failed, mb(t.bytes_before), mb(t.bytes_after), mb(t.bytes_before - t.bytes_after)].join("\t")),
    `total\t\t\t\t\t\t\t\t${mb(total.before)}\t${mb(total.after)}\t${mb(total.before - total.after)}`,
    `blobs deleted ${report.blobs_deleted}, delete failures ${report.blob_deletes_failed}, cursor ${report.cursor ?? "none"}`,
  ];
}

async function main(): Promise<void> {
  const { values: flags } = parseArgs({ options: { "dry-run": { type: "boolean" }, after: { type: "string" } } });
  const { db, objectStore } = createEvidenceStoreRuntime();
  let read = 0;
  try {
    const report = await rewriteFilingBlobs({ db, objectStore }, {
      dryRun: flags["dry-run"] === true,
      after: flags.after,
      onDocument: (candidate, outcome, error) => {
        if (error !== undefined) console.error(`${candidate.document_id} ${candidate.form}: failed:`, error instanceof Error ? error.message : error);
        if (++read % 500 === 0) console.log(`progress: ${read} read, cursor ${candidate.document_id}`);
      },
    });
    console.log(`${flags["dry-run"] ? "dry run, nothing written" : "rewrite"}: ${read} filings read`);
    for (const line of reportLines(report)) console.log(line);
    if (Object.values(report.forms).some((tally) => tally.failed > 0) || report.blob_deletes_failed > 0) process.exitCode = 1;
  } finally {
    await db.end();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

// Read the non-GAAP reconciliations of stored earnings releases
// (sec-non-gaap-reconciliations.ts) from their stored bytes: no SEC request
// and no model call.
//
//   DATABASE_URL=... S3_* =... npm run extract:non-gaap
//
// Idempotent: each release read keeps its row, so a rerun reads only new ones.
// Exits non-zero when any release failed, so it is read again next run.
import { createEvidenceCliRuntime } from "./evidence-cli-runtime.ts";
import { runReconciliationDrain } from "./sec-non-gaap-reconciliations.ts";

async function main(): Promise<void> {
  const { db, objectStore } = createEvidenceCliRuntime();
  try {
    const result = await runReconciliationDrain({ db, objectStore }, {
      onRelease: (candidate, outcome) => {
        const name = candidate.accession ?? candidate.documentId;
        if (typeof outcome === "object") console.error(`${name}: failed:`, outcome.error instanceof Error ? outcome.error.message : outcome.error);
        else console.log(`${name}: ${outcome}`);
      },
    });
    console.log(`done: ${result.read} read, ${result.undated} undated, ${result.no_bytes} without stored bytes, ${result.noop} already read, ${result.failed} failed`);
    if (result.failed > 0) process.exitCode = 1;
  } finally {
    await db.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

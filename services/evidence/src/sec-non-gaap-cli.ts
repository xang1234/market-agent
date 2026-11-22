// Read the non-GAAP reconciliations of stored earnings releases
// (sec-non-gaap-reconciliations.ts) from their stored bytes: no SEC request
// and no model call.
//
//   DATABASE_URL=... S3_* =... npm run extract:non-gaap [-- --reread]
//
// Idempotent: each release read keeps its row, so a rerun reads only new ones.
// --reread first deletes every row, which the stored bytes rebuild, so a
// reader fix reaches releases read before it. Exits non-zero when any release
// failed, so it is read again next run.
import { parseArgs } from "node:util";
import { createEvidenceStoreRuntime } from "./evidence-cli-runtime.ts";
import { runReconciliationDrain } from "./sec-non-gaap-reconciliations.ts";

async function main(): Promise<void> {
  const { values: flags } = parseArgs({ options: { reread: { type: "boolean" } } });
  const { db, objectStore } = createEvidenceStoreRuntime();
  try {
    if (flags.reread) console.log(`reread: ${(await db.query("delete from non_gaap_reconciliations")).rowCount ?? 0} releases to read again`);
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

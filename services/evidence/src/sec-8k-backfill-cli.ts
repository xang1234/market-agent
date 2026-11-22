// Backfill recent 8-K material events for issuers.
//
//   DATABASE_URL=... SEC_EDGAR_USER_AGENT=... S3_* =... \
//     npm run backfill:sec-8k [-- [--since-days N] [--tracked] <issuer_uuid> ...]
//
// With no issuer ids, backfills every issuer that has a CIK; --tracked narrows
// that to issuers with an 8-K already stored, as the daily run does.
// --since-days sets how far back to look (default 180). 8-K ingestion is
// atomic per filing (document + mention + per-item events + material-event
// claims), so a rerun is idempotent: accessions already stored are skipped.

import { parseArgs } from "node:util";
import { createEvidenceCliRuntime } from "./evidence-cli-runtime.ts";
import { backfillIssuer8k } from "./sec-8k-backfill.ts";

async function main(): Promise<void> {
  const { values: flags, positionals: requestedIds } = parseArgs({
    allowPositionals: true,
    options: { "since-days": { type: "string" }, tracked: { type: "boolean" } },
  });
  const sinceDays = flags["since-days"] === undefined ? undefined : Number(flags["since-days"]);
  if (sinceDays !== undefined && !(Number.isInteger(sinceDays) && sinceDays > 0)) throw new Error("--since-days takes a whole number of days");
  if (flags.tracked && requestedIds.length) throw new Error("--tracked takes no issuer ids");
  const { db: pool, objectStore, secClient } = createEvidenceCliRuntime();
  let hadFailures = false;
  try {
    const issuers = requestedIds.length
      ? await pool.query<{ issuer_id: string; legal_name: string; cik: string | null }>(
          `select issuer_id::text as issuer_id, legal_name, cik from issuers where issuer_id = any($1::uuid[])`,
          [requestedIds],
        )
      : await pool.query<{ issuer_id: string; legal_name: string; cik: string | null }>(
          `select issuer_id::text as issuer_id, legal_name, cik from issuers i
            where cik is not null
              and (not $1 or exists (
                select 1 from mentions m join documents d on d.document_id = m.document_id
                 where m.subject_kind = 'issuer' and m.subject_id = i.issuer_id
                   and d.kind = 'filing' and d.title in ('8-K', '8-K/A')))
            order by legal_name`,
          [flags.tracked === true],
        );

    for (const issuer of issuers.rows) {
      const cik = Number(issuer.cik);
      if (!Number.isInteger(cik) || cik <= 0) {
        console.log(`skip ${issuer.legal_name}: no usable CIK (${issuer.cik})`);
        continue;
      }
      try {
        const result = await backfillIssuer8k({ db: pool, objectStore, secClient }, { cik, sinceDays });
        console.log(
          `${issuer.legal_name}: ingested ${result.ingested} 8-K filing(s), skipped ${result.skipped} already present`,
        );
      } catch (error) {
        hadFailures = true;
        console.error(
          `${issuer.legal_name}: 8-K backfill failed —`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  } finally {
    await pool.end();
  }
  // Per-issuer failures are logged and the loop continues, but automation must
  // still see a non-zero exit when any issuer failed.
  if (hadFailures) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

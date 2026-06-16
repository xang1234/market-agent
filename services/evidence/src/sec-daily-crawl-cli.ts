// One-shot daily EDGAR crawl entrypoint (designed for external-cron invocation).
//
//   DATABASE_URL=... SEC_EDGAR_USER_AGENT=... S3_BUCKET=... S3_REGION=... \
//     npm run crawl:sec-daily [-- --date YYYY-MM-DD]
//
// With no --date flag, crawls yesterday's or today's UTC date (whatever `now`
// resolves to). Form handlers (Form 4, 8-K, 13F, …) are registered in
// FORM_HANDLERS (Form 4 registered below; 8-K / 13F in later slices).

import { createEvidenceCliRuntime } from "./evidence-cli-runtime.ts";
import { crawlDailyFilings, type FormHandler } from "./sec-daily-crawl.ts";
import { handleForm4 } from "./sec-form4-handler.ts";
import { handle8k } from "./sec-8k-handler.ts";

// ---------------------------------------------------------------------------
// Exported so tests can import and exercise argv parsing without touching
// the DB or network.
// ---------------------------------------------------------------------------

export function resolveCrawlDate(argv: string[], now: () => Date = () => new Date()): Date {
  const idx = argv.indexOf("--date");
  if (idx === -1) return now();
  const value = argv[idx + 1];
  if (value === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(
      `--date requires a YYYY-MM-DD value; received ${value === undefined ? "no value" : JSON.stringify(value)}`,
    );
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`--date is not a valid calendar date: ${value}`);
  }
  return date;
}

// Form handlers. Form 4 + 8-K are registered; 13F lands in a later slice.
export const FORM_HANDLERS: Record<string, FormHandler> = {
  "4": handleForm4,
  "4/A": handleForm4,
  "8-K": handle8k,
  "8-K/A": handle8k,
};

// ---------------------------------------------------------------------------
// main — only runs when this module is the process entrypoint (not under test)
// ---------------------------------------------------------------------------

async function main(argv: string[]): Promise<void> {
  const date = resolveCrawlDate(argv);
  const { db, objectStore, secClient } = createEvidenceCliRuntime();
  try {
    const result = await crawlDailyFilings(
      { db, client: secClient, objectStore },
      { date, handlers: FORM_HANDLERS },
    );
    console.log(JSON.stringify({ date: date.toISOString().slice(0, 10), result }));
    // A degraded run must signal the external scheduler (non-zero exit) so a
    // parser/persistence bug isn't masked by a "successful" cron job.
    const degraded = Object.entries(result.byForm)
      .filter(([, outcome]) => outcome.status !== "succeeded")
      .map(([form]) => form);
    if (degraded.length > 0) {
      console.error(`[sec-daily-crawl] non-succeeded forms: ${degraded.join(", ")}`);
      process.exitCode = 1;
    }
  } finally {
    await db.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

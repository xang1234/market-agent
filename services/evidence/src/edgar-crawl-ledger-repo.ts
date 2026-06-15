import type { QueryExecutor } from "./types.ts";

export type RecordCrawlBatchInput = {
  form: string;
  indexDate: string; // ISO date (YYYY-MM-DD)
  status: "succeeded" | "partial" | "failed";
  filingsTotal: number;
  filingsIngested: number;
  filingsSkipped: number;
  startedAt: string; // ISO8601
};

export async function recordCrawlBatch(db: QueryExecutor, input: RecordCrawlBatchInput): Promise<void> {
  await db.query(
    `insert into edgar_crawl_ledger
       (form, index_date, status, filings_total, filings_ingested, filings_skipped, started_at, finished_at)
     values ($1, $2::date, $3, $4, $5, $6, $7::timestamptz, now())
     on conflict (form, index_date) do update set
       status = excluded.status,
       filings_total = excluded.filings_total,
       filings_ingested = excluded.filings_ingested,
       filings_skipped = excluded.filings_skipped,
       finished_at = now()`,
    [
      input.form,
      input.indexDate,
      input.status,
      input.filingsTotal,
      input.filingsIngested,
      input.filingsSkipped,
      input.startedAt,
    ],
  );
}

export async function lastCrawledDate(db: QueryExecutor, form: string): Promise<string | null> {
  const result = await db.query<{ index_date: string }>(
    `select to_char(index_date, 'YYYY-MM-DD') as index_date
       from edgar_crawl_ledger
      where form = $1 and status = 'succeeded'
      order by index_date desc
      limit 1`,
    [form],
  );
  const row = (result.rows as Array<{ index_date: string }>)[0];
  return row?.index_date ?? null;
}

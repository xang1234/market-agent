// The GAAP to non-GAAP reconciliations of stored earnings releases (#734).
// An Item 2.02 8-K files the release as an EX-99 exhibit, and the 8-K crawl and
// backfill store the whole submission, so this reads the stored bytes and calls
// neither SEC nor a model: each line is a cell of the release's own tables
// (reader/non-gaap-reconciliation-extractor.ts). Only the quarter the release
// reports is kept, as its earlier columns were reported by earlier releases.
// non-gaap-history.ts reads what this stores.

import type { IsoDate } from "../../financial-core/src/contracts.ts";
import type { ReleaseRevenue, StoredReconciliation } from "./non-gaap-history.ts";
import { isEphemeralRawBlobId, type ObjectStore } from "./object-store.ts";
import { extractNonGaapReconciliations, readTables } from "./reader/non-gaap-reconciliation-extractor.ts";
import type { QueryExecutor } from "./types.ts";

export type ReleaseReconciliations = {
  quarter_end: IsoDate | null;
  revenue: ReleaseRevenue | null;
  reconciliations: StoredReconciliation[];
};

export type ReconciliationCandidate = { documentId: string; rawBlobId: string; accession: string | null; filedAt: string | null };

// "read": stored, "undated": stored with no quarter, "no_bytes": the release's
// bytes were never kept, "noop": a concurrent read stored it first.
export type ReconciliationOutcome = "read" | "undated" | "no_bytes" | "noop";
export type ReconciliationDrainResult = Record<ReconciliationOutcome | "failed", number>;

// A release reports a quarter ended at most this long before it is filed, as
// sec-earnings-release-extraction.ts reads it.
const MAX_REPORT_LAG_DAYS = 92;
const DAY_MS = 86_400_000;
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DATE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/i;
const QUARTER = /\b(?:three|3)[\s-]+months?\b|\bquarter\b|\b(?:13|thirteen)[\s-]+weeks?\b/i;
const LONGER = /\byears?[\s-]+(?:ended|to[\s-]+date)\b|\bytd\b|\b(?:six|nine|twelve|6|9|12)[\s-]+months?\b|\b(?:26|39|52|53)[\s-]+weeks?\b/i;
const DURATION = new RegExp(`${QUARTER.source}|${LONGER.source}`, "gi");
const REVENUE = /^(?:total\s+)?(?:net\s+)?(?:revenues?|sales)$/i;

// The end of the three months a column header names, if it names one. Its
// own heading is its lowest, so the last duration it names is the column's,
// as under a "Fourth Quarter and Fiscal Year Ended" banner.
export function quarterEndOf(label: string | null | undefined): IsoDate | null {
  const duration = label ? [...label.matchAll(DURATION)].at(-1)?.[0] : undefined;
  if (duration === undefined || LONGER.test(duration)) return null;
  const match = DATE.exec(label!);
  if (!match) return null;
  const [, month, day, year] = match;
  const date = new Date(Date.UTC(Number(year), MONTHS.indexOf(month!.toLowerCase()), Number(day)));
  if (date.getUTCDate() !== Number(day)) return null;
  return date.toISOString().slice(0, 10) as IsoDate;
}

// A release's EX-99 exhibits, as markup.
function exhibitsOf(submission: string): Array<{ type: string; html: string }> {
  const exhibits: Array<{ type: string; html: string }> = [];
  for (const [, document] of submission.matchAll(/<DOCUMENT>([\s\S]*?)<\/DOCUMENT>/g)) {
    const type = /<TYPE>([^\n<]+)/.exec(document!)?.[1]?.trim().toUpperCase() ?? "";
    const html = /<TEXT>([\s\S]*)<\/TEXT>/.exec(document!)?.[1] ?? "";
    if (/^EX-99(?:\.\d+)?$/.test(type) && html.trim() !== "") exhibits.push({ type, html });
  }
  return exhibits;
}

export function releaseReconciliations(submission: string, filedOn: IsoDate | null): ReleaseReconciliations {
  const exhibits = exhibitsOf(submission).map((exhibit) => ({ ...exhibit, tables: readTables(exhibit.html) }));
  const filed = filedOn === null ? Number.NaN : Date.parse(filedOn);
  // The latest quarter any table's header names, ended by the filing and not long before it.
  const quarter_end = exhibits
    .flatMap((exhibit) => exhibit.tables.flatMap((table) => table.periods.map(quarterEndOf)))
    .filter((end): end is IsoDate => end !== null && Date.parse(end) <= filed && filed - Date.parse(end) <= MAX_REPORT_LAG_DAYS * DAY_MS)
    .sort()
    .at(-1) ?? null;
  if (quarter_end === null) return { quarter_end, revenue: null, reconciliations: [] };

  let revenue: ReleaseRevenue | null = null;
  const reconciliations: StoredReconciliation[] = [];
  for (const exhibit of exhibits) {
    for (const table of exhibit.tables) {
      for (const row of table.rows) {
        if (revenue !== null || !REVENUE.test(row.label.replace(/:$/, ""))) continue;
        const value = row.values.find(([slot, figure]) => figure.unit !== "percent" && quarterEndOf(table.periods[slot]) === quarter_end);
        if (value) revenue = { exhibit: exhibit.type, label: row.label, value_num: value[1].value_num, scale: table.scale ?? null };
      }
    }
    const { items } = extractNonGaapReconciliations({ html: exhibit.html, source_id: "", as_of: "" });
    for (const item of items) {
      if (quarterEndOf(item.period_label) !== quarter_end) continue;
      if (reconciliations.some((line) => line.measure_key === item.measure_key)) continue;
      reconciliations.push({
        exhibit: exhibit.type,
        measure_key: item.measure_key,
        gaap: item.gaap,
        non_gaap: item.non_gaap,
        adjustments: item.adjustments,
        unit: item.unit,
        scale: item.scale ?? null,
      });
    }
  }
  return { quarter_end, revenue, reconciliations };
}

// Stored releases (documents with an Item 2.02 claim) not yet read, by document id.
export async function findReconciliationCandidates(
  db: QueryExecutor,
  opts: { afterDocumentId?: string; limit?: number } = {},
): Promise<ReconciliationCandidate[]> {
  const { rows } = await db.query<{ document_id: string; raw_blob_id: string; accession: string | null; filed_at: Date | string | null }>(
    `select distinct on (d.document_id)
            d.document_id::text as document_id, d.raw_blob_id, d.provider_doc_id as accession, c.effective_time as filed_at
       from claims c
       join documents d on d.document_id = c.document_id
      where c.predicate = 'material_event.guidance_update'
        and d.deleted_at is null
        and d.document_id > $1::uuid
        and not exists (select 1 from non_gaap_reconciliations r where r.document_id = d.document_id)
      order by d.document_id, c.effective_time
      limit $2`,
    [opts.afterDocumentId ?? ZERO_UUID, opts.limit ?? 100],
  );
  return rows.map((row) => ({
    documentId: row.document_id,
    rawBlobId: row.raw_blob_id,
    accession: row.accession,
    filedAt: row.filed_at == null ? null : new Date(row.filed_at).toISOString(),
  }));
}

// A store failure, or bytes the store lost, throws, so a drain retries the
// release next time. Idempotent: a release already read is a "noop".
export async function readReleaseReconciliations(
  deps: { db: QueryExecutor; objectStore: ObjectStore },
  candidate: ReconciliationCandidate,
): Promise<ReconciliationOutcome> {
  // ponytail: such a release stays a candidate and is skipped again each run, by one query.
  if (isEphemeralRawBlobId(candidate.rawBlobId)) return "no_bytes";
  const blob = await deps.objectStore.get(candidate.rawBlobId);
  if (!blob) throw new Error(`raw_blob_id "${candidate.rawBlobId}" not found in object store`);
  const read = releaseReconciliations(new TextDecoder("utf-8").decode(blob.bytes), (candidate.filedAt?.slice(0, 10) ?? null) as IsoDate | null);
  const stored = await deps.db.query(
    `insert into non_gaap_reconciliations (document_id, quarter_end, revenue, reconciliations)
     values ($1::uuid, $2::date, $3::jsonb, $4::jsonb)
     on conflict (document_id) do nothing`,
    [candidate.documentId, read.quarter_end, read.revenue === null ? null : JSON.stringify(read.revenue), JSON.stringify(read.reconciliations)],
  );
  if ((stored.rowCount ?? 0) === 0) return "noop";
  return read.quarter_end === null ? "undated" : "read";
}

// The backlog by a document id keyset, past failures, so one bad release never blocks the rest.
export async function runReconciliationDrain(
  deps: { db: QueryExecutor; objectStore: ObjectStore },
  opts: { pageSize?: number; onRelease?: (candidate: ReconciliationCandidate, outcome: ReconciliationOutcome | { error: unknown }) => void } = {},
): Promise<ReconciliationDrainResult> {
  const result: ReconciliationDrainResult = { read: 0, undated: 0, no_bytes: 0, noop: 0, failed: 0 };
  let cursor = ZERO_UUID;
  for (;;) {
    const page = await findReconciliationCandidates(deps.db, { afterDocumentId: cursor, limit: opts.pageSize ?? 100 });
    if (page.length === 0) break;
    for (const candidate of page) {
      cursor = candidate.documentId;
      try {
        const outcome = await readReleaseReconciliations(deps, candidate);
        result[outcome] += 1;
        opts.onRelease?.(candidate, outcome);
      } catch (error) {
        result.failed += 1;
        opts.onRelease?.(candidate, { error });
      }
    }
  }
  return result;
}

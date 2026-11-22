// Management's guidance against what it then reported (#733). An earnings
// release guides the next quarter (sec-earnings-release-extraction.ts stores
// each guide's low and high), and the next release reports that quarter. Each
// guide is compared with the actual on its own basis, a non-GAAP guide only with
// the next release's non-GAAP actual and a GAAP guide with its GAAP one. A guide
// whose quarter is reported with no actual on that basis is not comparable;
// nothing is compared across bases.

import type { IsoDate } from "../../financial-core/src/contracts.ts";
import { FIGURE_BASES, figureUnit, type FigureBasis, type FigureUnit } from "./release-figures.ts";
import { RELEASE_METRICS, type ReleaseMetric } from "./sec-earnings-release-extraction.ts";
import { ACCESSION_PATTERN, filingIndexUrl } from "./sec-edgar.ts";
import type { QueryExecutor } from "./types.ts";

// An earnings release, by the quarter it reports.
export type StoredRelease = { document_id: string; quarter_end: IsoDate; filed_on: IsoDate; url: string | null };
// A guide (claim_id names the guidance claim it binds) or a reported actual (low
// and high both the value), in dollars or percent.
export type StoredFigure = {
  document_id: string;
  claim_id: string | null;
  kind: "guidance" | "result";
  metric: ReleaseMetric;
  basis: FigureBasis;
  low: number;
  high: number;
  quote: string;
};

export type FigureSource = { document_id: string; claim_id: string | null; filed_on: IsoDate; url: string | null; quote: string };
export type GuidanceOutcome = "beat" | "in_line" | "miss" | "not_comparable" | "not_yet_reported";
export type NotComparableReason = "no_same_basis_actual" | "conflicting_guidance" | "conflicting_actuals";
export type GuidanceComparison = {
  // The quarter guided, null until a release reports it.
  quarter_end: IsoDate | null;
  metric: ReleaseMetric;
  basis: FigureBasis;
  unit: FigureUnit;
  guided: { low: number; high: number; source: FigureSource };
  actual: { value: number; source: FigureSource } | null;
  outcome: GuidanceOutcome;
  reason?: NotComparableReason;
};
// Of the guides compared over the record's quarters, how many the actual met,
// in line or a beat.
export type GuidanceHitRate = { metric: ReleaseMetric; basis: FigureBasis; hits: number; compared: number };
export type GuidanceRecord = { rows: GuidanceComparison[]; hit_rates: GuidanceHitRate[] };

export const RECORD_QUARTERS = 8;
// The next quarter ends 13 or 14 weeks, or three calendar months, after one.
const NEXT_QUARTER_DAYS = { min: 80, max: 100 } as const;
// Coming in under a cost guide is the beat.
const LOWER_IS_BETTER: ReadonlySet<ReleaseMetric> = new Set(["operating_expenses", "capex"]);

// An issuer's record, read from its stored releases (an issuer merged into
// another reads as the one kept). A guide whose claim is no longer current
// (superseded, rejected) guides nothing.
export async function loadGuidanceRecord(db: QueryExecutor, issuerId: string): Promise<GuidanceRecord> {
  const { rows: releases } = await db.query<{ document_id: string; quarter_end: IsoDate; filed_on: IsoDate; accession: string | null; cik: string | null }>(
    `select q.document_id::text as document_id, q.quarter_end::text as quarter_end, q.filed_on::text as filed_on,
            d.provider_doc_id as accession, i.cik
       from earnings_release_quarters q
       join documents d on d.document_id = q.document_id and d.deleted_at is null
       join issuers i on i.issuer_id = q.issuer_id
      where current_issuer_id(q.issuer_id) = current_issuer_id($1::uuid)`,
    [issuerId],
  );
  const { rows: figures } = await db.query<StoredFigure>(
    `select f.document_id::text as document_id, f.claim_id::text as claim_id, f.kind, f.metric, f.basis,
            f.low::float8 as low, f.high::float8 as high, f.quote
       from earnings_release_figures f
       join earnings_release_quarters q on q.document_id = f.document_id
       left join claims c on c.claim_id = f.claim_id
      where current_issuer_id(q.issuer_id) = current_issuer_id($1::uuid)
        and (f.claim_id is null or (c.status in ('extracted', 'corroborated') and c.superseded_at is null))`,
    [issuerId],
  );
  return guidanceRecord(releases.map(({ accession, cik, ...release }) => ({ ...release, url: releaseUrl(cik, accession) })), figures);
}

// The filing's EDGAR index, or null for a release whose CIK or accession is
// not one.
function releaseUrl(cik: string | null, accession: string | null): string | null {
  const number = Number(cik);
  return Number.isInteger(number) && number > 0 && accession !== null && ACCESSION_PATTERN.test(accession)
    ? filingIndexUrl({ cik: number, accession_number: accession })
    : null;
}

// The record over the issuer's last RECORD_QUARTERS reported quarters, and the
// guides for the quarter after its latest, which no release reports yet. A
// figure of a release not given is ignored.
export function guidanceRecord(releases: ReadonlyArray<StoredRelease>, figures: ReadonlyArray<StoredFigure>): GuidanceRecord {
  const byDocument = new Map(releases.map((release) => [release.document_id, release]));
  const ends = [...new Set(releases.map((release) => release.quarter_end))].sort();
  const recorded = new Set(ends.slice(-RECORD_QUARTERS));
  const guides = new Map<string, Array<StoredFigure & { release: StoredRelease }>>();
  const actuals = new Map<string, Array<StoredFigure & { release: StoredRelease }>>();
  for (const figure of figures) {
    const release = byDocument.get(figure.document_id);
    if (release === undefined) continue;
    if (figure.kind === "result") {
      push(actuals, seriesKey(release.quarter_end, figure), { ...figure, release });
      continue;
    }
    const target = nextQuarterEnd(ends, release.quarter_end);
    // ponytail: a guide whose next release is not on file, though a later one
    // is, is left out; show it when stored releases have gaps worth naming.
    if (target === null ? release.quarter_end !== ends.at(-1) : !recorded.has(target)) continue;
    push(guides, seriesKey(target, figure), { ...figure, release });
  }
  const rows = [...guides.entries()].map(([key, picks]) => compare(key, picks, actuals.get(key) ?? []));
  rows.sort((a, b) =>
    (b.quarter_end ?? "9999").localeCompare(a.quarter_end ?? "9999") ||
    RELEASE_METRICS.indexOf(a.metric) - RELEASE_METRICS.indexOf(b.metric) ||
    FIGURE_BASES.indexOf(a.basis) - FIGURE_BASES.indexOf(b.basis));
  return { rows, hit_rates: hitRates(rows) };
}

function compare(
  key: string,
  picks: ReadonlyArray<StoredFigure & { release: StoredRelease }>,
  reported: ReadonlyArray<StoredFigure & { release: StoredRelease }>,
): GuidanceComparison {
  const [guide, ...others] = latestFirst(picks);
  const quarterEnd = JSON.parse(key)[0] as IsoDate | null;
  const base = {
    quarter_end: quarterEnd,
    metric: guide!.metric,
    basis: guide!.basis,
    unit: figureUnit(guide!.metric),
    guided: { low: guide!.low, high: guide!.high, source: sourceOf(guide!) },
  };
  if (quarterEnd === null) return { ...base, actual: null, outcome: "not_yet_reported" };
  const [actual, ...restated] = latestFirst(reported);
  const shown = actual === undefined ? null : { value: actual.low, source: sourceOf(actual) };
  if (others.some((other) => other.low !== guide!.low || other.high !== guide!.high)) {
    return { ...base, actual: shown, outcome: "not_comparable", reason: "conflicting_guidance" };
  }
  if (actual === undefined) return { ...base, actual: null, outcome: "not_comparable", reason: "no_same_basis_actual" };
  if (restated.some((other) => other.low !== actual.low)) {
    return { ...base, actual: shown, outcome: "not_comparable", reason: "conflicting_actuals" };
  }
  const position = actual.low < guide!.low ? -1 : actual.low > guide!.high ? 1 : 0;
  const better = LOWER_IS_BETTER.has(guide!.metric) ? -position : position;
  return { ...base, actual: shown, outcome: better > 0 ? "beat" : better < 0 ? "miss" : "in_line" };
}

function hitRates(rows: ReadonlyArray<GuidanceComparison>): GuidanceHitRate[] {
  const rates = new Map<string, GuidanceHitRate>();
  for (const row of rows) {
    if (row.outcome !== "beat" && row.outcome !== "in_line" && row.outcome !== "miss") continue;
    const key = `${row.metric}|${row.basis}`;
    const rate = rates.get(key) ?? { metric: row.metric, basis: row.basis, hits: 0, compared: 0 };
    rate.compared += 1;
    if (row.outcome !== "miss") rate.hits += 1;
    rates.set(key, rate);
  }
  return [...rates.values()];
}

// The end of the stored quarter after the one ending `end`, or null.
function nextQuarterEnd(ends: ReadonlyArray<IsoDate>, end: IsoDate): IsoDate | null {
  return ends.find((next) => {
    const days = (Date.parse(next) - Date.parse(end)) / 86_400_000;
    return days >= NEXT_QUARTER_DAYS.min && days <= NEXT_QUARTER_DAYS.max;
  }) ?? null;
}

const seriesKey = (quarterEnd: IsoDate | null, figure: Pick<StoredFigure, "metric" | "basis">) =>
  JSON.stringify([quarterEnd, figure.metric, figure.basis]);

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  map.set(key, [...(map.get(key) ?? []), value]);
}

const latestFirst = <T extends { release: StoredRelease; document_id: string }>(picks: ReadonlyArray<T>): T[] =>
  [...picks].sort((a, b) => b.release.filed_on.localeCompare(a.release.filed_on) || a.document_id.localeCompare(b.document_id));

const sourceOf = (figure: StoredFigure & { release: StoredRelease }): FigureSource => ({
  document_id: figure.document_id,
  claim_id: figure.claim_id,
  filed_on: figure.release.filed_on,
  url: figure.release.url,
  quote: figure.quote,
});

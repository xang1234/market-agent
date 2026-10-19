import type { QueryExecutor } from "./types.ts";
import {
  sourceDisclosure,
  storagePolicyForDocument,
} from "./source-disclosure.ts";
import { formatCompactCurrency, formatCurrency, formatPercent } from "../../analyze/src/block-format.ts";
import { isRecord } from "../../shared/src/http.ts";

export const EVIDENCE_INSPECTION_REF_KINDS = [
  "source",
  "document",
  "claim",
  "event",
  "fact",
  "series",
] as const;

export type EvidenceInspectionRefKind = (typeof EVIDENCE_INSPECTION_REF_KINDS)[number];

export type EvidenceInspectionRef = {
  kind: EvidenceInspectionRefKind;
  id: string;
};

export type EvidenceInspectionRelatedRef = EvidenceInspectionRef & {
  label?: string;
};

export type EvidenceInspectionRow = {
  label: string;
  value: string;
};

export type EvidenceInspectionLink = {
  label: string;
  href: string;
};

export type EvidenceInspection = {
  snapshot_id: string;
  ref: EvidenceInspectionRef;
  kind: EvidenceInspectionRefKind;
  title: string;
  subtitle: string | null;
  badges: ReadonlyArray<string>;
  rows: ReadonlyArray<EvidenceInspectionRow>;
  links: ReadonlyArray<EvidenceInspectionLink>;
  related_refs: ReadonlyArray<EvidenceInspectionRelatedRef>;
};

export class EvidenceInspectionError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "EvidenceInspectionError";
    this.status = status;
  }
}

type SnapshotRow = {
  snapshot_id: string;
  source_ids: unknown;
  document_refs: unknown;
  claim_refs: unknown;
  event_refs: unknown;
  fact_refs: unknown;
  series_specs: unknown;
};

// A chart line's spec as chat seals it into snapshots.series_specs.
type SeriesSpec = {
  series_ref: string;
  source_id: string;
  listing_id: string;
  bars_sha256?: string;
  interval?: string;
  adjustment_basis?: string;
  normalization?: string;
  points?: string;
  delay_class?: string;
  range?: { start?: string; end?: string };
  window?: { kind?: string; year?: number; baseline_date?: string; end_date?: string };
  as_of?: string;
};

type SourceRow = {
  source_id: string;
  provider: string;
  kind: string;
  canonical_url: string | null;
  trust_tier: string;
  license_class: string;
  retrieved_at: Date | string;
  user_id: string | null;
};

type SnapshotManifestRefs = {
  source_ids: ReadonlyArray<string>;
  document_refs: ReadonlyArray<string>;
  claim_refs: ReadonlyArray<string>;
  event_refs: ReadonlyArray<string>;
  fact_refs: ReadonlyArray<string>;
  series_specs: ReadonlyArray<SeriesSpec>;
};

export async function loadEvidenceInspection(
  db: QueryExecutor,
  input: {
    user_id: string;
    snapshot_id: string;
    ref: EvidenceInspectionRef;
  },
): Promise<EvidenceInspection> {
  assertUuid(input.user_id, "user_id");
  assertUuid(input.snapshot_id, "snapshot_id");
  assertRef(input.ref);

  await assertSnapshotVisibleToUser(db, input.user_id, input.snapshot_id);
  const manifest = await loadSnapshotManifest(db, input.snapshot_id);
  assertRefBelongsToSnapshot(manifest, input.ref);

  let inspection: EvidenceInspection;
  if (input.ref.kind === "source") {
    inspection = await inspectSource(db, input.snapshot_id, input.ref.id, input.user_id);
  } else if (input.ref.kind === "document") {
    inspection = await inspectDocument(db, input.snapshot_id, input.ref.id, input.user_id);
  } else if (input.ref.kind === "claim") {
    inspection = await inspectClaim(db, input.snapshot_id, input.ref.id, input.user_id);
  } else if (input.ref.kind === "event") {
    inspection = await inspectEvent(db, input.snapshot_id, input.ref.id);
  } else if (input.ref.kind === "fact") {
    inspection = await inspectFact(db, input.snapshot_id, input.ref.id, input.user_id);
  } else {
    const spec = manifest.series_specs.find((candidate) => candidate.series_ref === input.ref.id)!;
    inspection = await inspectSeries(db, input.snapshot_id, spec, input.user_id);
  }

  return withSnapshotScopedRelatedRefs(inspection, manifest);
}

async function assertSnapshotVisibleToUser(
  db: QueryExecutor,
  userId: string,
  snapshotId: string,
): Promise<void> {
  const { rows } = await db.query<{ visible: number }>(
    `select 1 as visible
       where exists (
         select 1
           from chat_messages m
           join chat_threads t on t.thread_id = m.thread_id
          where m.snapshot_id = $1::uuid
            and t.user_id = $2::uuid
       )
       or exists (
         select 1
           from analyze_template_runs r
           join analyze_templates t on t.template_id = r.template_id
          where r.snapshot_id = $1::uuid
            and t.user_id = $2::uuid
       )
       or exists (
         select 1
           from findings f
           join agents a on a.agent_id = f.agent_id
          where f.snapshot_id = $1::uuid
            and a.user_id = $2::uuid
       )
       or exists (
         select 1
           from agent_thesis_assessments ta
           join agent_thesis_versions tv on tv.thesis_version_id = ta.thesis_version_id
           join agents a on a.agent_id = tv.agent_id
          where ta.snapshot_id = $1::uuid
            and a.user_id = $2::uuid
       )
       or exists (
         select 1
           from grid_cells gc
           join grid_runs gr on gr.grid_run_id = gc.grid_run_id
           join research_grids g on g.grid_id = gr.grid_id
          where gc.snapshot_id = $1::uuid
            and g.user_id = $2::uuid
       )
       or exists (
         select 1
           from discovery_candidates dc
           join discovery_runs dr on dr.run_id=dc.run_id
           join discovery_campaigns campaign on campaign.campaign_id=dr.campaign_id and campaign.user_id=dr.user_id
          where dc.snapshot_id=$1::uuid
            and campaign.user_id=$2::uuid
       )`,
    [snapshotId, userId],
  );
  if (!rows[0]) throw new EvidenceInspectionError(404, "snapshot is not visible");
}

async function loadSnapshotManifest(
  db: QueryExecutor,
  snapshotId: string,
): Promise<SnapshotManifestRefs> {
  const { rows } = await db.query<SnapshotRow>(
    `select snapshot_id::text as snapshot_id,
            source_ids,
            document_refs,
            claim_refs,
            event_refs,
            fact_refs,
            series_specs
       from snapshots
      where snapshot_id = $1::uuid`,
    [snapshotId],
  );
  const row = rows[0];
  if (!row) throw new EvidenceInspectionError(404, "snapshot not found");
  return refsFromSnapshotRow(row);
}

function refsFromSnapshotRow(row: SnapshotRow): SnapshotManifestRefs {
  return Object.freeze({
    source_ids: stringArray(row.source_ids),
    document_refs: stringArray(row.document_refs),
    claim_refs: stringArray(row.claim_refs),
    event_refs: stringArray(row.event_refs),
    fact_refs: stringArray(row.fact_refs),
    series_specs: seriesSpecs(row.series_specs),
  });
}

function seriesSpecs(value: unknown): ReadonlyArray<SeriesSpec> {
  const specs = typeof value === "string" ? parseJson(value) : value;
  if (!Array.isArray(specs)) return Object.freeze([]);
  return Object.freeze(specs.filter((spec): spec is SeriesSpec =>
    isRecord(spec) &&
    typeof spec.series_ref === "string" &&
    isUuid(spec.source_id) &&
    isUuid(spec.listing_id)
  ));
}

function assertRefBelongsToSnapshot(
  manifest: SnapshotManifestRefs,
  ref: EvidenceInspectionRef,
): void {
  if (!refsForKind(manifest, ref.kind).includes(ref.id)) {
    throw new EvidenceInspectionError(404, "ref is not present in snapshot manifest");
  }
}

function refsForKind(
  manifest: SnapshotManifestRefs,
  kind: EvidenceInspectionRefKind,
): ReadonlyArray<string> {
  if (kind === "source") return manifest.source_ids;
  if (kind === "document") return manifest.document_refs;
  if (kind === "claim") return manifest.claim_refs;
  if (kind === "event") return manifest.event_refs;
  if (kind === "fact") return manifest.fact_refs;
  return manifest.series_specs.map((spec) => spec.series_ref);
}

function withSnapshotScopedRelatedRefs(
  inspection: EvidenceInspection,
  manifest: SnapshotManifestRefs,
): EvidenceInspection {
  return Object.freeze({
    ...inspection,
    related_refs: Object.freeze(
      inspection.related_refs.filter((ref) => refsForKind(manifest, ref.kind).includes(ref.id)),
    ),
  });
}

async function inspectSource(
  db: QueryExecutor,
  snapshotId: string,
  sourceId: string,
  userId: string,
): Promise<EvidenceInspection> {
  const { rows } = await db.query<SourceRow>(
    `select source_id::text as source_id,
            provider,
            kind,
            canonical_url,
            trust_tier,
            license_class,
            retrieved_at,
            user_id::text as user_id
       from sources
      where source_id = $1::uuid
        and (user_id is null or user_id = $2::uuid)`,
    [sourceId, userId],
  );
  const row = rows[0];
  if (!row) throw new EvidenceInspectionError(404, "source not found");
  return Object.freeze({
    snapshot_id: snapshotId,
    ref: Object.freeze({ kind: "source", id: sourceId }),
    kind: "source",
    title: `${row.provider} ${row.kind}`,
    subtitle: row.canonical_url,
    badges: sourceBadges(row),
    rows: Object.freeze([
      { label: "Provider", value: row.provider },
      { label: "Kind", value: row.kind },
      { label: "Retrieved", value: isoString(row.retrieved_at) },
      ...disclosureRows(row),
    ]),
    links: sourceLinks(row.canonical_url),
    related_refs: Object.freeze([]),
  });
}

async function inspectDocument(
  db: QueryExecutor,
  snapshotId: string,
  documentId: string,
  userId: string,
): Promise<EvidenceInspection> {
  const { rows } = await db.query<{
    document_id: string;
    source_id: string;
    kind: string;
    title: string | null;
    author: string | null;
    published_at: Date | string | null;
    parse_status: string;
    provider: string;
    canonical_url: string | null;
    trust_tier: string;
    license_class: string;
    raw_blob_id: string;
  }>(
    `select d.document_id::text as document_id,
            d.source_id::text as source_id,
            d.kind,
            d.title,
            d.author,
            d.published_at,
            d.parse_status,
            s.provider,
            s.canonical_url,
            s.trust_tier,
            s.license_class,
            d.raw_blob_id
       from documents d
       join sources s on s.source_id = d.source_id
      where d.document_id = $1::uuid
        and d.deleted_at is null
        and (s.user_id is null or s.user_id = $2::uuid)`,
    [documentId, userId],
  );
  const row = rows[0];
  if (!row) throw new EvidenceInspectionError(404, "document not found");
  return Object.freeze({
    snapshot_id: snapshotId,
    ref: Object.freeze({ kind: "document", id: documentId }),
    kind: "document",
    title: row.title ?? `${row.provider} ${row.kind}`,
    subtitle: row.canonical_url,
    badges: documentBadges(row),
    rows: Object.freeze([
      { label: "Kind", value: row.kind },
      { label: "Author", value: row.author ?? "Unknown" },
      { label: "Published", value: row.published_at === null ? "Unknown" : isoString(row.published_at) },
      ...disclosureRows(row),
    ]),
    links: sourceLinks(row.canonical_url),
    related_refs: Object.freeze([{ kind: "source" as const, id: row.source_id, label: row.provider }]),
  });
}

async function inspectClaim(
  db: QueryExecutor,
  snapshotId: string,
  claimId: string,
  userId: string,
): Promise<EvidenceInspection> {
  const { rows } = await db.query<{
    claim_id: string;
    document_id: string;
    reported_by_source_id: string;
    predicate: string;
    text_canonical: string;
    polarity: string;
    modality: string;
    effective_time: Date | string | null;
    confidence: string | number;
    status: string;
    provider: string;
    license_class: string;
    canonical_url: string | null;
    document_title: string | null;
  }>(
    `select c.claim_id::text as claim_id,
            c.document_id::text as document_id,
            c.reported_by_source_id::text as reported_by_source_id,
            c.predicate,
            c.text_canonical,
            c.polarity,
            c.modality,
            c.effective_time,
            c.confidence,
            c.status,
            s.provider,
            s.license_class,
            s.canonical_url,
            d.title as document_title
       from claims c
       join sources s on s.source_id = c.reported_by_source_id
       join documents d on d.document_id = c.document_id
       join sources document_source on document_source.source_id = d.source_id
      where c.claim_id = $1::uuid
        and (s.user_id is null or s.user_id = $2::uuid)
        and d.deleted_at is null
        and (document_source.user_id is null or document_source.user_id = $2::uuid)`,
    [claimId, userId],
  );
  const row = rows[0];
  if (!row) throw new EvidenceInspectionError(404, "claim not found");
  return Object.freeze({
    snapshot_id: snapshotId,
    ref: Object.freeze({ kind: "claim", id: claimId }),
    kind: "claim",
    title: row.predicate,
    subtitle: row.text_canonical,
    badges: Object.freeze([row.status, row.polarity, row.modality]),
    rows: Object.freeze([
      { label: "Claim", value: row.text_canonical },
      { label: "Confidence", value: String(row.confidence) },
      { label: "Effective time", value: row.effective_time === null ? "Unknown" : isoString(row.effective_time) },
      { label: "Provider", value: row.provider },
      ...disclosureRows(row),
    ]),
    links: sourceLinks(row.canonical_url),
    related_refs: Object.freeze([
      {
        kind: "document" as const,
        id: row.document_id,
        ...(row.document_title == null ? {} : { label: row.document_title }),
      },
      { kind: "source" as const, id: row.reported_by_source_id, label: row.provider },
    ]),
  });
}

async function inspectEvent(
  db: QueryExecutor,
  snapshotId: string,
  eventId: string,
): Promise<EvidenceInspection> {
  const { rows } = await db.query<{
    event_id: string;
    event_type: string;
    occurred_at: Date | string;
    status: string;
    source_claim_ids: unknown;
    source_ids: unknown;
  }>(
    `select event_id::text as event_id,
            event_type,
            occurred_at,
            status,
            source_claim_ids,
            source_ids
       from events
      where event_id = $1::uuid`,
    [eventId],
  );
  const row = rows[0];
  if (!row) throw new EvidenceInspectionError(404, "event not found");
  const claimRefs = stringArray(row.source_claim_ids).map((id) => ({ kind: "claim" as const, id }));
  const sourceRefs = stringArray(row.source_ids).map((id) => ({ kind: "source" as const, id }));
  return Object.freeze({
    snapshot_id: snapshotId,
    ref: Object.freeze({ kind: "event", id: eventId }),
    kind: "event",
    title: row.event_type,
    subtitle: isoString(row.occurred_at),
    badges: Object.freeze([row.status]),
    rows: Object.freeze([
      { label: "Type", value: row.event_type },
      { label: "Occurred", value: isoString(row.occurred_at) },
      { label: "Status", value: row.status },
    ]),
    links: Object.freeze([]),
    related_refs: Object.freeze([...claimRefs, ...sourceRefs]),
  });
}

async function inspectFact(
  db: QueryExecutor,
  snapshotId: string,
  factId: string,
  userId: string,
): Promise<EvidenceInspection> {
  const { rows } = await db.query<{
    fact_id: string;
    source_id: string;
    value: string;
    value_text: string | null;
    unit: string;
    currency: string | null;
    metric_name: string | null;
    metric_unit_class: string | null;
    period_kind: string;
    period_start: string | null;
    period_end: string | null;
    fiscal_year: number | null;
    fiscal_period: string | null;
    as_of: Date | string;
    verification_status: string;
    freshness_class: string;
    coverage_level: string;
    method: string;
    confidence: string | number;
    provider: string;
    canonical_url: string | null;
  }>(
    // Provenance lookup by fact_id for a ref that assertRefBelongsToSnapshot has
    // already confirmed belongs to this sealed (immutable) snapshot. This is
    // deliberately NOT guarded by method='reported'/superseded_by/invalidated_at:
    // a snapshot must always be able to show the exact fact it cited at seal time,
    // even after that fact is later superseded or invalidated. The guards that
    // apply here are access guards — snapshot visibility, entitlement_channels,
    // and user scoping (below) — not the freshness/selection guard used by readers
    // that pick the current authoritative fact among candidates.
    `select f.fact_id::text as fact_id,
            f.source_id::text as source_id,
            coalesce(f.value_text, (f.value_num * f.scale)::text, '') as value,
            f.value_text,
            f.unit,
            f.currency,
            m.display_name as metric_name,
            m.unit_class as metric_unit_class,
            f.period_kind,
            f.period_start::text as period_start,
            f.period_end::text as period_end,
            f.fiscal_year,
            f.fiscal_period,
            f.as_of,
            f.verification_status,
            f.freshness_class,
            f.coverage_level,
            f.method,
            f.confidence,
            s.provider,
            s.canonical_url
       from facts f
       join sources s on s.source_id = f.source_id
       left join metrics m on m.metric_id = f.metric_id
      where f.fact_id = $1::uuid
        and f.entitlement_channels ? 'app'
        and (s.user_id is null or s.user_id = $2::uuid)`,
    [factId, userId],
  );
  const row = rows[0];
  if (!row) throw new EvidenceInspectionError(404, "fact not found");
  return Object.freeze({
    snapshot_id: snapshotId,
    ref: Object.freeze({ kind: "fact", id: factId }),
    kind: "fact",
    title: factValueText(row),
    subtitle: [row.metric_name, factPeriodText({ ...row, as_of: isoString(row.as_of) })].filter((part) => part).join(" · "),
    badges: Object.freeze([row.verification_status, row.freshness_class, row.coverage_level]),
    rows: Object.freeze([
      { label: "Value", value: row.value },
      { label: "Unit", value: row.unit },
      { label: "As of", value: isoString(row.as_of) },
      { label: "Method", value: row.method },
      { label: "Confidence", value: String(row.confidence) },
    ]),
    links: sourceLinks(row.canonical_url),
    related_refs: Object.freeze([{ kind: "source" as const, id: row.source_id, label: row.provider }]),
  });
}

// Worded as the answer words the figure, with its formatters: "$209.9B", "$2.0M", "13.9%", "$4.12".
function factValueText(row: {
  value: string;
  value_text: string | null;
  unit: string;
  currency: string | null;
  metric_unit_class: string | null;
}): string {
  const value = Number(row.value);
  if (row.value_text !== null || row.value === "" || !Number.isFinite(value)) return row.value;
  // A percent metric derived as a fraction (a margin of 0.462) is stored as a ratio.
  if (row.metric_unit_class === "percent" && (row.unit === "ratio" || row.unit === "pure")) return formatPercent(value);
  const format = (options: Intl.NumberFormatOptions) => new Intl.NumberFormat("en-US", options).format(value);
  // Some sources name the currency in the unit itself ("USD").
  const unitCode = currencyCode(row.unit);
  const code = unitCode ?? currencyCode(row.currency);
  switch (unitCode === null ? row.unit : "currency") {
    case "currency":
      return code === null
        ? format({ notation: "compact", minimumFractionDigits: 1, maximumFractionDigits: 1 })
        : formatCompactCurrency(value, code);
    case "currency_per_share":
      return code === null ? format({ minimumFractionDigits: 2, maximumFractionDigits: 2 }) : formatCurrency(value, code);
    case "percent":
    case "%":
      return `${format({ maximumFractionDigits: 1 })}%`;
    case "count":
      return format({ notation: "compact", maximumFractionDigits: 1 });
    case "shares":
      return `${format({ notation: "compact", maximumFractionDigits: 1 })} shares`;
    default:
      return `${format({ maximumFractionDigits: 2 })} ${row.unit}`;
  }
}

const CURRENCY_CODES = new Set(Intl.supportedValuesOf("currency"));

// Intl throws on a code it does not know, and facts.currency is free text.
function currencyCode(value: string | null): string | null {
  const code = value?.toUpperCase() ?? null;
  return code !== null && CURRENCY_CODES.has(code) ? code : null;
}

function factPeriodText(row: {
  as_of: string;
  period_kind: string;
  period_start: string | null;
  period_end: string | null;
  fiscal_year: number | null;
  fiscal_period: string | null;
}): string {
  const fiscalYear = row.fiscal_year === null ? null : `FY ${row.fiscal_year}`;
  switch (row.period_kind) {
    case "fiscal_y":
      return fiscalYear ?? "";
    case "fiscal_q":
      return [row.fiscal_period, fiscalYear].filter((part) => part).join(" ");
    case "ttm":
      return row.period_end === null ? "TTM" : `TTM to ${row.period_end}`;
    case "range":
      return [row.period_start, row.period_end].filter((part) => part).join(" to ");
    default:
      return row.period_end ?? row.as_of.slice(0, 10);
  }
}

const ADJUSTMENT_BASIS_LABELS: Readonly<Record<string, string>> = {
  split_adjusted: "Split-adjusted, excluding dividends",
  split_and_div_adjusted: "Split- and dividend-adjusted",
  unadjusted: "Unadjusted",
};
const NORMALIZATION_LABELS: Readonly<Record<string, string>> = { pct_return: "Price return" };
const INTERVAL_LABELS: Readonly<Record<string, string>> = { "1d": "Daily" };
const DELAY_CLASS_LABELS: Readonly<Record<string, string>> = {
  eod: "End of day",
  delayed_15m: "Delayed 15 minutes",
  real_time: "Real time",
  unknown: "Unknown",
};
const PERF_POINTS = "perf_lines";

// The spec is the snapshot's own sealed record; the listing and source rows
// only label it, and the source must be visible to this user.
async function inspectSeries(
  db: QueryExecutor,
  snapshotId: string,
  spec: SeriesSpec,
  userId: string,
): Promise<EvidenceInspection> {
  const { rows } = await db.query<{
    ticker: string;
    legal_name: string;
    canonical_url: string | null;
    provider: string;
  }>(
    `select l.ticker,
            iss.legal_name,
            s.canonical_url,
            s.provider
       from listings l
       join instruments ins on ins.instrument_id = l.instrument_id
       join issuers iss on iss.issuer_id = ins.issuer_id
       join sources s on s.source_id = $2::uuid
      where l.listing_id = $1::uuid
        and (s.user_id is null or s.user_id = $3::uuid)`,
    [spec.listing_id, spec.source_id, userId],
  );
  const row = rows[0];
  if (!row) throw new EvidenceInspectionError(404, "series not found");
  const label = (labels: Readonly<Record<string, string>>, value: string | undefined) =>
    value === undefined ? "Unknown" : labels[value] ?? value;
  return Object.freeze({
    snapshot_id: snapshotId,
    ref: Object.freeze({ kind: "series", id: spec.series_ref }),
    kind: "series",
    title: `${row.ticker} price series`,
    subtitle: row.legal_name,
    badges: Object.freeze(spec.points === PERF_POINTS ? ["sealed", "points_checked"] : ["sealed"]),
    rows: Object.freeze([
      { label: "Basis", value: label(ADJUSTMENT_BASIS_LABELS, spec.adjustment_basis) },
      { label: "Return", value: label(NORMALIZATION_LABELS, spec.normalization) },
      { label: "Window", value: seriesWindow(spec) },
      { label: "Interval", value: label(INTERVAL_LABELS, spec.interval) },
      { label: "Delay", value: label(DELAY_CLASS_LABELS, spec.delay_class) },
      { label: "As of", value: spec.as_of ?? "Unknown" },
      ...(typeof spec.bars_sha256 === "string"
        ? [{ label: "Bars digest", value: `sha256:${spec.bars_sha256.slice(0, 12)}` }]
        : []),
    ]),
    links: sourceLinks(row.canonical_url),
    related_refs: Object.freeze([{ kind: "source" as const, id: spec.source_id, label: row.provider }]),
  });
}

// Worded as the perf block's default_range words it.
function seriesWindow(spec: SeriesSpec): string {
  const { window, range } = spec;
  if (window?.kind === "ytd") {
    return `YTD ${window.year}: ${window.baseline_date} close to ${window.end_date} close`;
  }
  const date = (value: string | undefined) => value?.slice(0, 10) ?? "unknown";
  return `${date(range?.start)} to ${date(range?.end)}`;
}

function assertRef(ref: EvidenceInspectionRef): void {
  if (!isRecord(ref)) throw new EvidenceInspectionError(400, "ref must be an object");
  if (!EVIDENCE_INSPECTION_REF_KINDS.includes(ref.kind)) {
    throw new EvidenceInspectionError(400, "ref.kind is invalid");
  }
  assertUuid(ref.id, "ref.id");
}

function sourceLinks(canonicalUrl: string | null): ReadonlyArray<EvidenceInspectionLink> {
  if (canonicalUrl === null || !isSafeExternalHref(canonicalUrl)) return Object.freeze([]);
  return Object.freeze([{ label: "Open source", href: canonicalUrl }]);
}

function sourceBadges(row: {
  provider: string;
  trust_tier: string;
  license_class: string;
}): ReadonlyArray<string> {
  return badgesWithStorage(row, [row.trust_tier, row.license_class]);
}

function documentBadges(row: {
  provider: string;
  trust_tier: string;
  license_class: string;
  parse_status: string;
  raw_blob_id: string;
}): ReadonlyArray<string> {
  return badgesWithStorage(row, [row.trust_tier, row.license_class, row.parse_status]);
}

function badgesWithStorage(
  row: {
    provider: string;
    license_class: string;
    raw_blob_id?: string;
  },
  badges: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const storagePolicy = storagePolicyForDocument(row);
  return Object.freeze(storagePolicy === "stored_blob" ? [...badges] : [...badges, storagePolicy]);
}

function disclosureRows(row: {
  provider: string;
  license_class: string;
}): ReadonlyArray<EvidenceInspectionRow> {
  const disclosure = sourceDisclosure(row);
  return disclosure ? Object.freeze([{ label: "Disclosure", value: disclosure }]) : Object.freeze([]);
}

function isSafeExternalHref(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function assertUuid(value: unknown, label: string): asserts value is string {
  if (!isUuid(value)) throw new EvidenceInspectionError(400, `${label} must be a UUID`);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value);
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function stringArray(value: unknown): ReadonlyArray<string> {
  if (Array.isArray(value)) {
    return Object.freeze(value.filter((item): item is string => typeof item === "string"));
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return stringArray(parsed);
    } catch {
      return Object.freeze([]);
    }
  }
  return Object.freeze([]);
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

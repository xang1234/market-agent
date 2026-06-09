import type { QueryExecutor } from "./types.ts";
import {
  sourceDisclosure,
  storagePolicyForDocument,
} from "./source-disclosure.ts";

export const EVIDENCE_INSPECTION_REF_KINDS = [
  "source",
  "document",
  "claim",
  "event",
  "fact",
] as const;

export type EvidenceInspectionRefKind = (typeof EVIDENCE_INSPECTION_REF_KINDS)[number];

export type EvidenceInspectionRef = {
  kind: EvidenceInspectionRefKind;
  id: string;
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
  related_refs: ReadonlyArray<EvidenceInspectionRef>;
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
  } else {
    inspection = await inspectFact(db, input.snapshot_id, input.ref.id, input.user_id);
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
           from grid_cells gc
           join grid_runs gr on gr.grid_run_id = gc.grid_run_id
           join research_grids g on g.grid_id = gr.grid_id
          where gc.snapshot_id = $1::uuid
            and g.user_id = $2::uuid
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
            fact_refs
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
  });
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
  return manifest.fact_refs;
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
    related_refs: Object.freeze([{ kind: "source", id: row.source_id }]),
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
            s.canonical_url
       from claims c
       join sources s on s.source_id = c.reported_by_source_id
      where c.claim_id = $1::uuid
        and (s.user_id is null or s.user_id = $2::uuid)`,
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
      { kind: "document", id: row.document_id },
      { kind: "source", id: row.reported_by_source_id },
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
    unit: string;
    period_kind: string;
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
            coalesce(f.value_text, f.value_num::text, '') as value,
            f.unit,
            f.period_kind,
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
      where f.fact_id = $1::uuid
        and f.entitlement_channels ? 'app'
        and (s.user_id is null or s.user_id = $2::uuid)`,
    [factId, userId],
  );
  const row = rows[0];
  if (!row) throw new EvidenceInspectionError(404, "fact not found");
  const period = [row.period_kind, row.fiscal_year, row.fiscal_period].filter((part) => part !== null).join(" ");
  return Object.freeze({
    snapshot_id: snapshotId,
    ref: Object.freeze({ kind: "fact", id: factId }),
    kind: "fact",
    title: `${row.value} ${row.unit}`.trim(),
    subtitle: period,
    badges: Object.freeze([row.verification_status, row.freshness_class, row.coverage_level]),
    rows: Object.freeze([
      { label: "Value", value: row.value },
      { label: "Unit", value: row.unit },
      { label: "As of", value: isoString(row.as_of) },
      { label: "Method", value: row.method },
      { label: "Confidence", value: String(row.confidence) },
    ]),
    links: sourceLinks(row.canonical_url),
    related_refs: Object.freeze([{ kind: "source", id: row.source_id }]),
  });
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
  if (
    typeof value !== "string" ||
    !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value)
  ) {
    throw new EvidenceInspectionError(400, `${label} must be a UUID`);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

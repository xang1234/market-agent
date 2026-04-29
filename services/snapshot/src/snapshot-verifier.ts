import { createHash } from "node:crypto";

import type {
  JsonObject,
  JsonValue,
  QueryExecutor,
  SnapshotBasis,
  SnapshotNormalization,
  SnapshotSubjectKind,
} from "./manifest-staging.ts";
import {
  SNAPSHOT_BASES,
  SNAPSHOT_NORMALIZATIONS,
  SNAPSHOT_SUBJECT_KINDS,
} from "./manifest-staging.ts";
import { compileDisclosurePolicy, type RequiredDisclosure } from "./disclosure-policy.ts";
import { validateSnapshotTransformManifest } from "./snapshot-transform.ts";

export type SnapshotVerifierManifest = {
  subject_refs: ReadonlyArray<{ kind: SnapshotSubjectKind; id: string }>;
  fact_refs: ReadonlyArray<string>;
  claim_refs: ReadonlyArray<string>;
  event_refs: ReadonlyArray<string>;
  document_refs: ReadonlyArray<string>;
  series_specs?: ReadonlyArray<JsonValue>;
  source_ids: ReadonlyArray<string>;
  as_of: string;
  basis: SnapshotBasis;
  normalization: SnapshotNormalization;
  allowed_transforms?: JsonValue;
};

export type VerifierFact = {
  fact_id: string;
  source_id?: string | null;
  unit?: string;
  period_kind?: string;
  period_start?: string | null;
  period_end?: string | null;
  fiscal_year?: number | null;
  fiscal_period?: string | null;
};

export type VerifierClaim = {
  claim_id: string;
  source_id?: string | null;
};

export type VerifierEvent = {
  event_id: string;
  source_ids?: ReadonlyArray<string>;
};

export type VerifierDocument = {
  document_id: string;
  source_id?: string | null;
};

export type VerifierSource = string | { source_id: string };

export type VerifierFactBinding = {
  fact_id: string;
  unit?: string;
  period_kind?: string;
  period_start?: string | null;
  period_end?: string | null;
  fiscal_year?: number | null;
  fiscal_period?: string | null;
};

export type VerifierSubjectRef = {
  kind: SnapshotSubjectKind;
  id: string;
};

export type VerifierBlock = {
  id: string;
  kind: string;
  snapshot_id: string;
  data_ref: {
    kind: string;
    id: string;
    params?: JsonObject;
  };
  source_refs: ReadonlyArray<string>;
  as_of: string;
  disclosure_tier?: string;
  items?: ReadonlyArray<unknown>;
  fact_refs?: ReadonlyArray<string>;
  claim_refs?: ReadonlyArray<string>;
  event_refs?: ReadonlyArray<string>;
  document_refs?: ReadonlyArray<string>;
  segments?: ReadonlyArray<unknown>;
  children?: ReadonlyArray<VerifierBlock>;
  bars?: ReadonlyArray<unknown>;
  distribution?: ReadonlyArray<unknown>;
  quarters?: ReadonlyArray<unknown>;
  analyst_count_ref?: string;
  current_price_ref?: string;
  low_ref?: string;
  avg_ref?: string;
  high_ref?: string;
  upside_ref?: string;
  subject_refs?: ReadonlyArray<VerifierSubjectRef>;
  subjects?: ReadonlyArray<VerifierSubjectRef>;
};

export type VerifierToolAction = {
  tool_call_id?: string | null;
  tool_name: string;
  read_only: boolean;
  approval_required?: boolean;
  approved?: boolean;
  pending_action_id?: string | null;
};

export type VerifierPendingAction = {
  pending_action_id: string;
  tool_name: string;
  bundle_id: string;
  audience: string;
  arguments?: JsonValue;
  approval_required: true;
  read_only: false;
  idempotency_key?: string;
};

export type SnapshotVerificationInput = {
  thread_id?: string | null;
  snapshot_id: string;
  manifest: SnapshotVerifierManifest;
  blocks: ReadonlyArray<VerifierBlock>;
  facts?: ReadonlyArray<VerifierFact>;
  claims?: ReadonlyArray<VerifierClaim>;
  events?: ReadonlyArray<VerifierEvent>;
  documents?: ReadonlyArray<VerifierDocument>;
  sources?: ReadonlyArray<VerifierSource>;
  required_disclosures?: ReadonlyArray<RequiredDisclosure>;
  tool_actions?: ReadonlyArray<VerifierToolAction>;
  pending_actions?: ReadonlyArray<VerifierPendingAction>;
};

export type SnapshotVerifierReasonCode =
  | "invalid_verifier_input"
  | "tool_call_log_audit_failed"
  | "missing_fact_ref"
  | "missing_subject_ref"
  | "missing_claim_ref"
  | "missing_event_ref"
  | "missing_document_ref"
  | "missing_source_ref"
  | "invalid_block_binding"
  | "block_after_snapshot_as_of"
  | "fact_binding_mismatch"
  | "missing_required_disclosure"
  | "unapproved_side_effect";

export type SnapshotVerifierFailure = {
  reason_code: SnapshotVerifierReasonCode;
  details: JsonObject;
};

export type SnapshotVerificationResult = {
  ok: boolean;
  failures: ReadonlyArray<SnapshotVerifierFailure>;
};

const UUID_V4 =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
const UUID_V5 =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-5[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
const ISO_8601_WITH_OFFSET =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|([+-])(\d{2}):(\d{2}))$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const FACT_PERIOD_KINDS = ["point", "fiscal_q", "fiscal_y", "ttm", "range"] as const;
const DISCLOSURE_REASON_CODES: ReadonlyArray<RequiredDisclosure["code"]> = [
  "delayed_pricing",
  "eod_pricing",
  "filing_time_basis",
  "low_coverage",
  "candidate_data",
  "fx_converted_values",
];
const DISCLOSURE_TIER_RANK: Record<RequiredDisclosure["tier"], number> = {
  real_time: 0,
  delayed_15m: 1,
  eod: 2,
  filing_time: 3,
  estimate: 4,
  candidate: 5,
  tertiary_source: 6,
};

const REGISTERED_BLOCK_KINDS = new Set([
  "rich_text",
  "section",
  "metric_row",
  "table",
  "line_chart",
  "revenue_bars",
  "perf_comparison",
  "segment_donut",
  "segment_trajectory",
  "metrics_comparison",
  "analyst_consensus",
  "price_target_range",
  "eps_surprise",
  "filings_list",
  "news_cluster",
  "finding_card",
  "sentiment_trend",
  "mention_volume",
  "sources",
  "disclosure",
]);

export async function verifySnapshotSeal(
  input: SnapshotVerificationInput,
  db?: QueryExecutor,
): Promise<SnapshotVerificationResult> {
  let normalized: NormalizedInput;
  try {
    normalized = normalizeInput(input);
  } catch (error) {
    return invalidVerifierInputResult(input, db, error);
  }
  const failures: SnapshotVerifierFailure[] = [];
  const addFailure = (reason_code: SnapshotVerifierReasonCode, details: JsonObject) => {
    failures.push(Object.freeze({ reason_code, details: Object.freeze(details) }));
  };

  try {
    verifyManifestRefs(normalized, addFailure);
    verifyBlockBindings(normalized, addFailure);
    verifyDisclosures(normalized, addFailure);
    verifyApprovals(normalized, addFailure);
  } catch (error) {
    return invalidVerifierInputResult(input, db, error);
  }

  const frozenFailures = Object.freeze([...failures]);
  if (db !== undefined) {
    for (const failure of frozenFailures) {
      await writeVerifierFailure(db, normalized, failure);
    }
  }

  return Object.freeze({
    ok: frozenFailures.length === 0,
    failures: frozenFailures,
  });
}

async function invalidVerifierInputResult(
  input: SnapshotVerificationInput,
  db: QueryExecutor | undefined,
  error: unknown,
): Promise<SnapshotVerificationResult> {
  const failure = Object.freeze({
    reason_code: "invalid_verifier_input" as const,
    details: Object.freeze({
      error: error instanceof Error ? error.message : String(error),
    }),
  });
  if (db !== undefined) {
    await writeRawVerifierFailure(db, input, failure);
  }
  return Object.freeze({
    ok: false,
    failures: Object.freeze([failure]),
  });
}

type NormalizedInput = Required<
  Omit<
    SnapshotVerificationInput,
    | "thread_id"
    | "facts"
    | "claims"
    | "events"
    | "documents"
    | "sources"
    | "required_disclosures"
    | "tool_actions"
    | "pending_actions"
  >
> & {
  thread_id: string | null;
  facts: ReadonlyArray<VerifierFact>;
  claims: ReadonlyArray<VerifierClaim>;
  events: ReadonlyArray<VerifierEvent>;
  documents: ReadonlyArray<VerifierDocument>;
  sources: ReadonlyArray<{ source_id: string }>;
  required_disclosures: ReadonlyArray<RequiredDisclosure>;
  tool_actions: ReadonlyArray<VerifierToolAction>;
  pending_actions: ReadonlyArray<VerifierPendingAction>;
};

function normalizeInput(input: SnapshotVerificationInput): NormalizedInput {
  if (input === null || typeof input !== "object") {
    throw new Error("verifySnapshotSeal: input must be an object");
  }

  const snapshotId = assertUuidV4(input.snapshot_id, "verifySnapshotSeal.snapshot_id");
  const manifest = normalizeManifest(input.manifest);
  assertArray<VerifierBlock>(input.blocks, "verifySnapshotSeal.blocks");
  const derivedDisclosures = compileDisclosurePolicy({
    snapshot_id: snapshotId,
    manifest,
    facts: (input.facts ?? []) as never,
  }).required_disclosures;
  const suppliedDisclosures = input.required_disclosures ?? [];
  assertArray<RequiredDisclosure>(
    suppliedDisclosures,
    "verifySnapshotSeal.required_disclosures",
  );
  const normalizedSuppliedDisclosures = suppliedDisclosures.map((disclosure, index) =>
    normalizeRequiredDisclosure(disclosure, index),
  );
  const requiredDisclosures = combineRequiredDisclosures(
    derivedDisclosures,
    normalizedSuppliedDisclosures,
  );

  return Object.freeze({
    thread_id:
      input.thread_id == null
        ? null
        : assertUuidV4(input.thread_id, "verifySnapshotSeal.thread_id"),
    snapshot_id: snapshotId,
    manifest,
    blocks: Object.freeze(input.blocks.map((block, index) => normalizeBlock(block, index))),
    facts: Object.freeze((input.facts ?? []).map((fact, index) => normalizeFact(fact, index))),
    claims: Object.freeze((input.claims ?? []).map((claim, index) => normalizeClaim(claim, index))),
    events: Object.freeze((input.events ?? []).map((event, index) => normalizeEvent(event, index))),
    documents: Object.freeze(
      (input.documents ?? []).map((document, index) => normalizeDocument(document, index)),
    ),
    sources: Object.freeze((input.sources ?? []).map((source, index) => normalizeSource(source, index))),
    required_disclosures: Object.freeze(requiredDisclosures),
    tool_actions: Object.freeze(
      (input.tool_actions ?? []).map((action, index) => normalizeToolAction(action, index)),
    ),
    pending_actions: Object.freeze(
      (input.pending_actions ?? []).map((action, index) => normalizePendingAction(action, index)),
    ),
  });
}

function normalizeManifest(manifest: SnapshotVerifierManifest): SnapshotVerifierManifest {
  if (manifest === null || typeof manifest !== "object") {
    throw new Error("verifySnapshotSeal.manifest: must be an object");
  }

  assertArray(manifest.subject_refs, "verifySnapshotSeal.manifest.subject_refs");
  assertArray<string>(manifest.fact_refs, "verifySnapshotSeal.manifest.fact_refs");
  assertArray<string>(manifest.claim_refs, "verifySnapshotSeal.manifest.claim_refs");
  assertArray<string>(manifest.event_refs, "verifySnapshotSeal.manifest.event_refs");
  assertArray<string>(manifest.document_refs ?? [], "verifySnapshotSeal.manifest.document_refs");
  assertArray<string>(manifest.source_ids, "verifySnapshotSeal.manifest.source_ids");

  const subject_refs = Object.freeze(
    manifest.subject_refs.map((subject, index) => {
      if (subject === null || typeof subject !== "object") {
        throw new Error(`verifySnapshotSeal.manifest.subject_refs[${index}]: must be an object`);
      }
      const kind = assertOneOf(
        subject.kind,
        SNAPSHOT_SUBJECT_KINDS,
        `verifySnapshotSeal.manifest.subject_refs[${index}].kind`,
      );
      return Object.freeze({
        kind,
        id: assertUuidV4(subject.id, `verifySnapshotSeal.manifest.subject_refs[${index}].id`),
      });
    }),
  );
  const as_of = canonicalTimestamp(manifest.as_of, "verifySnapshotSeal.manifest.as_of");
  const basis = assertOneOf(
    manifest.basis,
    SNAPSHOT_BASES,
    "verifySnapshotSeal.manifest.basis",
  );
  const normalization = assertOneOf(
    manifest.normalization,
    SNAPSHOT_NORMALIZATIONS,
    "verifySnapshotSeal.manifest.normalization",
  );

  if (manifest.allowed_transforms !== undefined) {
    validateSnapshotTransformManifest({
      subject_refs,
      as_of,
      basis,
      normalization,
      allowed_transforms: manifest.allowed_transforms,
    });
  }

  return Object.freeze({
    subject_refs,
    fact_refs: Object.freeze(
      manifest.fact_refs.map((ref, index) =>
        assertUuidV4(ref, `verifySnapshotSeal.manifest.fact_refs[${index}]`),
      ),
    ),
    claim_refs: Object.freeze(
      manifest.claim_refs.map((ref, index) =>
        assertUuidV4(ref, `verifySnapshotSeal.manifest.claim_refs[${index}]`),
      ),
    ),
    event_refs: Object.freeze(
      manifest.event_refs.map((ref, index) =>
        assertUuidV4(ref, `verifySnapshotSeal.manifest.event_refs[${index}]`),
      ),
    ),
    document_refs: Object.freeze(
      (manifest.document_refs ?? []).map((ref, index) =>
        assertUuidV4(ref, `verifySnapshotSeal.manifest.document_refs[${index}]`),
      ),
    ),
    source_ids: Object.freeze(
      manifest.source_ids.map((ref, index) =>
        assertUuidV4(ref, `verifySnapshotSeal.manifest.source_ids[${index}]`),
      ),
    ),
    ...(manifest.series_specs === undefined
      ? {}
      : {
          series_specs: Object.freeze(
            manifest.series_specs.map((spec, index) => {
              if (!isRecord(spec)) {
                throw new Error(`verifySnapshotSeal.manifest.series_specs[${index}]: must be an object`);
              }
              return cloneJsonObject(
                spec as JsonObject,
                `verifySnapshotSeal.manifest.series_specs[${index}]`,
              );
            }),
          ),
        }),
    as_of,
    basis,
    normalization,
  });
}

function combineRequiredDisclosures(
  derived: ReadonlyArray<RequiredDisclosure>,
  supplied: ReadonlyArray<RequiredDisclosure>,
): ReadonlyArray<RequiredDisclosure> {
  const seen = new Set<string>();
  const result: RequiredDisclosure[] = [];
  for (const disclosure of [...derived, ...supplied]) {
    const key = stableJson({
      code: disclosure.code,
      item: disclosure.item,
      tier: disclosure.tier,
      source_refs: [...disclosure.source_refs],
    });
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(disclosure);
  }
  return Object.freeze(result);
}

function normalizeSubjectRef(subject: VerifierSubjectRef, label: string): VerifierSubjectRef {
  if (subject === null || typeof subject !== "object") {
    throw new Error(`${label}: must be an object`);
  }
  return Object.freeze({
    kind: assertOneOf(subject.kind, SNAPSHOT_SUBJECT_KINDS, `${label}.kind`),
    id: assertUuidV4(subject.id, `${label}.id`),
  });
}

function normalizeBlock(block: VerifierBlock, index: number): VerifierBlock {
  if (block === null || typeof block !== "object") {
    throw new Error(`verifySnapshotSeal.blocks[${index}]: must be an object`);
  }
  if (block.data_ref === null || typeof block.data_ref !== "object") {
    throw new Error(`verifySnapshotSeal.blocks[${index}].data_ref: must be an object`);
  }
  assertArray<string>(block.source_refs, `verifySnapshotSeal.blocks[${index}].source_refs`);
  const items = optionalArray<unknown>(block.items, `verifySnapshotSeal.blocks[${index}].items`);
  const segments = optionalArray<unknown>(block.segments, `verifySnapshotSeal.blocks[${index}].segments`);
  const children = optionalArray<VerifierBlock>(block.children, `verifySnapshotSeal.blocks[${index}].children`);
  const bars = optionalArray<unknown>(block.bars, `verifySnapshotSeal.blocks[${index}].bars`);
  const distribution = optionalArray<unknown>(block.distribution, `verifySnapshotSeal.blocks[${index}].distribution`);
  const quarters = optionalArray<unknown>(block.quarters, `verifySnapshotSeal.blocks[${index}].quarters`);
  const subjectRefs = optionalArray<VerifierSubjectRef>(
    block.subject_refs,
    `verifySnapshotSeal.blocks[${index}].subject_refs`,
  );
  const subjects = optionalArray<VerifierSubjectRef>(
    block.subjects,
    `verifySnapshotSeal.blocks[${index}].subjects`,
  );
  const factRefs = optionalArray<string>(block.fact_refs, `verifySnapshotSeal.blocks[${index}].fact_refs`);
  const claimRefs = optionalArray<string>(block.claim_refs, `verifySnapshotSeal.blocks[${index}].claim_refs`);
  const eventRefs = optionalArray<string>(block.event_refs, `verifySnapshotSeal.blocks[${index}].event_refs`);
  const documentRefs = optionalArray<string>(
    block.document_refs,
    `verifySnapshotSeal.blocks[${index}].document_refs`,
  );
  const dataRefParams =
    block.data_ref.params === undefined
      ? undefined
      : assertPlainJsonObject(
          block.data_ref.params,
          `verifySnapshotSeal.blocks[${index}].data_ref.params`,
        );

  return Object.freeze({
    id: assertNonEmptyString(block.id, `verifySnapshotSeal.blocks[${index}].id`),
    kind: assertNonEmptyString(block.kind, `verifySnapshotSeal.blocks[${index}].kind`),
    snapshot_id: assertUuidV4(block.snapshot_id, `verifySnapshotSeal.blocks[${index}].snapshot_id`),
    data_ref: Object.freeze({
      kind: assertNonEmptyString(block.data_ref.kind, `verifySnapshotSeal.blocks[${index}].data_ref.kind`),
      id: assertNonEmptyString(block.data_ref.id, `verifySnapshotSeal.blocks[${index}].data_ref.id`),
      ...(dataRefParams === undefined
        ? {}
        : { params: cloneJsonObject(dataRefParams, `verifySnapshotSeal.blocks[${index}].data_ref.params`) }),
    }),
    source_refs: Object.freeze(
      block.source_refs.map((ref, refIndex) =>
        assertUuidV4(ref, `verifySnapshotSeal.blocks[${index}].source_refs[${refIndex}]`),
      ),
    ),
    as_of: canonicalTimestamp(block.as_of, `verifySnapshotSeal.blocks[${index}].as_of`),
    ...(block.disclosure_tier === undefined ? {} : { disclosure_tier: block.disclosure_tier }),
    ...(items === undefined ? {} : { items: Object.freeze([...items]) }),
    ...(segments === undefined ? {} : { segments: Object.freeze([...segments]) }),
    ...(children === undefined
      ? {}
      : { children: Object.freeze(children.map((child, childIndex) => normalizeBlock(child, childIndex))) }),
    ...(bars === undefined ? {} : { bars: Object.freeze([...bars]) }),
    ...(distribution === undefined ? {} : { distribution: Object.freeze([...distribution]) }),
    ...(quarters === undefined ? {} : { quarters: Object.freeze([...quarters]) }),
    ...(block.analyst_count_ref === undefined
      ? {}
      : { analyst_count_ref: assertUuidV4(block.analyst_count_ref, `verifySnapshotSeal.blocks[${index}].analyst_count_ref`) }),
    ...(block.current_price_ref === undefined
      ? {}
      : { current_price_ref: assertUuidV4(block.current_price_ref, `verifySnapshotSeal.blocks[${index}].current_price_ref`) }),
    ...(block.low_ref === undefined
      ? {}
      : { low_ref: assertUuidV4(block.low_ref, `verifySnapshotSeal.blocks[${index}].low_ref`) }),
    ...(block.avg_ref === undefined
      ? {}
      : { avg_ref: assertUuidV4(block.avg_ref, `verifySnapshotSeal.blocks[${index}].avg_ref`) }),
    ...(block.high_ref === undefined
      ? {}
      : { high_ref: assertUuidV4(block.high_ref, `verifySnapshotSeal.blocks[${index}].high_ref`) }),
    ...(block.upside_ref === undefined
      ? {}
      : { upside_ref: assertUuidV4(block.upside_ref, `verifySnapshotSeal.blocks[${index}].upside_ref`) }),
    ...(subjectRefs === undefined
      ? {}
      : { subject_refs: Object.freeze(subjectRefs.map((ref, refIndex) => normalizeSubjectRef(ref, `verifySnapshotSeal.blocks[${index}].subject_refs[${refIndex}]`))) }),
    ...(subjects === undefined
      ? {}
      : { subjects: Object.freeze(subjects.map((ref, refIndex) => normalizeSubjectRef(ref, `verifySnapshotSeal.blocks[${index}].subjects[${refIndex}]`))) }),
    ...(factRefs === undefined
      ? {}
      : { fact_refs: Object.freeze(factRefs.map((ref, refIndex) => assertUuidV4(ref, `verifySnapshotSeal.blocks[${index}].fact_refs[${refIndex}]`))) }),
    ...(claimRefs === undefined
      ? {}
      : { claim_refs: Object.freeze(claimRefs.map((ref, refIndex) => assertUuidV4(ref, `verifySnapshotSeal.blocks[${index}].claim_refs[${refIndex}]`))) }),
    ...(eventRefs === undefined
      ? {}
      : { event_refs: Object.freeze(eventRefs.map((ref, refIndex) => assertUuidV4(ref, `verifySnapshotSeal.blocks[${index}].event_refs[${refIndex}]`))) }),
    ...(documentRefs === undefined
      ? {}
      : { document_refs: Object.freeze(documentRefs.map((ref, refIndex) => assertUuidV4(ref, `verifySnapshotSeal.blocks[${index}].document_refs[${refIndex}]`))) }),
  });
}

function normalizeFact(fact: VerifierFact, index: number): VerifierFact {
  if (fact === null || typeof fact !== "object") {
    throw new Error(`verifySnapshotSeal.facts[${index}]: must be an object`);
  }
  return Object.freeze({
    fact_id: assertUuidV4(fact.fact_id, `verifySnapshotSeal.facts[${index}].fact_id`),
    ...(fact.source_id == null ? {} : { source_id: assertUuidV4(fact.source_id, `verifySnapshotSeal.facts[${index}].source_id`) }),
    ...(fact.unit === undefined ? {} : { unit: assertNonEmptyString(fact.unit, `verifySnapshotSeal.facts[${index}].unit`) }),
    ...(fact.period_kind === undefined
      ? {}
      : { period_kind: assertFactPeriodKind(fact.period_kind, `verifySnapshotSeal.facts[${index}].period_kind`) }),
    ...(fact.period_start === undefined
      ? {}
      : { period_start: nullableDateString(fact.period_start, `verifySnapshotSeal.facts[${index}].period_start`) }),
    ...(fact.period_end === undefined
      ? {}
      : { period_end: nullableDateString(fact.period_end, `verifySnapshotSeal.facts[${index}].period_end`) }),
    ...(fact.fiscal_year === undefined
      ? {}
      : { fiscal_year: nullableInteger(fact.fiscal_year, `verifySnapshotSeal.facts[${index}].fiscal_year`) }),
    ...(fact.fiscal_period === undefined
      ? {}
      : { fiscal_period: nullableString(fact.fiscal_period, `verifySnapshotSeal.facts[${index}].fiscal_period`) }),
  });
}

function normalizeClaim(claim: VerifierClaim, index: number): VerifierClaim {
  if (claim === null || typeof claim !== "object") {
    throw new Error(`verifySnapshotSeal.claims[${index}]: must be an object`);
  }
  return Object.freeze({
    claim_id: assertUuidV4(claim.claim_id, `verifySnapshotSeal.claims[${index}].claim_id`),
    ...(claim.source_id == null ? {} : { source_id: assertUuidV4(claim.source_id, `verifySnapshotSeal.claims[${index}].source_id`) }),
  });
}

function normalizeEvent(event: VerifierEvent, index: number): VerifierEvent {
  if (event === null || typeof event !== "object") {
    throw new Error(`verifySnapshotSeal.events[${index}]: must be an object`);
  }
  return Object.freeze({
    event_id: assertUuidV4(event.event_id, `verifySnapshotSeal.events[${index}].event_id`),
    source_ids: Object.freeze(
      (event.source_ids ?? []).map((sourceId, sourceIndex) =>
        assertUuidV4(sourceId, `verifySnapshotSeal.events[${index}].source_ids[${sourceIndex}]`),
      ),
    ),
  });
}

function normalizeDocument(document: VerifierDocument, index: number): VerifierDocument {
  if (document === null || typeof document !== "object") {
    throw new Error(`verifySnapshotSeal.documents[${index}]: must be an object`);
  }
  return Object.freeze({
    document_id: assertUuidV4(document.document_id, `verifySnapshotSeal.documents[${index}].document_id`),
    ...(document.source_id == null
      ? {}
      : { source_id: assertUuidV4(document.source_id, `verifySnapshotSeal.documents[${index}].source_id`) }),
  });
}

function normalizeSource(source: VerifierSource, index: number): { source_id: string } {
  if (typeof source === "string") {
    return Object.freeze({
      source_id: assertUuidV4(source, `verifySnapshotSeal.sources[${index}]`),
    });
  }
  if (source === null || typeof source !== "object") {
    throw new Error(`verifySnapshotSeal.sources[${index}]: must be a source id or object`);
  }
  return Object.freeze({
    source_id: assertUuidV4(source.source_id, `verifySnapshotSeal.sources[${index}].source_id`),
  });
}

function normalizeRequiredDisclosure(
  disclosure: RequiredDisclosure,
  index: number,
): RequiredDisclosure {
  if (disclosure === null || typeof disclosure !== "object" || Array.isArray(disclosure)) {
    throw new Error(`verifySnapshotSeal.required_disclosures[${index}]: must be an object`);
  }
  assertArray<string>(
    disclosure.fact_refs,
    `verifySnapshotSeal.required_disclosures[${index}].fact_refs`,
  );
  assertArray<string>(
    disclosure.series_refs,
    `verifySnapshotSeal.required_disclosures[${index}].series_refs`,
  );
  assertArray<string>(
    disclosure.source_refs,
    `verifySnapshotSeal.required_disclosures[${index}].source_refs`,
  );

  return Object.freeze({
    code: assertDisclosureReasonCode(
      disclosure.code,
      `verifySnapshotSeal.required_disclosures[${index}].code`,
    ),
    tier: assertDisclosureTier(
      disclosure.tier,
      `verifySnapshotSeal.required_disclosures[${index}].tier`,
    ),
    item: assertNonEmptyString(
      disclosure.item,
      `verifySnapshotSeal.required_disclosures[${index}].item`,
    ),
    fact_refs: Object.freeze(
      disclosure.fact_refs.map((factId, refIndex) =>
        assertUuidV4(
          factId,
          `verifySnapshotSeal.required_disclosures[${index}].fact_refs[${refIndex}]`,
        ),
      ),
    ),
    series_refs: Object.freeze(
      disclosure.series_refs.map((seriesRef, refIndex) =>
        assertUuidV4(
          seriesRef,
          `verifySnapshotSeal.required_disclosures[${index}].series_refs[${refIndex}]`,
        ),
      ),
    ),
    source_refs: Object.freeze(
      disclosure.source_refs.map((sourceId, refIndex) =>
        assertUuidV4(
          sourceId,
          `verifySnapshotSeal.required_disclosures[${index}].source_refs[${refIndex}]`,
        ),
      ),
    ),
  });
}

function normalizeToolAction(action: VerifierToolAction, index: number): VerifierToolAction {
  if (action === null || typeof action !== "object") {
    throw new Error(`verifySnapshotSeal.tool_actions[${index}]: must be an object`);
  }
  return Object.freeze({
    ...(action.tool_call_id == null
      ? {}
      : { tool_call_id: assertUuidV4(action.tool_call_id, `verifySnapshotSeal.tool_actions[${index}].tool_call_id`) }),
    tool_name: assertNonEmptyString(action.tool_name, `verifySnapshotSeal.tool_actions[${index}].tool_name`),
    read_only: assertBoolean(action.read_only, `verifySnapshotSeal.tool_actions[${index}].read_only`),
    ...(action.approval_required === undefined
      ? {}
      : { approval_required: assertBoolean(action.approval_required, `verifySnapshotSeal.tool_actions[${index}].approval_required`) }),
    ...(action.approved === undefined
      ? {}
      : { approved: assertBoolean(action.approved, `verifySnapshotSeal.tool_actions[${index}].approved`) }),
    ...(action.pending_action_id == null
      ? {}
      : { pending_action_id: assertUuidV5(action.pending_action_id, `verifySnapshotSeal.tool_actions[${index}].pending_action_id`) }),
  });
}

function normalizePendingAction(action: VerifierPendingAction, index: number): VerifierPendingAction {
  if (action === null || typeof action !== "object") {
    throw new Error(`verifySnapshotSeal.pending_actions[${index}]: must be an object`);
  }
  const normalized = {
    pending_action_id: assertUuidV5(
      action.pending_action_id,
      `verifySnapshotSeal.pending_actions[${index}].pending_action_id`,
    ),
    tool_name: assertNonEmptyString(
      action.tool_name,
      `verifySnapshotSeal.pending_actions[${index}].tool_name`,
    ),
    bundle_id: assertNonEmptyString(
      action.bundle_id,
      `verifySnapshotSeal.pending_actions[${index}].bundle_id`,
    ),
    audience: assertNonEmptyString(
      action.audience,
      `verifySnapshotSeal.pending_actions[${index}].audience`,
    ),
    ...(action.arguments === undefined
      ? {}
      : {
          arguments: cloneJsonValue(
            action.arguments,
            `verifySnapshotSeal.pending_actions[${index}].arguments`,
          ),
        }),
    approval_required: assertBoolean(
      action.approval_required,
      `verifySnapshotSeal.pending_actions[${index}].approval_required`,
    ),
    read_only: assertBoolean(
      action.read_only,
      `verifySnapshotSeal.pending_actions[${index}].read_only`,
    ),
    ...(action.idempotency_key === undefined
      ? {}
      : {
          idempotency_key: assertNonEmptyString(
            action.idempotency_key,
            `verifySnapshotSeal.pending_actions[${index}].idempotency_key`,
          ),
        }),
  };
  if (normalized.approval_required !== true) {
    throw new Error(`verifySnapshotSeal.pending_actions[${index}].approval_required: must be true`);
  }
  if (normalized.read_only !== false) {
    throw new Error(`verifySnapshotSeal.pending_actions[${index}].read_only: must be false`);
  }
  return Object.freeze(normalized);
}

function verifyManifestRefs(
  input: NormalizedInput,
  addFailure: (reason: SnapshotVerifierReasonCode, details: JsonObject) => void,
): void {
  const factIds = new Set(input.facts.map((fact) => fact.fact_id));
  const claimIds = new Set(input.claims.map((claim) => claim.claim_id));
  const eventIds = new Set(input.events.map((event) => event.event_id));
  const documents = new Map(input.documents.map((document) => [document.document_id, document]));
  const sourceIds = new Set(input.sources.map((source) => source.source_id));
  const manifestSources = new Set(input.manifest.source_ids);
  const renderedFactIds = factRefsForRenderedBlocks(input.blocks);

  validateManifestSeriesSpecs(input, sourceIds, manifestSources, addFailure);

  for (const fact_id of input.manifest.fact_refs) {
    if (!factIds.has(fact_id)) addFailure("missing_fact_ref", { fact_id });
  }
  for (const claim_id of input.manifest.claim_refs) {
    if (!claimIds.has(claim_id)) addFailure("missing_claim_ref", { claim_id });
  }
  for (const event_id of input.manifest.event_refs) {
    if (!eventIds.has(event_id)) addFailure("missing_event_ref", { event_id });
  }
  for (const document_id of input.manifest.document_refs) {
    const document = documents.get(document_id);
    if (document === undefined) {
      addFailure("missing_document_ref", { document_id, scope: "manifest" });
      continue;
    }
    if (document.source_id == null) {
      addFailure("missing_source_ref", {
        document_id,
        source_id: null,
        scope: "document",
      });
      continue;
    }
    if (!sourceIds.has(document.source_id)) {
      addFailure("missing_source_ref", {
        document_id,
        source_id: document.source_id,
        scope: "document_source",
      });
    }
    if (!manifestSources.has(document.source_id)) {
      addFailure("missing_source_ref", {
        document_id,
        source_id: document.source_id,
        scope: "document_manifest_source",
      });
    }
  }
  for (const source_id of input.manifest.source_ids) {
    if (!sourceIds.has(source_id)) addFailure("missing_source_ref", { source_id, scope: "manifest" });
  }
  for (const fact of input.facts) {
    if (!input.manifest.fact_refs.includes(fact.fact_id)) continue;
    if (fact.source_id == null) {
      addFailure("missing_source_ref", {
        fact_id: fact.fact_id,
        source_id: null,
        scope: "fact",
      });
    } else {
      if (!sourceIds.has(fact.source_id)) {
        addFailure("missing_source_ref", {
          fact_id: fact.fact_id,
          source_id: fact.source_id,
          scope: "fact",
        });
      }
      if (!manifestSources.has(fact.source_id)) {
        addFailure("missing_source_ref", {
          fact_id: fact.fact_id,
          source_id: fact.source_id,
          scope: "fact_manifest",
        });
      }
    }
    const mismatches = factMetadataMismatch(fact);
    if (mismatches.length > 0 && !renderedFactIds.has(fact.fact_id)) {
      addFailure("fact_binding_mismatch", {
        fact_id: fact.fact_id,
        mismatches,
        scope: "fact",
      });
    }
  }
  for (const claim of input.claims) {
    if (!input.manifest.claim_refs.includes(claim.claim_id)) continue;
    if (claim.source_id == null) {
      addFailure("missing_source_ref", {
        claim_id: claim.claim_id,
        source_id: null,
        scope: "claim",
      });
      continue;
    }
    if (!sourceIds.has(claim.source_id)) {
      addFailure("missing_source_ref", {
        claim_id: claim.claim_id,
        source_id: claim.source_id,
        scope: "claim",
      });
    }
    if (!manifestSources.has(claim.source_id)) {
      addFailure("missing_source_ref", {
        claim_id: claim.claim_id,
        source_id: claim.source_id,
        scope: "claim_manifest",
      });
    }
  }
  for (const event of input.events) {
    if (!input.manifest.event_refs.includes(event.event_id)) continue;
    if ((event.source_ids ?? []).length === 0) {
      addFailure("missing_source_ref", {
        event_id: event.event_id,
        source_id: null,
        scope: "event",
      });
    }
    for (const source_id of event.source_ids ?? []) {
      if (!sourceIds.has(source_id)) {
        addFailure("missing_source_ref", {
          event_id: event.event_id,
          source_id,
          scope: "event",
        });
      }
      if (!manifestSources.has(source_id)) {
        addFailure("missing_source_ref", {
          event_id: event.event_id,
          source_id,
          scope: "event_manifest",
        });
      }
    }
  }
}

function factRefsForRenderedBlocks(blocks: ReadonlyArray<VerifierBlock>): ReadonlySet<string> {
  const factIds = new Set<string>();
  for (const block of flattenBlocks(blocks)) {
    for (const { ref_id } of extractedRefsForBlock(block, "fact")) {
      factIds.add(ref_id);
    }
    for (const binding of factBindingsForBlock(block)) {
      factIds.add(binding.fact_id);
    }
  }
  return factIds;
}

function validateManifestSeriesSpecs(
  input: NormalizedInput,
  sourceIds: ReadonlySet<string>,
  manifestSources: ReadonlySet<string>,
  addFailure: (reason: SnapshotVerifierReasonCode, details: JsonObject) => void,
): void {
  for (const spec of input.manifest.series_specs ?? []) {
    if (!isRecord(spec)) continue;
    const series_ref =
      spec.series_ref === undefined
        ? null
        : assertUuidV4(spec.series_ref, "verifySnapshotSeal.manifest.series_specs.series_ref");
    if (spec.source_id == null) {
      if (series_ref === null && input.manifest.source_ids.length > 0) {
        continue;
      }
      addFailure("missing_source_ref", {
        series_ref,
        source_id: null,
        scope: "series",
      });
      continue;
    }
    const source_id = assertUuidV4(spec.source_id, "verifySnapshotSeal.manifest.series_specs.source_id");
    if (!sourceIds.has(source_id)) {
      addFailure("missing_source_ref", {
        series_ref,
        source_id,
        scope: "series_source",
      });
    }
    if (!manifestSources.has(source_id)) {
      addFailure("missing_source_ref", {
        series_ref,
        source_id,
        scope: "series_manifest_source",
      });
    }
  }
}

function verifyBlockBindings(
  input: NormalizedInput,
  addFailure: (reason: SnapshotVerifierReasonCode, details: JsonObject) => void,
): void {
  const manifestFacts = new Set(input.manifest.fact_refs);
  const manifestSubjects = new Set(input.manifest.subject_refs.map(subjectRefKey));
  const manifestClaims = new Set(input.manifest.claim_refs);
  const manifestEvents = new Set(input.manifest.event_refs);
  const manifestDocuments = new Set(input.manifest.document_refs);
  const manifestSources = new Set(input.manifest.source_ids);
  const manifestSeriesRefs = seriesRefsForManifest(input.manifest);
  const reportedMissingFacts = new Set<string>();
  const addMissingFactFailure = (block: VerifierBlock, fact_id: string) => {
    const key = `${block.id}:${fact_id}`;
    if (reportedMissingFacts.has(key)) return;
    reportedMissingFacts.add(key);
    addFailure("missing_fact_ref", { block_id: block.id, fact_id });
  };
  const sourceIds = new Set(input.sources.map((source) => source.source_id));
  const facts = new Map(input.facts.map((fact) => [fact.fact_id, fact]));
  const claims = new Map(input.claims.map((claim) => [claim.claim_id, claim]));
  const events = new Map(input.events.map((event) => [event.event_id, event]));
  const documents = new Map(input.documents.map((document) => [document.document_id, document]));
  const snapshotAsOf = Date.parse(input.manifest.as_of);
  const reportedBlockFactSources = new Set<string>();
  const addBlockFactSourceFailure = (block: VerifierBlock, fact_id: string, source_id: string) => {
    const key = `${block.id}:${fact_id}:${source_id}`;
    if (reportedBlockFactSources.has(key)) return;
    reportedBlockFactSources.add(key);
    addFailure("missing_source_ref", {
      block_id: block.id,
      fact_id,
      source_id,
      scope: "block_fact_source",
    });
  };

  for (const block of flattenBlocks(input.blocks)) {
    if (!REGISTERED_BLOCK_KINDS.has(block.kind)) {
      addFailure("invalid_block_binding", {
        block_id: block.id,
        field: "kind",
        reason: "unknown_block_kind",
        actual: block.kind,
      });
    }
    if (block.snapshot_id !== input.snapshot_id) {
      addFailure("invalid_block_binding", {
        block_id: block.id,
        field: "snapshot_id",
        expected: input.snapshot_id,
        actual: block.snapshot_id,
      });
    }
    if (Date.parse(block.as_of) > snapshotAsOf) {
      addFailure("block_after_snapshot_as_of", {
        block_id: block.id,
        block_as_of: block.as_of,
        snapshot_as_of: input.manifest.as_of,
      });
    }
    for (const source_id of block.source_refs) {
      if (!sourceIds.has(source_id)) {
        addFailure("missing_source_ref", {
          block_id: block.id,
          source_id,
          scope: "block_source",
        });
      }
      if (!manifestSources.has(source_id)) {
        addFailure("missing_source_ref", {
          block_id: block.id,
          source_id,
          scope: "block",
        });
      }
    }
    for (const subject_ref of blockSubjectRefs(block)) {
      if (!manifestSubjects.has(subjectRefKey(subject_ref))) {
        addFailure("missing_subject_ref", {
          block_id: block.id,
          subject_ref,
        });
      }
    }
    const factRefs = extractedRefsForBlock(block, "fact");
    const factBindings = factBindingsForBlock(block);
    verifyDataRefBinding(
      block,
      input.snapshot_id,
      manifestSeriesRefs,
      sourceIds,
      manifestSources,
      factRefs,
      factBindings,
      addFailure,
    );
    const factBindingIds = new Set(factBindings.map((binding) => binding.fact_id));
    for (const { ref_id: fact_id } of factRefs) {
      if (!manifestFacts.has(fact_id)) addMissingFactFailure(block, fact_id);
      const fact = facts.get(fact_id);
      if (fact?.source_id != null && !block.source_refs.includes(fact.source_id)) {
        addBlockFactSourceFailure(block, fact_id, fact.source_id);
      }
      if (fact !== undefined && manifestFacts.has(fact_id) && !factBindingIds.has(fact_id)) {
        addFailure("fact_binding_mismatch", {
          block_id: block.id,
          fact_id,
          mismatches: ["missing_binding"],
        });
      }
    }
    for (const { ref_id: claim_id } of extractedRefsForBlock(block, "claim")) {
      if (!manifestClaims.has(claim_id)) addFailure("missing_claim_ref", { block_id: block.id, claim_id });
      const claim = claims.get(claim_id);
      if (claim?.source_id != null && !block.source_refs.includes(claim.source_id)) {
        addFailure("missing_source_ref", {
          block_id: block.id,
          claim_id,
          source_id: claim.source_id,
          scope: "block_claim_source",
        });
      }
    }
    for (const { ref_id: event_id } of extractedRefsForBlock(block, "event")) {
      if (!manifestEvents.has(event_id)) addFailure("missing_event_ref", { block_id: block.id, event_id });
      const event = events.get(event_id);
      for (const source_id of event?.source_ids ?? []) {
        if (!block.source_refs.includes(source_id)) {
          addFailure("missing_source_ref", {
            block_id: block.id,
            event_id,
            source_id,
            scope: "block_event_source",
          });
        }
      }
    }
    for (const { ref_id: document_id } of extractedRefsForBlock(block, "document")) {
      if (!manifestDocuments.has(document_id)) {
        addFailure("missing_document_ref", { block_id: block.id, document_id });
        continue;
      }
      const document = documents.get(document_id);
      if (document?.source_id != null && !block.source_refs.includes(document.source_id)) {
        addFailure("missing_source_ref", {
          block_id: block.id,
          document_id,
          source_id: document.source_id,
          scope: "block_document_source",
        });
      }
    }
    for (const { ref_id: source_id } of extractedRefsForBlock(block, "source")) {
      if (!sourceIds.has(source_id)) {
        addFailure("missing_source_ref", {
          block_id: block.id,
          source_id,
          scope: "block_source",
        });
      }
      if (!manifestSources.has(source_id)) {
        addFailure("missing_source_ref", {
          block_id: block.id,
          source_id,
          scope: "block_source_manifest",
        });
      }
      if (!block.source_refs.includes(source_id)) {
        addFailure("missing_source_ref", {
          block_id: block.id,
          source_id,
          scope: "block_source_ref",
        });
      }
    }

    for (const binding of factBindings) {
      const fact = facts.get(binding.fact_id);
      if (!manifestFacts.has(binding.fact_id)) {
        addMissingFactFailure(block, binding.fact_id);
        continue;
      }
      if (fact === undefined) {
        addMissingFactFailure(block, binding.fact_id);
        continue;
      }
      if (fact.source_id != null && !block.source_refs.includes(fact.source_id)) {
        addBlockFactSourceFailure(block, binding.fact_id, fact.source_id);
      }
      const mismatch = factBindingMismatch(fact, binding);
      if (mismatch.length > 0) {
        addFailure("fact_binding_mismatch", {
          block_id: block.id,
          fact_id: binding.fact_id,
          mismatches: mismatch,
        });
      }
    }
  }
}

function flattenBlocks(blocks: ReadonlyArray<VerifierBlock>): VerifierBlock[] {
  const flattened: VerifierBlock[] = [];
  for (const block of blocks) {
    flattened.push(block);
    flattened.push(...flattenBlocks(block.children ?? []));
  }
  return flattened;
}

function blockSubjectRefs(block: VerifierBlock): ReadonlyArray<VerifierSubjectRef> {
  return Object.freeze([...(block.subject_refs ?? []), ...(block.subjects ?? [])]);
}

function subjectRefKey(subject: VerifierSubjectRef): string {
  return `${subject.kind}:${subject.id}`;
}

function verifyDataRefBinding(
  block: VerifierBlock,
  snapshotId: string,
  manifestSeriesRefs: ReadonlyMap<string, string | null>,
  sourceIds: ReadonlySet<string>,
  manifestSources: ReadonlySet<string>,
  factRefs: ReadonlyArray<ExtractedBlockRef>,
  factBindings: ReadonlyArray<VerifierFactBinding>,
  addFailure: (reason: SnapshotVerifierReasonCode, details: JsonObject) => void,
): void {
  if (!dataRefKindMatchesBlock(block)) {
    addFailure("invalid_block_binding", {
      block_id: block.id,
      field: "data_ref.kind",
      expected: expectedDataRefKind(block),
      actual: block.data_ref.kind,
    });
  }

  const seriesRefs = dataRefSeriesRefs(block.data_ref.params);
  const sealedSeriesRefs = seriesRefs.filter((seriesRef) => manifestSeriesRefs.has(seriesRef));
  for (const series_ref of seriesRefs) {
    if (!manifestSeriesRefs.has(series_ref)) {
      addFailure("invalid_block_binding", {
        block_id: block.id,
        field: "data_ref.series_refs",
        series_ref,
      });
      continue;
    }
    const source_id = manifestSeriesRefs.get(series_ref) ?? null;
    if (source_id === null) {
      addFailure("missing_source_ref", {
        block_id: block.id,
        series_ref,
        source_id,
        scope: "series",
      });
      continue;
    }
    if (!sourceIds.has(source_id)) {
      addFailure("missing_source_ref", {
        block_id: block.id,
        series_ref,
        source_id,
        scope: "series_source",
      });
    }
    if (!manifestSources.has(source_id)) {
      addFailure("missing_source_ref", {
        block_id: block.id,
        series_ref,
        source_id,
        scope: "series_manifest_source",
      });
    }
    if (!block.source_refs.includes(source_id)) {
      addFailure("missing_source_ref", {
        block_id: block.id,
        series_ref,
        source_id,
        scope: "block_series_source",
      });
    }
  }

  if (
    requiresSealedDataSupport(block) &&
    factRefs.length === 0 &&
    factBindings.length === 0 &&
    sealedSeriesRefs.length === 0
  ) {
    addFailure("invalid_block_binding", {
      block_id: block.id,
      field: "data_ref",
      reason: "missing_sealed_series_or_refs",
    });
  }

  const dataSnapshotId = block.data_ref.params?.snapshot_id;
  if (
    dataSnapshotId !== undefined &&
    (typeof dataSnapshotId !== "string" ||
      !UUID_V4.test(dataSnapshotId) ||
      dataSnapshotId.toLowerCase() !== snapshotId)
  ) {
    addFailure("invalid_block_binding", {
      block_id: block.id,
      field: "data_ref.params.snapshot_id",
      expected: snapshotId,
      actual: dataSnapshotId,
    });
  }
}

function expectedDataRefKind(block: VerifierBlock): string {
  return block.kind === "disclosure" ? "disclosure_policy" : block.kind;
}

function dataRefKindMatchesBlock(block: VerifierBlock): boolean {
  if (block.kind === "disclosure") {
    return block.data_ref.kind === "disclosure_policy" || block.data_ref.kind === "disclosure";
  }
  return block.data_ref.kind === expectedDataRefKind(block);
}

function requiresSealedDataSupport(block: VerifierBlock): boolean {
  return [
    "line_chart",
    "table",
    "perf_comparison",
    "segment_trajectory",
    "metrics_comparison",
    "sentiment_trend",
    "mention_volume",
  ].includes(block.kind);
}

function dataRefSeriesRefs(params: JsonObject | undefined): string[] {
  if (params === undefined) return [];
  const refs: string[] = [];
  const { series_ref, series_refs } = params;
  if (series_ref !== undefined) {
    refs.push(assertUuidV4(series_ref, "verifySnapshotSeal.data_ref.params.series_ref"));
  }
  if (series_refs !== undefined) {
    if (!Array.isArray(series_refs)) {
      throw new Error("verifySnapshotSeal.data_ref.params.series_refs: must be an array");
    }
    for (const [index, value] of series_refs.entries()) {
      refs.push(assertUuidV4(value, `verifySnapshotSeal.data_ref.params.series_refs[${index}]`));
    }
  }
  return refs;
}

function seriesRefsForManifest(manifest: SnapshotVerifierManifest): ReadonlyMap<string, string | null> {
  const refs = new Map<string, string | null>();
  for (const spec of manifest.series_specs ?? []) {
    if (!isRecord(spec)) continue;
    if (typeof spec.series_ref === "string") {
      refs.set(
        assertUuidV4(spec.series_ref, "verifySnapshotSeal.manifest.series_specs.series_ref"),
        spec.source_id == null
          ? null
          : assertUuidV4(spec.source_id, "verifySnapshotSeal.manifest.series_specs.source_id"),
      );
    }
  }
  return refs;
}

type ExtractedBlockRef = {
  ref_kind: "fact" | "claim" | "event" | "document" | "source";
  ref_id: string;
};

function extractedRefsForBlock(
  block: VerifierBlock,
  refKind: ExtractedBlockRef["ref_kind"],
): ReadonlyArray<ExtractedBlockRef> {
  return extractBlockRefs(block).filter((ref) => ref.ref_kind === refKind);
}

function extractBlockRefs(block: VerifierBlock): ReadonlyArray<ExtractedBlockRef> {
  const refs: ExtractedBlockRef[] = [];

  if (block.kind === "rich_text") {
    for (const segment of block.segments ?? []) {
      if (!isRecord(segment) || segment.type !== "ref") continue;
      pushTypedRef(refs, segment.ref_kind, segment.ref_id);
    }
  }

  if (block.kind === "metric_row") {
    for (const item of block.items ?? []) {
      if (!isRecord(item)) continue;
      pushTypedRef(refs, "fact", item.value_ref);
      pushTypedRef(refs, "fact", item.delta_ref);
    }
  }

  if (block.kind === "revenue_bars") {
    for (const bar of block.bars ?? []) {
      if (!isRecord(bar)) continue;
      pushTypedRef(refs, "fact", bar.value_ref);
      pushTypedRef(refs, "fact", bar.delta_ref);
    }
  }

  if (block.kind === "segment_donut") {
    for (const segment of block.segments ?? []) {
      if (!isRecord(segment)) continue;
      pushTypedRef(refs, "fact", segment.value_ref);
    }
  }

  if (block.kind === "analyst_consensus") {
    pushTypedRef(refs, "fact", block.analyst_count_ref);
    for (const item of block.distribution ?? []) {
      if (!isRecord(item)) continue;
      pushTypedRef(refs, "fact", item.count_ref);
    }
  }

  if (block.kind === "price_target_range") {
    pushTypedRef(refs, "fact", block.current_price_ref);
    pushTypedRef(refs, "fact", block.low_ref);
    pushTypedRef(refs, "fact", block.avg_ref);
    pushTypedRef(refs, "fact", block.high_ref);
    pushTypedRef(refs, "fact", block.upside_ref);
  }

  if (block.kind === "eps_surprise") {
    for (const quarter of block.quarters ?? []) {
      if (!isRecord(quarter)) continue;
      pushTypedRef(refs, "fact", quarter.estimate_ref);
      pushTypedRef(refs, "fact", quarter.actual_ref);
      pushTypedRef(refs, "fact", quarter.surprise_ref);
    }
  }

  if (block.kind === "sources") {
    for (const item of block.items ?? []) {
      if (!isRecord(item)) continue;
      pushTypedRef(refs, "source", item.source_id);
    }
  }

  if (block.kind === "news_cluster" || block.kind === "filings_list") {
    for (const item of block.items ?? []) {
      if (!isRecord(item)) continue;
      pushTypedRef(refs, "document", item.document_id);
    }
  }

  pushArrayTypedRefs(refs, "fact", block.fact_refs);
  pushArrayTypedRefs(refs, "claim", block.claim_refs);
  pushArrayTypedRefs(refs, "event", block.event_refs);
  pushArrayTypedRefs(refs, "document", block.document_refs);

  return Object.freeze(dedupeBlockRefs(refs));
}

function pushArrayTypedRefs(
  refs: ExtractedBlockRef[],
  ref_kind: ExtractedBlockRef["ref_kind"],
  values: ReadonlyArray<string> | undefined,
): void {
  for (const value of values ?? []) {
    pushTypedRef(refs, ref_kind, value);
  }
}

function pushTypedRef(
  refs: ExtractedBlockRef[],
  ref_kind: unknown,
  ref_id: unknown,
): void {
  if (
    ref_kind === "fact" ||
    ref_kind === "claim" ||
    ref_kind === "event" ||
    ref_kind === "document" ||
    ref_kind === "source"
  ) {
    if (ref_id === undefined) return;
    refs.push({
      ref_kind,
      ref_id: assertUuidV4(ref_id, `verifySnapshotSeal.${ref_kind}_ref`),
    });
  }
}

function dedupeBlockRefs(refs: ReadonlyArray<ExtractedBlockRef>): ExtractedBlockRef[] {
  const seen = new Set<string>();
  const result: ExtractedBlockRef[] = [];
  for (const ref of refs) {
    const key = `${ref.ref_kind}:${ref.ref_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ref);
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function verifyDisclosures(
  input: NormalizedInput,
  addFailure: (reason: SnapshotVerifierReasonCode, details: JsonObject) => void,
): void {
  const sourceIds = new Set(input.sources.map((source) => source.source_id));
  const manifestSources = new Set(input.manifest.source_ids);
  const disclosureBlocks = flattenBlocks(input.blocks).filter((block) => block.kind === "disclosure");

  for (const [disclosureIndex, disclosure] of input.required_disclosures.entries()) {
    if (disclosure.source_refs.length === 0) {
      addFailure("missing_source_ref", {
        code: disclosure.code,
        source_id: null,
        scope: "required_disclosure_source",
      });
      continue;
    }

    for (const [sourceIndex, rawSourceId] of disclosure.source_refs.entries()) {
      const source_id = assertUuidV4(
        rawSourceId,
        `verifySnapshotSeal.required_disclosures[${disclosureIndex}].source_refs[${sourceIndex}]`,
      );
      if (!sourceIds.has(source_id)) {
        addFailure("missing_source_ref", {
          code: disclosure.code,
          source_id,
          scope: "required_disclosure_source",
        });
      }
      if (!manifestSources.has(source_id)) {
        addFailure("missing_source_ref", {
          code: disclosure.code,
          source_id,
          scope: "required_disclosure_source_manifest",
        });
      }
    }

    const isRendered = disclosureBlocks.some(
      (block) =>
        disclosureTierCovers(block.disclosure_tier, disclosure.tier) &&
        (block.items ?? []).includes(disclosure.item) &&
        disclosure.source_refs.every((source_id) => block.source_refs.includes(source_id)),
    );

    if (!isRendered) {
      addFailure("missing_required_disclosure", {
        code: disclosure.code,
        item: disclosure.item,
        tier: disclosure.tier,
        source_refs: [...disclosure.source_refs],
      });
    }
  }
}

function verifyApprovals(
  input: NormalizedInput,
  addFailure: (reason: SnapshotVerifierReasonCode, details: JsonObject) => void,
): void {
  const pendingActions = new Map(
    input.pending_actions.map((action) => [action.pending_action_id, action]),
  );
  for (const action of input.tool_actions) {
    if (action.read_only) continue;

    let pendingActionStatus: string | null = null;
    if (action.approval_required === true && action.approved !== true) {
      pendingActionStatus = verifiedPendingActionStatus(action, pendingActions);
    }

    if (action.approval_required === undefined || pendingActionStatus !== null) {
      addFailure("unapproved_side_effect", {
        tool_name: action.tool_name,
        tool_call_id: action.tool_call_id ?? null,
        approval_required: action.approval_required ?? null,
        pending_action_id: action.pending_action_id ?? null,
        ...(pendingActionStatus === null ? {} : { pending_action_status: pendingActionStatus }),
      });
    }
  }
}

function verifiedPendingActionStatus(
  action: VerifierToolAction,
  pendingActions: ReadonlyMap<string, VerifierPendingAction>,
): string | null {
  if (action.pending_action_id == null) return "missing";

  const pendingAction = pendingActions.get(action.pending_action_id);
  if (pendingAction === undefined) return "missing";
  if (pendingAction.tool_name !== action.tool_name) return "tool_mismatch";
  if (pendingAction.approval_required !== true || pendingAction.read_only !== false) {
    return "invalid_policy";
  }
  if (pendingActionId(pendingAction) !== pendingAction.pending_action_id) {
    return "id_mismatch";
  }
  return null;
}

function factBindingsForBlock(block: VerifierBlock): ReadonlyArray<VerifierFactBinding> {
  const bindings = block.data_ref.params?.fact_bindings;
  if (bindings === undefined) return [];
  if (!Array.isArray(bindings)) {
    throw new Error(`verifySnapshotSeal.blocks.${block.id}.data_ref.params.fact_bindings: must be an array`);
  }

  return Object.freeze(
    bindings.map((binding, index) => normalizeFactBinding(binding, `${block.id}.fact_bindings[${index}]`)),
  );
}

function normalizeFactBinding(value: unknown, label: string): VerifierFactBinding {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`verifySnapshotSeal.${label}: must be an object`);
  }
  const binding = value as Record<string, unknown>;
  return Object.freeze({
    fact_id: assertUuidV4(binding.fact_id, `verifySnapshotSeal.${label}.fact_id`),
    ...(binding.unit === undefined ? {} : { unit: assertNonEmptyString(binding.unit, `verifySnapshotSeal.${label}.unit`) }),
    ...(binding.period_kind === undefined
      ? {}
      : { period_kind: assertFactPeriodKind(binding.period_kind, `verifySnapshotSeal.${label}.period_kind`) }),
    ...(binding.period_start === undefined
      ? {}
      : { period_start: nullableDateString(binding.period_start, `verifySnapshotSeal.${label}.period_start`) }),
    ...(binding.period_end === undefined
      ? {}
      : { period_end: nullableDateString(binding.period_end, `verifySnapshotSeal.${label}.period_end`) }),
    ...(binding.fiscal_year === undefined ? {} : { fiscal_year: nullableInteger(binding.fiscal_year, `verifySnapshotSeal.${label}.fiscal_year`) }),
    ...(binding.fiscal_period === undefined ? {} : { fiscal_period: nullableString(binding.fiscal_period, `verifySnapshotSeal.${label}.fiscal_period`) }),
  });
}

function factBindingMismatch(fact: VerifierFact, binding: VerifierFactBinding): string[] {
  const fields = requiredFactBindingFields(fact, binding);
  const mismatches: string[] = [];

  for (const field of fields) {
    if (fact[field] == null || binding[field] == null || fact[field] !== binding[field]) {
      mismatches.push(field);
    }
  }
  return mismatches;
}

function factMetadataMismatch(fact: VerifierFact): string[] {
  const fields = requiredFactBindingFields(fact, {
    fact_id: fact.fact_id,
    period_kind: fact.period_kind,
  });
  return fields.filter((field) => fact[field] == null);
}

function requiredFactBindingFields(
  fact: VerifierFact,
  binding: VerifierFactBinding,
): Array<keyof VerifierFactBinding> {
  const fields: Array<keyof VerifierFactBinding> = ["unit", "period_kind"];
  const periodKind = fact.period_kind ?? binding.period_kind;
  switch (periodKind) {
    case "point":
      fields.push("period_end");
      break;
    case "fiscal_q":
      fields.push("fiscal_year", "fiscal_period");
      break;
    case "fiscal_y":
      fields.push("fiscal_year");
      break;
    case "ttm":
    case "range":
      fields.push("period_start", "period_end");
      break;
  }
  return fields;
}

function disclosureTierCovers(
  actual: string | undefined,
  required: RequiredDisclosure["tier"],
): boolean {
  if (
    actual === undefined ||
    !Object.prototype.hasOwnProperty.call(DISCLOSURE_TIER_RANK, actual)
  ) {
    return false;
  }
  return DISCLOSURE_TIER_RANK[actual as RequiredDisclosure["tier"]] >= DISCLOSURE_TIER_RANK[required];
}

async function writeVerifierFailure(
  db: QueryExecutor,
  input: NormalizedInput,
  failure: SnapshotVerifierFailure,
): Promise<void> {
  await db.query(
    `insert into verifier_fail_logs
       (thread_id, snapshot_id, reason_code, details)
     values ($1, $2, $3, $4::jsonb)`,
    [
      input.thread_id,
      input.snapshot_id,
      failure.reason_code,
      JSON.stringify(failure.details),
    ],
  );
}

async function writeRawVerifierFailure(
  db: QueryExecutor,
  input: SnapshotVerificationInput,
  failure: SnapshotVerifierFailure,
): Promise<void> {
  await db.query(
    `insert into verifier_fail_logs
       (thread_id, snapshot_id, reason_code, details)
     values ($1, $2, $3, $4::jsonb)`,
    [
      optionalUuidV4(input?.thread_id),
      optionalUuidV4(input?.snapshot_id),
      failure.reason_code,
      JSON.stringify(failure.details),
    ],
  );
}

function optionalUuidV4(value: unknown): string | null {
  return typeof value === "string" && UUID_V4.test(value) ? value.toLowerCase() : null;
}

function cloneJsonObject(value: JsonObject, label: string): JsonObject {
  assertJsonValue(value, label, new Set<object>());
  return Object.freeze(JSON.parse(stableJson(value)) as JsonObject);
}

function cloneJsonValue<T extends JsonValue>(value: T, label: string): T {
  assertJsonValue(value, label, new Set<object>());
  return Object.freeze(JSON.parse(stableJson(value)) as T);
}

function assertJsonValue(
  value: unknown,
  label: string,
  seen: Set<object>,
): asserts value is JsonValue {
  if (value === null) return;
  switch (typeof value) {
    case "boolean":
    case "string":
      return;
    case "number":
      if (Number.isFinite(value)) return;
      throw new Error(`${label}: JSON value contains a non-finite number`);
    case "object":
      break;
    default:
      throw new Error(`${label}: JSON value contains unsupported ${typeof value}`);
  }
  if (seen.has(value)) {
    throw new Error(`${label}: JSON value contains a circular reference`);
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      value.forEach((item, index) => assertJsonValue(item, `${label}[${index}]`, seen));
      return;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${label}: JSON value contains a non-plain object`);
    }
    Object.entries(value).forEach(([key, child]) =>
      assertJsonValue(child, `${label}.${key}`, seen),
    );
  } finally {
    seen.delete(value);
  }
}

function stableJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}

function pendingActionId(action: VerifierPendingAction): string {
  const seed: JsonObject = {
    tool_name: action.tool_name,
    bundle_id: action.bundle_id,
    audience: action.audience,
    arguments: action.arguments ?? null,
    idempotency_key: action.idempotency_key ?? null,
  };
  const digest = createHash("sha256")
    .update(stableJson(seed))
    .digest("hex")
    .slice(0, 32);
  return deterministicUuid(digest);
}

function deterministicUuid(hex: string): string {
  const chars = [...hex];
  chars[12] = "5";
  chars[16] = ((Number.parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);
  return `${chars.slice(0, 8).join("")}-${chars.slice(8, 12).join("")}-${chars
    .slice(12, 16)
    .join("")}-${chars.slice(16, 20).join("")}-${chars
    .slice(20, 32)
    .join("")}`;
}

function assertUuidV4(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID_V4.test(value)) {
    throw new Error(`${label}: must be a UUID v4`);
  }
  return value.toLowerCase();
}

function assertUuidV5(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID_V5.test(value)) {
    throw new Error(`${label}: must be a UUID v5`);
  }
  return value.toLowerCase();
}

function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label}: must be a non-empty string`);
  }
  return value;
}

function assertOneOf<T extends string>(
  value: unknown,
  allowed: ReadonlyArray<T>,
  label: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`${label}: must be one of ${allowed.join(", ")}`);
  }
  return value as T;
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return assertNonEmptyString(value, label);
}

function nullableDateString(value: unknown, label: string): string | null {
  if (value === null) return null;
  const date = assertNonEmptyString(value, label);
  const match = ISO_DATE.exec(date);
  if (
    match === null ||
    !isValidDate(Number(match[1]), Number(match[2]), Number(match[3]))
  ) {
    throw new Error(`${label}: must be an ISO date`);
  }
  return date;
}

function nullableInteger(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value)) {
    throw new Error(`${label}: must be an integer or null`);
  }
  return value;
}

function assertFactPeriodKind(value: unknown, label: string): string {
  if (typeof value !== "string" || !FACT_PERIOD_KINDS.includes(value as never)) {
    throw new Error(`${label}: must be one of ${FACT_PERIOD_KINDS.join(", ")}`);
  }
  return value;
}

function assertDisclosureReasonCode(value: unknown, label: string): RequiredDisclosure["code"] {
  if (
    typeof value !== "string" ||
    !DISCLOSURE_REASON_CODES.includes(value as RequiredDisclosure["code"])
  ) {
    throw new Error(`${label}: must be one of ${DISCLOSURE_REASON_CODES.join(", ")}`);
  }
  return value as RequiredDisclosure["code"];
}

function assertDisclosureTier(value: unknown, label: string): RequiredDisclosure["tier"] {
  const tiers = Object.keys(DISCLOSURE_TIER_RANK);
  if (typeof value !== "string" || !Object.prototype.hasOwnProperty.call(DISCLOSURE_TIER_RANK, value)) {
    throw new Error(`${label}: must be one of ${tiers.join(", ")}`);
  }
  return value as RequiredDisclosure["tier"];
}

function assertBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label}: must be a boolean`);
  }
  return value;
}

function assertArray<T>(value: unknown, label: string): asserts value is ReadonlyArray<T> {
  if (!Array.isArray(value)) {
    throw new Error(`${label}: must be an array`);
  }
}

function optionalArray<T>(value: unknown, label: string): ReadonlyArray<T> | undefined {
  if (value === undefined) return undefined;
  assertArray<T>(value, label);
  return value;
}

function assertPlainJsonObject(value: unknown, label: string): JsonObject {
  if (!isRecord(value)) {
    throw new Error(`${label}: must be an object`);
  }
  return value as JsonObject;
}

function canonicalTimestamp(value: unknown, label: string): string {
  assertIso8601WithOffset(value, label);
  return new Date(value).toISOString();
}

function assertIso8601WithOffset(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string") {
    throw new Error(`${label}: must be an ISO-8601 timestamp with explicit Z or offset`);
  }
  const match = ISO_8601_WITH_OFFSET.exec(value);
  if (!match || !isValidTimestampMatch(match) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label}: must be an ISO-8601 timestamp with explicit Z or offset`);
  }
}

function isValidTimestampMatch(match: RegExpExecArray): boolean {
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHourText = match[10];
  const offsetMinuteText = match[11];

  if (
    !isValidDate(year, month, day) ||
    !isInRange(hour, 0, 23) ||
    !isInRange(minute, 0, 59) ||
    !isInRange(second, 0, 59)
  ) {
    return false;
  }
  if (offsetHourText === undefined || offsetMinuteText === undefined) return true;
  return (
    isInRange(Number(offsetHourText), 0, 23) &&
    isInRange(Number(offsetMinuteText), 0, 59)
  );
}

function isValidDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !isInRange(month, 1, 12)) return false;
  return isInRange(day, 1, daysInMonth(year, month));
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isInRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

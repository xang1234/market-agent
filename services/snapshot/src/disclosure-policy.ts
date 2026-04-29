import type {
  JsonValue,
  SnapshotBasis,
  SnapshotNormalization,
  SnapshotSubjectRef,
} from "./manifest-staging.ts";
import {
  SNAPSHOT_BASES,
  SNAPSHOT_NORMALIZATIONS,
  SNAPSHOT_SUBJECT_KINDS,
} from "./manifest-staging.ts";

export const DISCLOSURE_TIERS = [
  "real_time",
  "delayed_15m",
  "eod",
  "filing_time",
  "estimate",
  "candidate",
  "tertiary_source",
] as const;

export type DisclosureTier = (typeof DISCLOSURE_TIERS)[number];

export type FreshnessClass =
  | "real_time"
  | "delayed_15m"
  | "eod"
  | "filing_time"
  | "stale";

export const FRESHNESS_CLASSES = [
  "real_time",
  "delayed_15m",
  "eod",
  "filing_time",
  "stale",
] as const;

export type CoverageLevel = "full" | "partial" | "sparse" | "unavailable";

export const COVERAGE_LEVELS = [
  "full",
  "partial",
  "sparse",
  "unavailable",
] as const;

export type VerificationStatus =
  | "authoritative"
  | "candidate"
  | "corroborated"
  | "disputed";

export const VERIFICATION_STATUSES = [
  "authoritative",
  "candidate",
  "corroborated",
  "disputed",
] as const;

export type DisclosureReasonCode =
  | "delayed_pricing"
  | "eod_pricing"
  | "filing_time_basis"
  | "low_coverage"
  | "candidate_data"
  | "fx_converted_values";

export type DisclosureSnapshotState = {
  subject_refs: ReadonlyArray<SnapshotSubjectRef>;
  source_ids: ReadonlyArray<string>;
  series_specs?: ReadonlyArray<JsonValue>;
  as_of: string;
  basis: SnapshotBasis;
  normalization: SnapshotNormalization;
};

export type DisclosureFactState = {
  fact_id: string;
  freshness_class?: FreshnessClass;
  coverage_level?: CoverageLevel;
  verification_status?: VerificationStatus;
  fx_converted?: boolean;
  quality_flags?: ReadonlyArray<string>;
  source_id?: string | null;
};

export type DisclosureSeriesState = {
  series_ref: string;
  freshness_class?: FreshnessClass;
  delay_class?: "real_time" | "delayed_15m" | "eod" | "unknown";
  coverage_level?: CoverageLevel;
  fx_converted?: boolean;
  source_id?: string | null;
};

export type DisclosurePolicyInput = {
  snapshot_id: string;
  manifest: DisclosureSnapshotState;
  facts?: ReadonlyArray<DisclosureFactState>;
  series?: ReadonlyArray<DisclosureSeriesState>;
};

export type RequiredDisclosure = {
  code: DisclosureReasonCode;
  tier: DisclosureTier;
  item: string;
  fact_refs: ReadonlyArray<string>;
  series_refs: ReadonlyArray<string>;
  source_refs: ReadonlyArray<string>;
};

export type DisclosureBlockDraft = {
  id: string;
  kind: "disclosure";
  snapshot_id: string;
  data_ref: {
    kind: "disclosure_policy";
    id: "required";
  };
  source_refs: ReadonlyArray<string>;
  as_of: string;
  disclosure_tier: DisclosureTier;
  items: ReadonlyArray<string>;
};

export type CompiledDisclosurePolicy = {
  required_disclosures: ReadonlyArray<RequiredDisclosure>;
  required_disclosure_blocks: ReadonlyArray<DisclosureBlockDraft>;
};

type FrozenDisclosureSnapshotState = Omit<DisclosureSnapshotState, "series_specs"> & {
  series_specs: ReadonlyArray<DisclosureSeriesSignal>;
};

type DisclosureSeriesSignal = Omit<DisclosureSeriesState, "series_ref" | "source_id"> & {
  series_ref?: string;
  source_refs: ReadonlyArray<string>;
};

const UUID_V4 =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
const ISO_8601_WITH_OFFSET =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|([+-])(\d{2}):(\d{2}))$/;

const DISCLOSURE_ORDER: ReadonlyArray<DisclosureReasonCode> = [
  "delayed_pricing",
  "eod_pricing",
  "filing_time_basis",
  "low_coverage",
  "candidate_data",
  "fx_converted_values",
];

const TIER_RANK: Record<DisclosureTier, number> = {
  real_time: 0,
  delayed_15m: 1,
  eod: 2,
  filing_time: 3,
  estimate: 4,
  candidate: 5,
  tertiary_source: 6,
};

export function compileDisclosurePolicy(
  input: DisclosurePolicyInput,
): CompiledDisclosurePolicy {
  if (input === null || typeof input !== "object") {
    throw new Error("compileDisclosurePolicy: input must be an object");
  }

  const snapshotId = assertUuidV4(
    input.snapshot_id,
    "compileDisclosurePolicy.snapshot_id",
  );
  const manifest = freezeManifest(input.manifest);
  const facts = freezeFacts(input.facts ?? []);
  const series = Object.freeze([
    ...manifest.series_specs,
    ...freezeSeries(input.series ?? []),
  ]);
  const accumulator = new RequirementAccumulator(manifest.as_of);

  for (const item of series) {
    if (item.freshness_class === "delayed_15m" || item.delay_class === "delayed_15m") {
      accumulator.add("delayed_pricing", {
        tier: "delayed_15m",
        series_refs: nullableId(item.series_ref),
        source_refs: item.source_refs,
      });
    }
    if (item.freshness_class === "eod" || item.delay_class === "eod") {
      accumulator.add("eod_pricing", {
        tier: "eod",
        series_refs: nullableId(item.series_ref),
        source_refs: item.source_refs,
      });
    }
    if (isLowCoverage(item.coverage_level)) {
      accumulator.add("low_coverage", {
        tier: "estimate",
        series_refs: nullableId(item.series_ref),
        source_refs: item.source_refs,
      });
    }
    if (item.fx_converted === true) {
      accumulator.add("fx_converted_values", {
        tier: "estimate",
        series_refs: nullableId(item.series_ref),
        source_refs: item.source_refs,
      });
    }
  }

  for (const item of facts) {
    if (item.freshness_class === "delayed_15m") {
      accumulator.add("delayed_pricing", {
        tier: "delayed_15m",
        fact_refs: [item.fact_id],
        source_refs: nullableId(item.source_id),
      });
    }
    if (item.freshness_class === "eod") {
      accumulator.add("eod_pricing", {
        tier: "eod",
        fact_refs: [item.fact_id],
        source_refs: nullableId(item.source_id),
      });
    }
    if (item.freshness_class === "filing_time") {
      accumulator.add("filing_time_basis", {
        tier: "filing_time",
        fact_refs: [item.fact_id],
        source_refs: nullableId(item.source_id),
      });
    }
    if (isLowCoverage(item.coverage_level)) {
      accumulator.add("low_coverage", {
        tier: "estimate",
        fact_refs: [item.fact_id],
        source_refs: nullableId(item.source_id),
      });
    }
    if (item.verification_status === "candidate" || item.verification_status === "disputed") {
      accumulator.add("candidate_data", {
        tier: "candidate",
        fact_refs: [item.fact_id],
        source_refs: nullableId(item.source_id),
      });
    }
    if (item.fx_converted === true || hasFxQualityFlag(item.quality_flags)) {
      accumulator.add("fx_converted_values", {
        tier: "estimate",
        fact_refs: [item.fact_id],
        source_refs: nullableId(item.source_id),
      });
    }
  }

  if (manifest.basis === "reported" || manifest.basis === "restated") {
    accumulator.add("filing_time_basis", {
      tier: "filing_time",
      source_refs: manifest.source_ids,
    });
  }
  if (manifest.normalization === "currency_normalized") {
    accumulator.add("fx_converted_values", {
      tier: "estimate",
      source_refs: manifest.source_ids,
    });
  }

  const required_disclosures = Object.freeze(accumulator.values());
  const source_refs = firstSeen(required_disclosures.flatMap((item) => item.source_refs));
  const required_disclosure_blocks =
    required_disclosures.length === 0
      ? Object.freeze([] as DisclosureBlockDraft[])
      : Object.freeze([
          Object.freeze({
            id: "required-disclosures",
            kind: "disclosure",
            snapshot_id: snapshotId,
            data_ref: Object.freeze({
              kind: "disclosure_policy",
              id: "required",
            }),
            source_refs: Object.freeze(source_refs),
            as_of: manifest.as_of,
            disclosure_tier: highestTier(required_disclosures),
            items: Object.freeze(required_disclosures.map((item) => item.item)),
          }),
        ]);

  return Object.freeze({
    required_disclosures,
    required_disclosure_blocks,
  });
}

type RequirementPatch = {
  tier: DisclosureTier;
  fact_refs?: ReadonlyArray<string>;
  series_refs?: ReadonlyArray<string>;
  source_refs?: ReadonlyArray<string>;
};

class RequirementAccumulator {
  private readonly byCode = new Map<DisclosureReasonCode, MutableRequirement>();
  private readonly asOf: string;

  constructor(asOf: string) {
    this.asOf = asOf;
  }

  add(code: DisclosureReasonCode, patch: RequirementPatch): void {
    const existing = this.byCode.get(code) ?? {
      code,
      tier: patch.tier,
      item: disclosureText(code, this.asOf),
      fact_refs: [],
      series_refs: [],
      source_refs: [],
    };

    if (TIER_RANK[patch.tier] > TIER_RANK[existing.tier]) {
      existing.tier = patch.tier;
    }
    appendFirstSeen(existing.fact_refs, patch.fact_refs ?? []);
    appendFirstSeen(existing.series_refs, patch.series_refs ?? []);
    appendFirstSeen(existing.source_refs, patch.source_refs ?? []);
    this.byCode.set(code, existing);
  }

  values(): RequiredDisclosure[] {
    return DISCLOSURE_ORDER.flatMap((code) => {
      const item = this.byCode.get(code);
      if (item === undefined) return [];

      return [
        Object.freeze({
          code: item.code,
          tier: item.tier,
          item: item.item,
          fact_refs: Object.freeze([...item.fact_refs]),
          series_refs: Object.freeze([...item.series_refs]),
          source_refs: Object.freeze([...item.source_refs]),
        }),
      ];
    });
  }
}

type MutableRequirement = {
  code: DisclosureReasonCode;
  tier: DisclosureTier;
  item: string;
  fact_refs: string[];
  series_refs: string[];
  source_refs: string[];
};

function disclosureText(code: DisclosureReasonCode, asOf: string): string {
  switch (code) {
    case "delayed_pricing":
      return `Market prices include delayed data as of ${asOf}; do not treat them as real-time quotes.`;
    case "eod_pricing":
      return `Market prices use end-of-day data as of ${asOf}; intraday moves may not be reflected.`;
    case "filing_time_basis":
      return `Filing-derived values are shown on a filing-time basis as of ${asOf}; later restatements or market updates may differ.`;
    case "low_coverage":
      return "Some values have partial, sparse, or unavailable coverage; comparisons may omit unavailable inputs.";
    case "candidate_data":
      return "Some facts are candidate or disputed and have not been promoted to authoritative data.";
    case "fx_converted_values":
      return "Displayed values include explicit FX conversion or currency normalization; conversions must remain source-backed.";
  }
}

function freezeManifest(value: DisclosureSnapshotState): FrozenDisclosureSnapshotState {
  if (value === null || typeof value !== "object") {
    throw new Error("compileDisclosurePolicy.manifest: must be an object");
  }
  assertArray<SnapshotSubjectRef>(
    value.subject_refs,
    "compileDisclosurePolicy.manifest.subject_refs",
  );
  if (value.subject_refs.length === 0) {
    throw new Error("compileDisclosurePolicy.manifest.subject_refs: must include at least one item");
  }
  const subjectRefs = value.subject_refs.map((ref, index) => {
    if (ref === null || typeof ref !== "object") {
      throw new Error(`compileDisclosurePolicy.manifest.subject_refs[${index}]: must be an object`);
    }
    const kind = assertOneOf(
      ref.kind,
      SNAPSHOT_SUBJECT_KINDS,
      `compileDisclosurePolicy.manifest.subject_refs[${index}].kind`,
    );
    return Object.freeze({
      kind,
      id: assertUuidV4(
        ref.id,
        `compileDisclosurePolicy.manifest.subject_refs[${index}].id`,
      ),
    });
  });

  assertArray<string>(value.source_ids, "compileDisclosurePolicy.manifest.source_ids");
  const sourceIds = firstSeen(
    value.source_ids.map((sourceId, index) =>
      assertUuidV4(sourceId, `compileDisclosurePolicy.manifest.source_ids[${index}]`),
    ),
  );

  return Object.freeze({
    subject_refs: Object.freeze(subjectRefs),
    source_ids: Object.freeze(sourceIds),
    series_specs: Object.freeze(freezeManifestSeriesSpecs(value.series_specs ?? [], sourceIds)),
    as_of: canonicalTimestamp(value.as_of, "compileDisclosurePolicy.manifest.as_of"),
    basis: assertOneOf(value.basis, SNAPSHOT_BASES, "compileDisclosurePolicy.manifest.basis"),
    normalization: assertOneOf(
      value.normalization,
      SNAPSHOT_NORMALIZATIONS,
      "compileDisclosurePolicy.manifest.normalization",
    ),
  });
}

function freezeManifestSeriesSpecs(
  values: ReadonlyArray<JsonValue>,
  fallbackSourceIds: ReadonlyArray<string>,
): ReadonlyArray<DisclosureSeriesSignal> {
  assertArray<JsonValue>(
    values,
    "compileDisclosurePolicy.manifest.series_specs",
  );
  return Object.freeze(
    values.flatMap((value, index) => {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`compileDisclosurePolicy.manifest.series_specs[${index}]: must be an object`);
      }

      const spec = value as Record<string, unknown>;
      const hasDisclosureSignal =
        spec.freshness_class !== undefined ||
        spec.delay_class !== undefined ||
        spec.coverage_level !== undefined ||
        spec.fx_converted !== undefined;

      if (!hasDisclosureSignal) {
        return [];
      }
      const seriesRef =
        spec.series_ref === undefined
          ? undefined
          : assertUuidV4(
              spec.series_ref,
              `compileDisclosurePolicy.manifest.series_specs[${index}].series_ref`,
            );
      if (spec.source_id == null && seriesRef !== undefined) {
        throw new Error(
          `compileDisclosurePolicy.manifest.series_specs[${index}].source_id: required when series_ref is present`,
        );
      }
      const sourceRefs =
        spec.source_id == null
          ? Object.freeze([...fallbackSourceIds])
          : Object.freeze([
              assertUuidV4(
                spec.source_id,
                `compileDisclosurePolicy.manifest.series_specs[${index}].source_id`,
              ),
            ]);

      return [
        Object.freeze({
          ...(seriesRef === undefined ? {} : { series_ref: seriesRef }),
          ...(spec.freshness_class === undefined
            ? {}
            : {
                freshness_class: assertOneOf(
                  spec.freshness_class,
                  FRESHNESS_CLASSES,
                  `compileDisclosurePolicy.manifest.series_specs[${index}].freshness_class`,
                ),
              }),
          ...(spec.delay_class === undefined
            ? {}
            : {
                delay_class: assertOneOf(
                  spec.delay_class,
                  ["real_time", "delayed_15m", "eod", "unknown"] as const,
                  `compileDisclosurePolicy.manifest.series_specs[${index}].delay_class`,
                ),
              }),
          ...(spec.coverage_level === undefined
            ? {}
            : {
                coverage_level: assertOneOf(
                  spec.coverage_level,
                  COVERAGE_LEVELS,
                  `compileDisclosurePolicy.manifest.series_specs[${index}].coverage_level`,
                ),
              }),
          ...(spec.fx_converted === undefined
            ? {}
            : {
                fx_converted: assertBoolean(
                  spec.fx_converted,
                  `compileDisclosurePolicy.manifest.series_specs[${index}].fx_converted`,
                ),
              }),
          source_refs: sourceRefs,
        }),
      ];
    }),
  );
}

function freezeFacts(values: ReadonlyArray<DisclosureFactState>): ReadonlyArray<DisclosureFactState> {
  assertArray<DisclosureFactState>(values, "compileDisclosurePolicy.facts");
  return Object.freeze(
    values.map((value, index) => {
      if (value === null || typeof value !== "object") {
        throw new Error(`compileDisclosurePolicy.facts[${index}]: must be an object`);
      }

      const qualityFlags = value.quality_flags ?? [];
      assertArray<string>(
        qualityFlags,
        `compileDisclosurePolicy.facts[${index}].quality_flags`,
      );

      return Object.freeze({
        fact_id: assertUuidV4(value.fact_id, `compileDisclosurePolicy.facts[${index}].fact_id`),
        ...(value.freshness_class === undefined
          ? {}
          : {
              freshness_class: assertOneOf(
                value.freshness_class,
                FRESHNESS_CLASSES,
                `compileDisclosurePolicy.facts[${index}].freshness_class`,
              ),
            }),
        ...(value.coverage_level === undefined
          ? {}
          : {
              coverage_level: assertOneOf(
                value.coverage_level,
                COVERAGE_LEVELS,
                `compileDisclosurePolicy.facts[${index}].coverage_level`,
              ),
            }),
        ...(value.verification_status === undefined
          ? {}
          : {
              verification_status: assertOneOf(
                value.verification_status,
                VERIFICATION_STATUSES,
                `compileDisclosurePolicy.facts[${index}].verification_status`,
              ),
            }),
        ...(value.fx_converted === undefined
          ? {}
          : { fx_converted: assertBoolean(value.fx_converted, `compileDisclosurePolicy.facts[${index}].fx_converted`) }),
        quality_flags: Object.freeze(
          qualityFlags.map((flag, flagIndex) => {
            assertNonEmptyString(
              flag,
              `compileDisclosurePolicy.facts[${index}].quality_flags[${flagIndex}]`,
            );
            return flag;
          }),
        ),
        ...(value.source_id == null
          ? {}
          : {
              source_id: assertUuidV4(
                value.source_id,
                `compileDisclosurePolicy.facts[${index}].source_id`,
              ),
            }),
      });
    }),
  );
}

function freezeSeries(
  values: ReadonlyArray<DisclosureSeriesState>,
): ReadonlyArray<DisclosureSeriesSignal> {
  assertArray<DisclosureSeriesState>(values, "compileDisclosurePolicy.series");
  return Object.freeze(
    values.map((value, index) => {
      if (value === null || typeof value !== "object") {
        throw new Error(`compileDisclosurePolicy.series[${index}]: must be an object`);
      }

      return Object.freeze({
        series_ref: assertUuidV4(
          value.series_ref,
          `compileDisclosurePolicy.series[${index}].series_ref`,
        ),
        ...(value.freshness_class === undefined
          ? {}
          : {
              freshness_class: assertOneOf(
                value.freshness_class,
                FRESHNESS_CLASSES,
                `compileDisclosurePolicy.series[${index}].freshness_class`,
              ),
            }),
        ...(value.delay_class === undefined
          ? {}
          : {
              delay_class: assertOneOf(
                value.delay_class,
                ["real_time", "delayed_15m", "eod", "unknown"] as const,
                `compileDisclosurePolicy.series[${index}].delay_class`,
              ),
            }),
        ...(value.coverage_level === undefined
          ? {}
          : {
              coverage_level: assertOneOf(
                value.coverage_level,
                COVERAGE_LEVELS,
                `compileDisclosurePolicy.series[${index}].coverage_level`,
              ),
            }),
        ...(value.fx_converted === undefined
          ? {}
          : { fx_converted: assertBoolean(value.fx_converted, `compileDisclosurePolicy.series[${index}].fx_converted`) }),
        ...(value.source_id == null
          ? { source_refs: Object.freeze([]) }
          : {
              source_refs: Object.freeze([
                assertUuidV4(
                  value.source_id,
                  `compileDisclosurePolicy.series[${index}].source_id`,
                ),
              ]),
            }),
      });
    }),
  );
}

function isLowCoverage(value: CoverageLevel | undefined): boolean {
  return value === "partial" || value === "sparse" || value === "unavailable";
}

function hasFxQualityFlag(flags: ReadonlyArray<string> | undefined): boolean {
  return (flags ?? []).some((flag) =>
    ["fx_converted", "currency_normalized", "fx_conversion"].includes(flag),
  );
}

function nullableId(value: string | null | undefined): string[] {
  return value == null ? [] : [value];
}

function highestTier(disclosures: ReadonlyArray<RequiredDisclosure>): DisclosureTier {
  return disclosures.reduce<DisclosureTier>((highest, disclosure) => {
    return TIER_RANK[disclosure.tier] > TIER_RANK[highest]
      ? disclosure.tier
      : highest;
  }, "real_time");
}

function firstSeen(values: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function appendFirstSeen(target: string[], values: ReadonlyArray<string>): void {
  for (const value of values) {
    if (!target.includes(value)) {
      target.push(value);
    }
  }
}

function assertUuidV4(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID_V4.test(value)) {
    throw new Error(`${label}: must be a UUID v4`);
  }
  return value.toLowerCase();
}

function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label}: must be a non-empty string`);
  }
  return value;
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

  if (offsetHourText === undefined || offsetMinuteText === undefined) {
    return true;
  }

  return (
    isInRange(Number(offsetHourText), 0, 23) &&
    isInRange(Number(offsetMinuteText), 0, 59)
  );
}

function isValidDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !isInRange(month, 1, 12)) {
    return false;
  }

  return isInRange(day, 1, daysInMonth(year, month));
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }

  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isInRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

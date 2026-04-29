import assert from "node:assert/strict";
import test from "node:test";

import {
  compileDisclosurePolicy,
  type DisclosurePolicyInput,
} from "../src/disclosure-policy.ts";

const snapshotId = "00000000-0000-4000-8000-000000000001";
const listingId = "00000000-0000-4000-8000-000000000002";
const delayedSeriesId = "00000000-0000-4000-8000-000000000003";
const delayedSourceId = "00000000-0000-4000-8000-000000000004";
const candidateFactId = "00000000-0000-4000-8000-000000000005";
const filingFactId = "00000000-0000-4000-8000-000000000006";
const fxFactId = "00000000-0000-4000-8000-000000000007";
const factSourceId = "00000000-0000-4000-8000-000000000008";

const baseInput = {
  snapshot_id: snapshotId,
  manifest: {
    subject_refs: [{ kind: "listing", id: listingId }],
    source_ids: [delayedSourceId, factSourceId],
    as_of: "2026-04-29T00:00:00.000Z",
    basis: "split_adjusted",
    normalization: "raw",
  },
} satisfies DisclosurePolicyInput;

test("compileDisclosurePolicy emits delayed-pricing disclosure for delayed quote state", () => {
  const policy = compileDisclosurePolicy({
    ...baseInput,
    series: [
      {
        series_ref: delayedSeriesId,
        freshness_class: "delayed_15m",
        coverage_level: "full",
        source_id: delayedSourceId,
      },
    ],
  });

  assert.deepEqual(
    policy.required_disclosures.map((disclosure) => disclosure.code),
    ["delayed_pricing"],
  );
  assert.deepEqual(policy.required_disclosure_blocks, [
    {
      id: "required-disclosures",
      kind: "disclosure",
      snapshot_id: snapshotId,
      data_ref: { kind: "disclosure_policy", id: "required" },
      source_refs: [delayedSourceId],
      as_of: "2026-04-29T00:00:00.000Z",
      disclosure_tier: "delayed_15m",
      items: [
        "Market prices include delayed data as of 2026-04-29T00:00:00.000Z; do not treat them as real-time quotes.",
      ],
    },
  ]);
});

test("compileDisclosurePolicy derives delayed-pricing disclosure from manifest series_specs", () => {
  const policy = compileDisclosurePolicy({
    ...baseInput,
    manifest: {
      ...baseInput.manifest,
      series_specs: [
        {
          series_ref: delayedSeriesId,
          delay_class: "delayed_15m",
          coverage_level: "full",
          source_id: delayedSourceId,
        },
      ],
    },
  });

  assert.deepEqual(
    policy.required_disclosures.map((disclosure) => disclosure.code),
    ["delayed_pricing"],
  );
  assert.deepEqual(policy.required_disclosures[0].series_refs, [delayedSeriesId]);
  assert.deepEqual(policy.required_disclosure_blocks[0].source_refs, [
    delayedSourceId,
  ]);
});

test("compileDisclosurePolicy falls back to manifest sources for series_specs without source_id", () => {
  const policy = compileDisclosurePolicy({
    ...baseInput,
    manifest: {
      ...baseInput.manifest,
      series_specs: [
        {
          subject_ref: { kind: "listing", id: listingId },
          interval: "1d",
          delay_class: "delayed_15m",
        },
      ],
    },
  });

  assert.deepEqual(
    policy.required_disclosures.map((disclosure) => disclosure.code),
    ["delayed_pricing"],
  );
  assert.deepEqual(policy.required_disclosures[0].series_refs, []);
  assert.deepEqual(policy.required_disclosures[0].source_refs, [
    delayedSourceId,
    factSourceId,
  ]);
});

test("compileDisclosurePolicy rejects source-less concrete manifest series specs", () => {
  assert.throws(
    () =>
      compileDisclosurePolicy({
        ...baseInput,
        manifest: {
          ...baseInput.manifest,
          series_specs: [
            {
              series_ref: delayedSeriesId,
              delay_class: "delayed_15m",
            },
          ],
        },
      }),
    /source_id: required when series_ref is present/,
  );
});

test("compileDisclosurePolicy is deterministic and orders required disclosures by policy", () => {
  const policy = compileDisclosurePolicy({
    ...baseInput,
    manifest: {
      ...baseInput.manifest,
      basis: "reported",
      normalization: "currency_normalized",
    },
    facts: [
      {
        fact_id: candidateFactId,
        verification_status: "candidate",
        coverage_level: "sparse",
        source_id: factSourceId,
      },
      {
        fact_id: filingFactId,
        freshness_class: "filing_time",
        verification_status: "authoritative",
        coverage_level: "full",
        source_id: factSourceId,
      },
      {
        fact_id: fxFactId,
        verification_status: "authoritative",
        coverage_level: "full",
        fx_converted: true,
        source_id: factSourceId,
      },
    ],
  });

  assert.deepEqual(
    policy.required_disclosures.map((disclosure) => disclosure.code),
    [
      "filing_time_basis",
      "low_coverage",
      "candidate_data",
      "fx_converted_values",
    ],
  );
  assert.deepEqual(policy.required_disclosure_blocks[0].items, [
    "Filing-derived values are shown on a filing-time basis as of 2026-04-29T00:00:00.000Z; later restatements or market updates may differ.",
    "Some values have partial, sparse, or unavailable coverage; comparisons may omit unavailable inputs.",
    "Some facts are candidate or disputed and have not been promoted to authoritative data.",
    "Displayed values include explicit FX conversion or currency normalization; conversions must remain source-backed.",
  ]);
  assert.equal(policy.required_disclosure_blocks[0].disclosure_tier, "candidate");
});

test("compileDisclosurePolicy returns no blocks when snapshot state has no disclosure triggers", () => {
  const policy = compileDisclosurePolicy({
    ...baseInput,
    manifest: {
      ...baseInput.manifest,
      series_specs: [
        {
          subject_ref: { kind: "listing", id: listingId },
          interval: "1d",
          range: { start: "2026-04-01T00:00:00Z", end: "2026-04-29T00:00:00Z" },
        },
      ],
    },
    facts: [
      {
        fact_id: candidateFactId,
        freshness_class: "real_time",
        verification_status: "authoritative",
        coverage_level: "full",
        source_id: factSourceId,
      },
    ],
  });

  assert.deepEqual(policy.required_disclosures, []);
  assert.deepEqual(policy.required_disclosure_blocks, []);
});

test("compileDisclosurePolicy rejects malformed evidence refs", () => {
  assert.throws(
    () =>
      compileDisclosurePolicy({
        ...baseInput,
        facts: [
          {
            fact_id: "not-a-uuid",
            verification_status: "candidate",
          },
        ],
      }),
    /fact_id: must be a UUID v4/,
  );

  assert.throws(
    () =>
      compileDisclosurePolicy({
        ...baseInput,
        series: [
          {
            series_ref: "series:00000000-0000-4000-8000-000000000003",
            freshness_class: "delayed_15m",
          },
        ],
      }),
    /series_ref: must be a UUID v4/,
  );
});

test("compileDisclosurePolicy rejects malformed manifest state", () => {
  assert.throws(
    () =>
      compileDisclosurePolicy({
        ...baseInput,
        manifest: {
          ...baseInput.manifest,
          basis: "calendar_adjusted",
        },
      } as never),
    /manifest\.basis: must be one of/,
  );
});

test("compileDisclosurePolicy requires snapshot_id for schema-valid disclosure blocks", () => {
  assert.throws(
    () =>
      compileDisclosurePolicy({
        manifest: baseInput.manifest,
        series: [
          {
            series_ref: delayedSeriesId,
            freshness_class: "delayed_15m",
            source_id: delayedSourceId,
          },
        ],
      } as never),
    /snapshot_id: must be a UUID v4/,
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  verifySnapshotSeal,
  type SnapshotVerificationInput,
} from "../src/snapshot-verifier.ts";
import { compileDisclosurePolicy } from "../src/disclosure-policy.ts";

const snapshotId = "00000000-0000-4000-8000-000000000001";
const subjectId = "00000000-0000-4000-8000-000000000002";
const factId = "00000000-0000-4000-8000-000000000003";
const claimId = "00000000-0000-4000-8000-000000000004";
const eventId = "00000000-0000-4000-8000-000000000005";
const sourceId = "00000000-0000-4000-8000-000000000006";
const threadId = "00000000-0000-4000-8000-000000000007";
const actionId = "00000000-0000-4000-8000-000000000008";
const missingId = "00000000-0000-4000-8000-000000000009";
const pendingActionId = "00000000-0000-5000-8000-000000000010";
const otherSubjectId = "00000000-0000-4000-8000-000000000011";
const seriesRef = "00000000-0000-4000-8000-000000000012";
const otherSeriesRef = "00000000-0000-4000-8000-000000000013";
const pointFactId = "00000000-0000-4000-8000-000000000014";
const rangeFactId = "00000000-0000-4000-8000-000000000015";
const ttmFactId = "00000000-0000-4000-8000-000000000016";
const documentId = "00000000-0000-4000-8000-000000000017";
const otherDocumentId = "00000000-0000-4000-8000-000000000018";

const baseInput = {
  thread_id: threadId,
  snapshot_id: snapshotId,
  manifest: {
    subject_refs: [{ kind: "listing", id: subjectId }],
    fact_refs: [factId],
    claim_refs: [claimId],
    event_refs: [eventId],
    document_refs: [],
    source_ids: [sourceId],
    series_specs: [{ series_ref: seriesRef, source_id: sourceId }],
    as_of: "2026-04-29T00:00:00.000Z",
    basis: "reported",
    normalization: "raw",
  },
  facts: [
    {
      fact_id: factId,
      source_id: sourceId,
      unit: "USD",
      period_kind: "fiscal_q",
      fiscal_year: 2026,
      fiscal_period: "Q1",
    },
  ],
  claims: [{ claim_id: claimId, source_id: sourceId }],
  events: [{ event_id: eventId, source_ids: [sourceId] }],
  documents: [],
  sources: [{ source_id: sourceId }],
  required_disclosures: [
    {
      code: "filing_time_basis",
      tier: "filing_time",
      item: "Filing-derived values are shown on a filing-time basis as of 2026-04-29T00:00:00.000Z; later restatements or market updates may differ.",
      fact_refs: [factId],
      series_refs: [],
      source_refs: [sourceId],
    },
  ],
  blocks: [
    {
      id: "metric-revenue",
      kind: "metric_row",
      snapshot_id: snapshotId,
      data_ref: {
        kind: "metric_row",
        id: "revenue",
        params: {
          fact_bindings: [
            {
              fact_id: factId,
              unit: "USD",
              period_kind: "fiscal_q",
              fiscal_year: 2026,
              fiscal_period: "Q1",
            },
          ],
        },
      },
      source_refs: [sourceId],
      as_of: "2026-04-29T00:00:00.000Z",
      fact_refs: [factId],
      claim_refs: [claimId],
      event_refs: [eventId],
    },
    {
      id: "required-disclosures",
      kind: "disclosure",
      snapshot_id: snapshotId,
      data_ref: { kind: "disclosure_policy", id: "required" },
      source_refs: [sourceId],
      as_of: "2026-04-29T00:00:00.000Z",
      disclosure_tier: "filing_time",
      items: [
        "Filing-derived values are shown on a filing-time basis as of 2026-04-29T00:00:00.000Z; later restatements or market updates may differ.",
      ],
    },
  ],
  tool_actions: [
    {
      tool_call_id: actionId,
      tool_name: "create_alert",
      read_only: false,
      approval_required: true,
      approved: true,
    },
  ],
} satisfies SnapshotVerificationInput;

test("verifySnapshotSeal accepts a fully bound snapshot artifact", async () => {
  const result = await verifySnapshotSeal(baseInput);

  assert.deepEqual(result, {
    ok: true,
    failures: [],
  });
});

test("verifySnapshotSeal accepts valid point, range, and ttm period dates", async () => {
  const datedFacts = [
    {
      fact_id: pointFactId,
      source_id: sourceId,
      unit: "USD",
      period_kind: "point",
      period_end: "2026-04-29",
    },
    {
      fact_id: rangeFactId,
      source_id: sourceId,
      unit: "USD",
      period_kind: "range",
      period_start: "2026-01-01",
      period_end: "2026-03-31",
    },
    {
      fact_id: ttmFactId,
      source_id: sourceId,
      unit: "USD",
      period_kind: "ttm",
      period_start: "2025-04-01",
      period_end: "2026-03-31",
    },
  ];

  const result = await verifySnapshotSeal({
    ...baseInput,
    manifest: {
      ...baseInput.manifest,
      fact_refs: [pointFactId, rangeFactId, ttmFactId],
      claim_refs: [],
      event_refs: [],
    },
    facts: datedFacts,
    claims: [],
    events: [],
    required_disclosures: [
      {
        ...baseInput.required_disclosures[0],
        fact_refs: [pointFactId],
      },
    ],
    blocks: [
      {
        ...baseInput.blocks[0],
        fact_refs: [pointFactId, rangeFactId, ttmFactId],
        claim_refs: undefined,
        event_refs: undefined,
        data_ref: {
          ...baseInput.blocks[0].data_ref,
          params: { fact_bindings: datedFacts },
        },
      },
      baseInput.blocks[1],
    ],
  });

  assert.deepEqual(result, {
    ok: true,
    failures: [],
  });
});

test("verifySnapshotSeal accepts compiler-generated delayed series disclosures", async () => {
  const policy = compileDisclosurePolicy({
    snapshot_id: snapshotId,
    manifest: {
      subject_refs: [{ kind: "listing", id: subjectId }],
      source_ids: [sourceId],
      as_of: "2026-04-29T00:00:00.000Z",
      basis: "split_adjusted",
      normalization: "raw",
      series_specs: [
        {
          series_ref: seriesRef,
          delay_class: "delayed_15m",
          source_id: sourceId,
        },
      ],
    },
  });

  const result = await verifySnapshotSeal({
    ...baseInput,
    manifest: {
      ...baseInput.manifest,
      basis: "split_adjusted",
      series_specs: [
        {
          series_ref: seriesRef,
          delay_class: "delayed_15m",
          source_id: sourceId,
        },
      ],
    },
    required_disclosures: policy.required_disclosures,
    blocks: [baseInput.blocks[0], ...policy.required_disclosure_blocks],
  });

  assert.deepEqual(result, {
    ok: true,
    failures: [],
  });
});

test("verifySnapshotSeal accepts compiler-generated disclosure source fallbacks", async () => {
  const policy = compileDisclosurePolicy({
    snapshot_id: snapshotId,
    manifest: {
      subject_refs: [{ kind: "listing", id: subjectId }],
      source_ids: [sourceId],
      as_of: "2026-04-29T00:00:00.000Z",
      basis: "split_adjusted",
      normalization: "raw",
      series_specs: [
        {
          delay_class: "delayed_15m",
        },
      ],
    },
  });

  const result = await verifySnapshotSeal({
    ...baseInput,
    manifest: {
      ...baseInput.manifest,
      basis: "split_adjusted",
      series_specs: [{ delay_class: "delayed_15m" }],
    },
    required_disclosures: policy.required_disclosures,
    blocks: [baseInput.blocks[0], ...policy.required_disclosure_blocks],
  });

  assert.deepEqual(result, {
    ok: true,
    failures: [],
  });
});

test("verifySnapshotSeal derives required disclosures when caller omits compiler output", async () => {
  const result = await verifySnapshotSeal({
    ...baseInput,
    manifest: {
      ...baseInput.manifest,
      basis: "split_adjusted",
      series_specs: [
        {
          series_ref: seriesRef,
          delay_class: "delayed_15m",
          source_id: sourceId,
        },
      ],
    },
    required_disclosures: undefined,
    blocks: [baseInput.blocks[0]],
  });

  assert.deepEqual(
    result.failures.map((failure) => failure.reason_code),
    ["missing_required_disclosure"],
  );
  assert.deepEqual(result.failures[0].details, {
    code: "delayed_pricing",
    item: "Market prices include delayed data as of 2026-04-29T00:00:00.000Z; do not treat them as real-time quotes.",
    tier: "delayed_15m",
    source_refs: [sourceId],
  });
});

test("verifySnapshotSeal derives canonical disclosures even when caller supplies stale requirements", async () => {
  const result = await verifySnapshotSeal({
    ...baseInput,
    required_disclosures: [],
    blocks: [baseInput.blocks[0]],
  });

  assert.deepEqual(
    result.failures.map((failure) => failure.reason_code),
    ["missing_required_disclosure"],
  );
  assert.deepEqual(result.failures[0].details, {
    code: "filing_time_basis",
    item: "Filing-derived values are shown on a filing-time basis as of 2026-04-29T00:00:00.000Z; later restatements or market updates may differ.",
    tier: "filing_time",
    source_refs: [sourceId],
  });
});

test("verifySnapshotSeal accepts sealed document refs with source provenance", async () => {
  const result = await verifySnapshotSeal({
    ...baseInput,
    manifest: {
      ...baseInput.manifest,
      document_refs: [documentId],
    },
    documents: [{ document_id: documentId, source_id: sourceId }],
    blocks: [
      {
        id: "news-cluster",
        kind: "news_cluster",
        snapshot_id: snapshotId,
        data_ref: { kind: "news_cluster", id: "news-cluster" },
        source_refs: [sourceId],
        as_of: "2026-04-29T00:00:00.000Z",
        document_refs: [documentId],
      },
      baseInput.blocks[0],
      baseInput.blocks[1],
    ],
  });

  assert.deepEqual(result, {
    ok: true,
    failures: [],
  });
});

test("verifySnapshotSeal rejects unsealed document refs and missing document source refs", async () => {
  const result = await verifySnapshotSeal({
    ...baseInput,
    manifest: {
      ...baseInput.manifest,
      document_refs: [documentId],
    },
    documents: [{ document_id: documentId, source_id: sourceId }],
    blocks: [
      {
        id: "filings",
        kind: "filings_list",
        snapshot_id: snapshotId,
        data_ref: { kind: "filings_list", id: "filings" },
        source_refs: [],
        as_of: "2026-04-29T00:00:00.000Z",
        items: [
          { document_id: documentId },
          { document_id: otherDocumentId },
        ],
      },
      baseInput.blocks[0],
      baseInput.blocks[1],
    ],
  });

  assert.deepEqual(
    result.failures.map((failure) => failure.reason_code),
    ["missing_source_ref", "missing_document_ref"],
  );
  assert.deepEqual(result.failures[0].details, {
    block_id: "filings",
    document_id: documentId,
    source_id: sourceId,
    scope: "block_document_source",
  });
  assert.deepEqual(result.failures[1].details, {
    block_id: "filings",
    document_id: otherDocumentId,
  });
});

test("verifySnapshotSeal reports refs, sources, units, periods, disclosures, and approvals", async () => {
  const logged: Array<{ reason_code: string; details: unknown }> = [];
  const db = {
    async query<R extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      values?: unknown[],
    ) {
      assert.match(text, /insert into verifier_fail_logs/);
      logged.push({
        reason_code: values?.[2] as string,
        details: JSON.parse(values?.[3] as string),
      });
      return {
        rows: [
          {
            verifier_fail_log_id: missingId,
            created_at: new Date("2026-04-29T00:00:00.000Z"),
          },
        ] as R[],
      };
    },
  };

  const result = await verifySnapshotSeal(
    {
      ...baseInput,
      manifest: {
        ...baseInput.manifest,
        fact_refs: [factId, missingId],
        claim_refs: [claimId, missingId],
        event_refs: [eventId, missingId],
        source_ids: [sourceId],
      },
      blocks: [
        {
          ...baseInput.blocks[0],
          source_refs: [sourceId, missingId],
          data_ref: {
            ...baseInput.blocks[0].data_ref,
            params: {
              fact_bindings: [
                {
                  fact_id: factId,
                  unit: "shares",
                  period_kind: "fiscal_q",
                  fiscal_year: 2026,
                  fiscal_period: "Q2",
                },
              ],
            },
          },
        },
      ],
      required_disclosures: [
        {
          ...baseInput.required_disclosures[0],
          item: "Required disclosure text that is absent from rendered blocks.",
        },
      ],
      tool_actions: [
        {
          tool_call_id: actionId,
          tool_name: "create_alert",
          read_only: false,
          approval_required: true,
          approved: false,
        },
      ],
    },
    db,
  );

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.failures.map((failure) => failure.reason_code),
    [
      "missing_fact_ref",
      "missing_claim_ref",
      "missing_event_ref",
      "missing_source_ref",
      "missing_source_ref",
      "fact_binding_mismatch",
      "missing_required_disclosure",
      "missing_required_disclosure",
      "unapproved_side_effect",
    ],
  );
  assert.deepEqual(
    logged.map((row) => row.reason_code),
    result.failures.map((failure) => failure.reason_code),
  );
});

test("verifySnapshotSeal rejects blocks that point outside the sealed snapshot", async () => {
  const result = await verifySnapshotSeal({
    ...baseInput,
    blocks: [
      {
        ...baseInput.blocks[0],
        snapshot_id: missingId,
        as_of: "2026-04-30T00:00:00.000Z",
      },
      baseInput.blocks[1],
    ],
  });

  assert.deepEqual(
    result.failures.map((failure) => failure.reason_code),
    ["invalid_block_binding", "block_after_snapshot_as_of"],
  );
});

test("verifySnapshotSeal extracts schema-native block refs before seal", async () => {
  const result = await verifySnapshotSeal({
    ...baseInput,
    blocks: [
      {
        ...baseInput.blocks[0],
        fact_refs: undefined,
        items: [{ label: "Revenue", value_ref: missingId }],
      },
      baseInput.blocks[1],
    ],
  });

  assert.deepEqual(
    result.failures.map((failure) => failure.reason_code),
    ["missing_fact_ref"],
  );
  assert.deepEqual(result.failures[0].details, {
    block_id: "metric-revenue",
    fact_id: missingId,
  });
});

test("verifySnapshotSeal preserves schema-native refs through normalization", async () => {
  const result = await verifySnapshotSeal({
    ...baseInput,
    blocks: [
      {
        ...baseInput.blocks[0],
        kind: "revenue_bars",
        data_ref: { kind: "revenue_bars", id: "revenue-bars" },
        fact_refs: undefined,
        bars: [{ label: "Q1", value_ref: missingId }],
      },
      baseInput.blocks[1],
    ],
  });

  assert.deepEqual(
    result.failures.map((failure) => failure.reason_code),
    ["missing_fact_ref"],
  );
  assert.deepEqual(result.failures[0].details, {
    block_id: "metric-revenue",
    fact_id: missingId,
  });
});

test("verifySnapshotSeal extracts every supported schema-native fact ref shape", async () => {
  const cases = [
    {
      kind: "rich_text",
      block: { segments: [{ type: "ref", ref_kind: "fact", ref_id: missingId }] },
    },
    { kind: "revenue_bars", block: { bars: [{ value_ref: missingId }] } },
    { kind: "segment_donut", block: { segments: [{ value_ref: missingId }] } },
    { kind: "analyst_consensus", block: { analyst_count_ref: missingId } },
    { kind: "analyst_consensus", block: { distribution: [{ count_ref: missingId }] } },
    { kind: "price_target_range", block: { current_price_ref: missingId } },
    { kind: "price_target_range", block: { low_ref: missingId } },
    { kind: "price_target_range", block: { avg_ref: missingId } },
    { kind: "price_target_range", block: { high_ref: missingId } },
    { kind: "price_target_range", block: { upside_ref: missingId } },
    { kind: "eps_surprise", block: { quarters: [{ estimate_ref: missingId }] } },
    { kind: "eps_surprise", block: { quarters: [{ actual_ref: missingId }] } },
    { kind: "eps_surprise", block: { quarters: [{ surprise_ref: missingId }] } },
    {
      kind: "section",
      block: {
        children: [
          {
            ...baseInput.blocks[0],
            kind: "metric_row",
            fact_refs: undefined,
            items: [{ value_ref: missingId }],
          },
        ],
      },
    },
  ];

  for (const [index, item] of cases.entries()) {
    const result = await verifySnapshotSeal({
      ...baseInput,
      blocks: [
        {
          ...baseInput.blocks[0],
          fact_refs: undefined,
          kind: item.kind,
          id: `schema-ref-${index}`,
          data_ref: { kind: item.kind, id: `schema-ref-${index}` },
          ...item.block,
        },
        baseInput.blocks[1],
      ],
    });

    assert.deepEqual(
      result.failures.map((failure) => failure.reason_code),
      ["missing_fact_ref"],
      item.kind,
    );
  }
});

test("verifySnapshotSeal validates evidence provenance sources", async () => {
  const result = await verifySnapshotSeal({
    ...baseInput,
    facts: [
      {
        ...baseInput.facts[0],
        source_id: missingId,
      },
    ],
  });

  assert.deepEqual(
    result.failures.map((failure) => failure.reason_code),
    ["missing_source_ref", "missing_source_ref", "missing_source_ref"],
  );
  assert.deepEqual(result.failures[0].details, {
    fact_id: factId,
    source_id: missingId,
    scope: "fact",
  });
  assert.deepEqual(result.failures[1].details, {
    fact_id: factId,
    source_id: missingId,
    scope: "fact_manifest",
  });
  assert.deepEqual(result.failures[2].details, {
    block_id: "metric-revenue",
    fact_id: factId,
    source_id: missingId,
    scope: "block_fact_source",
  });
});

test("verifySnapshotSeal rejects manifest events without source provenance", async () => {
  const result = await verifySnapshotSeal({
    ...baseInput,
    events: [{ event_id: eventId }],
  });

  assert.deepEqual(
    result.failures.map((failure) => failure.reason_code),
    ["missing_source_ref"],
  );
  assert.deepEqual(result.failures[0].details, {
    event_id: eventId,
    source_id: null,
    scope: "event",
  });
});

test("verifySnapshotSeal rejects manifest claims without source provenance", async () => {
  const result = await verifySnapshotSeal({
    ...baseInput,
    claims: [
      {
        claim_id: claimId,
      },
    ],
  });

  assert.deepEqual(
    result.failures.map((failure) => failure.reason_code),
    ["missing_source_ref"],
  );
  assert.deepEqual(result.failures[0].details, {
    claim_id: claimId,
    source_id: null,
    scope: "claim",
  });
});

test("verifySnapshotSeal rejects manifest facts without source provenance", async () => {
  const result = await verifySnapshotSeal({
    ...baseInput,
    facts: [
      {
        ...baseInput.facts[0],
        source_id: undefined,
      },
    ],
  });

  assert.deepEqual(
    result.failures.map((failure) => failure.reason_code),
    ["missing_source_ref"],
  );
  assert.deepEqual(result.failures[0].details, {
    fact_id: factId,
    source_id: null,
    scope: "fact",
  });
});

test("verifySnapshotSeal reports fact metadata when source provenance is missing", async () => {
  const result = await verifySnapshotSeal({
    ...baseInput,
    facts: [
      {
        fact_id: factId,
      },
    ],
    blocks: [baseInput.blocks[1]],
  });

  assert.deepEqual(
    result.failures.map((failure) => failure.reason_code),
    ["missing_source_ref", "fact_binding_mismatch"],
  );
  assert.deepEqual(result.failures[1].details, {
    fact_id: factId,
    mismatches: ["unit", "period_kind"],
    scope: "fact",
  });
});

test("verifySnapshotSeal rejects incomplete manifest fact metadata even when unrendered", async () => {
  const result = await verifySnapshotSeal({
    ...baseInput,
    facts: [
      {
        ...baseInput.facts[0],
        fiscal_year: null,
        fiscal_period: null,
      },
    ],
    blocks: [baseInput.blocks[1]],
  });

  assert.deepEqual(
    result.failures.map((failure) => failure.reason_code),
    ["fact_binding_mismatch"],
  );
  assert.deepEqual(result.failures[0].details, {
    fact_id: factId,
    mismatches: ["fiscal_year", "fiscal_period"],
    scope: "fact",
  });
});

test("verifySnapshotSeal rejects malformed fact period metadata", async () => {
  const logged: Array<{ reason_code: string; details: unknown }> = [];
  const db = {
    async query<R extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      values?: unknown[],
    ) {
      assert.match(text, /insert into verifier_fail_logs/);
      logged.push({
        reason_code: values?.[2] as string,
        details: JSON.parse(values?.[3] as string),
      });
      return { rows: [] as R[] };
    },
  };

  const malformedPeriod = await verifySnapshotSeal(
    {
      ...baseInput,
      facts: [
        {
          ...baseInput.facts[0],
          period_kind: "calendar_q",
        },
      ],
    },
    db,
  );

  assert.deepEqual(
    malformedPeriod.failures.map((failure) => failure.reason_code),
    ["invalid_verifier_input"],
  );
  assert.deepEqual(malformedPeriod.failures[0].details, {
    error: "verifySnapshotSeal.facts[0].period_kind: must be one of point, fiscal_q, fiscal_y, ttm, range",
  });

  const malformedFiscalYear = await verifySnapshotSeal({
    ...baseInput,
    facts: [
      {
        ...baseInput.facts[0],
        fiscal_year: "2026" as never,
      },
    ],
  });

  assert.deepEqual(
    malformedFiscalYear.failures.map((failure) => failure.reason_code),
    ["invalid_verifier_input"],
  );

  const invalidPeriodDate = await verifySnapshotSeal({
    ...baseInput,
    facts: [
      {
        ...baseInput.facts[0],
        period_kind: "range",
        period_start: "2026-02-31",
        period_end: "2026-04-31",
      },
    ],
  });

  assert.deepEqual(
    invalidPeriodDate.failures.map((failure) => failure.reason_code),
    ["invalid_verifier_input"],
  );
  assert.deepEqual(invalidPeriodDate.failures[0].details, {
    error: "verifySnapshotSeal.facts[0].period_start: must be an ISO date",
  });
  assert.deepEqual(
    logged.map((row) => row.reason_code),
    ["invalid_verifier_input"],
  );
});

test("verifySnapshotSeal logs malformed late verifier inputs", async () => {
  const cases = [
    {
      name: "fact bindings",
      input: {
        ...baseInput,
        blocks: [
          {
            ...baseInput.blocks[0],
            data_ref: {
              ...baseInput.blocks[0].data_ref,
              params: { fact_bindings: "bad" },
            },
          },
          baseInput.blocks[1],
        ],
      },
      error: "verifySnapshotSeal.blocks.metric-revenue.data_ref.params.fact_bindings: must be an array",
    },
    {
      name: "series refs",
      input: {
        ...baseInput,
        blocks: [
          {
            id: "price-chart",
            kind: "line_chart",
            snapshot_id: snapshotId,
            data_ref: {
              kind: "line_chart",
              id: "price-series",
              params: { series_refs: ["not-a-uuid"] },
            },
            source_refs: [sourceId],
            as_of: "2026-04-29T00:00:00.000Z",
          },
          baseInput.blocks[1],
        ],
      },
      error: "verifySnapshotSeal.data_ref.params.series_refs[0]: must be a UUID v4",
    },
    {
      name: "non-array series refs",
      input: {
        ...baseInput,
        blocks: [
          {
            ...baseInput.blocks[0],
            data_ref: {
              ...baseInput.blocks[0].data_ref,
              params: {
                ...baseInput.blocks[0].data_ref.params,
                series_refs: "bad",
              },
            },
          },
          baseInput.blocks[1],
        ],
      },
      error: "verifySnapshotSeal.data_ref.params.series_refs: must be an array",
    },
    {
      name: "non-string series ref",
      input: {
        ...baseInput,
        blocks: [
          {
            ...baseInput.blocks[0],
            data_ref: {
              ...baseInput.blocks[0].data_ref,
              params: {
                ...baseInput.blocks[0].data_ref.params,
                series_ref: 123,
              },
            },
          },
          baseInput.blocks[1],
        ],
      },
      error: "verifySnapshotSeal.data_ref.params.series_ref: must be a UUID v4",
    },
    {
      name: "manifest series source",
      input: {
        ...baseInput,
        manifest: {
          ...baseInput.manifest,
          series_specs: [{ series_ref: seriesRef, source_id: "not-a-uuid" }],
        },
      },
      error: "verifySnapshotSeal.manifest.series_specs.source_id: must be a UUID v4",
    },
    {
      name: "non-object manifest series spec",
      input: {
        ...baseInput,
        manifest: {
          ...baseInput.manifest,
          series_specs: [seriesRef],
        },
      },
      error: "verifySnapshotSeal.manifest.series_specs[0]: must be an object",
    },
    {
      name: "manifest subject kind",
      input: {
        ...baseInput,
        manifest: {
          ...baseInput.manifest,
          subject_refs: [{ kind: "watchlist", id: subjectId }],
        },
      },
      error: "verifySnapshotSeal.manifest.subject_refs[0].kind: must be one of issuer, instrument, listing, theme, macro_topic, portfolio, screen",
    },
    {
      name: "manifest basis",
      input: {
        ...baseInput,
        manifest: {
          ...baseInput.manifest,
          basis: "calendar_adjusted",
        },
      },
      error: "verifySnapshotSeal.manifest.basis: must be one of unadjusted, split_adjusted, split_and_div_adjusted, reported, restated",
    },
    {
      name: "manifest normalization",
      input: {
        ...baseInput,
        manifest: {
          ...baseInput.manifest,
          normalization: "weird",
        },
      },
      error: "verifySnapshotSeal.manifest.normalization: must be one of raw, pct_return, index_100, currency_normalized",
    },
    {
      name: "non-array block payload field",
      input: {
        ...baseInput,
        blocks: [
          {
            ...baseInput.blocks[0],
            fact_refs: undefined,
            items: "bad",
          },
          baseInput.blocks[1],
        ],
      },
      error: "verifySnapshotSeal.blocks[0].items: must be an array",
    },
    {
      name: "non-object data ref params",
      input: {
        ...baseInput,
        blocks: [
          {
            ...baseInput.blocks[0],
            data_ref: {
              ...baseInput.blocks[0].data_ref,
              params: [],
            },
          },
          baseInput.blocks[1],
        ],
      },
      error: "verifySnapshotSeal.blocks[0].data_ref.params: must be an object",
    },
    {
      name: "schema-native ref",
      input: {
        ...baseInput,
        blocks: [
          {
            ...baseInput.blocks[0],
            fact_refs: undefined,
            items: [{ label: "Revenue", value_ref: "not-a-uuid" }],
          },
          baseInput.blocks[1],
        ],
      },
      error: "verifySnapshotSeal.fact_ref: must be a UUID v4",
    },
    {
      name: "non-string schema-native ref",
      input: {
        ...baseInput,
        blocks: [
          {
            ...baseInput.blocks[0],
            fact_refs: undefined,
            items: [{ label: "Revenue", value_ref: 123 }],
          },
          baseInput.blocks[1],
        ],
      },
      error: "verifySnapshotSeal.fact_ref: must be a UUID v4",
    },
    {
      name: "empty schema-native ref",
      input: {
        ...baseInput,
        blocks: [
          {
            ...baseInput.blocks[0],
            fact_refs: undefined,
            items: [{ label: "Revenue", value_ref: "" }],
          },
          baseInput.blocks[1],
        ],
      },
      error: "verifySnapshotSeal.fact_ref: must be a UUID v4",
    },
    {
      name: "disclosure source ref",
      input: {
        ...baseInput,
        required_disclosures: [
          {
            ...baseInput.required_disclosures[0],
            source_refs: ["not-a-uuid"],
          },
        ],
      },
      error: "verifySnapshotSeal.required_disclosures[0].source_refs[0]: must be a UUID v4",
    },
    {
      name: "non-array disclosure source refs",
      input: {
        ...baseInput,
        required_disclosures: [
          {
            ...baseInput.required_disclosures[0],
            source_refs: "bad",
          },
        ],
      },
      error: "verifySnapshotSeal.required_disclosures[0].source_refs: must be an array",
    },
    {
      name: "disclosure fact refs",
      input: {
        ...baseInput,
        required_disclosures: [
          {
            ...baseInput.required_disclosures[0],
            fact_refs: ["not-a-uuid"],
          },
        ],
      },
      error: "verifySnapshotSeal.required_disclosures[0].fact_refs[0]: must be a UUID v4",
    },
    {
      name: "non-array disclosure series refs",
      input: {
        ...baseInput,
        required_disclosures: [
          {
            ...baseInput.required_disclosures[0],
            series_refs: "bad",
          },
        ],
      },
      error: "verifySnapshotSeal.required_disclosures[0].series_refs: must be an array",
    },
    {
      name: "disclosure code",
      input: {
        ...baseInput,
        required_disclosures: [
          {
            ...baseInput.required_disclosures[0],
            code: "unknown",
          },
        ],
      },
      error: "verifySnapshotSeal.required_disclosures[0].code: must be one of delayed_pricing, eod_pricing, filing_time_basis, low_coverage, candidate_data, fx_converted_values",
    },
    {
      name: "disclosure tier",
      input: {
        ...baseInput,
        required_disclosures: [
          {
            ...baseInput.required_disclosures[0],
            tier: "unknown",
          },
        ],
      },
      error: "verifySnapshotSeal.required_disclosures[0].tier: must be one of real_time, delayed_15m, eod, filing_time, estimate, candidate, tertiary_source",
    },
    {
      name: "disclosure item",
      input: {
        ...baseInput,
        required_disclosures: [
          {
            ...baseInput.required_disclosures[0],
            item: "",
          },
        ],
      },
      error: "verifySnapshotSeal.required_disclosures[0].item: must be a non-empty string",
    },
  ] as const;

  for (const testCase of cases) {
    const logged: Array<{ reason_code: string; details: unknown }> = [];
    const db = {
      async query<R extends Record<string, unknown> = Record<string, unknown>>(
        text: string,
        values?: unknown[],
      ) {
        assert.match(text, /insert into verifier_fail_logs/);
        logged.push({
          reason_code: values?.[2] as string,
          details: JSON.parse(values?.[3] as string),
        });
        return { rows: [] as R[] };
      },
    };

    const result = await verifySnapshotSeal(testCase.input, db);

    assert.deepEqual(
      result.failures.map((failure) => failure.reason_code),
      ["invalid_verifier_input"],
      testCase.name,
    );
    assert.deepEqual(result.failures[0].details, { error: testCase.error }, testCase.name);
    assert.deepEqual(
      logged.map((row) => row.reason_code),
      ["invalid_verifier_input"],
      testCase.name,
    );
  }
});

test("verifySnapshotSeal requires evidence provenance in manifest and block source refs", async () => {
  const manifestResult = await verifySnapshotSeal({
    ...baseInput,
    facts: [
      {
        ...baseInput.facts[0],
        source_id: missingId,
      },
    ],
    sources: [{ source_id: sourceId }, { source_id: missingId }],
  });

  assert.deepEqual(
    manifestResult.failures.map((failure) => failure.reason_code),
    ["missing_source_ref", "missing_source_ref"],
  );
  assert.deepEqual(manifestResult.failures[0].details, {
    fact_id: factId,
    source_id: missingId,
    scope: "fact_manifest",
  });
  assert.deepEqual(manifestResult.failures[1].details, {
    block_id: "metric-revenue",
    fact_id: factId,
    source_id: missingId,
    scope: "block_fact_source",
  });

  const blockResult = await verifySnapshotSeal({
    ...baseInput,
    manifest: {
      ...baseInput.manifest,
      source_ids: [sourceId, missingId],
    },
    facts: [
      {
        ...baseInput.facts[0],
        source_id: missingId,
      },
    ],
    sources: [{ source_id: sourceId }, { source_id: missingId }],
    blocks: [
      {
        ...baseInput.blocks[0],
        source_refs: [sourceId],
      },
      {
        ...baseInput.blocks[1],
        source_refs: [sourceId, missingId],
      },
    ],
  });

  assert.deepEqual(
    blockResult.failures.map((failure) => failure.reason_code),
    ["missing_source_ref"],
  );
  assert.deepEqual(blockResult.failures[0].details, {
    block_id: "metric-revenue",
    fact_id: factId,
    source_id: missingId,
    scope: "block_fact_source",
  });
});

test("verifySnapshotSeal requires fact binding sources in block source refs", async () => {
  const result = await verifySnapshotSeal({
    ...baseInput,
    blocks: [
      {
        ...baseInput.blocks[0],
        source_refs: [],
        fact_refs: undefined,
        claim_refs: undefined,
        event_refs: undefined,
      },
      baseInput.blocks[1],
    ],
  });

  assert.deepEqual(
    result.failures.map((failure) => failure.reason_code),
    ["missing_source_ref"],
  );
  assert.deepEqual(result.failures[0].details, {
    block_id: "metric-revenue",
    fact_id: factId,
    source_id: sourceId,
    scope: "block_fact_source",
  });
});

test("verifySnapshotSeal checks block source refs against the source catalog", async () => {
  const result = await verifySnapshotSeal({
    ...baseInput,
    manifest: {
      ...baseInput.manifest,
      source_ids: [sourceId, missingId],
    },
    sources: [{ source_id: sourceId }],
    blocks: [
      {
        ...baseInput.blocks[0],
        source_refs: [sourceId, missingId],
      },
      {
        ...baseInput.blocks[1],
        source_refs: [sourceId, missingId],
      },
    ],
  });

  assert.deepEqual(
    result.failures.map((failure) => failure.reason_code),
    ["missing_source_ref", "missing_source_ref", "missing_source_ref", "missing_source_ref"],
  );
  assert.deepEqual(result.failures[1].details, {
    block_id: "metric-revenue",
    source_id: missingId,
    scope: "block_source",
  });
});

test("verifySnapshotSeal rejects unsealed data refs and raw numeric payloads", async () => {
  const arbitraryDataRef = await verifySnapshotSeal({
    ...baseInput,
    blocks: [
      {
        ...baseInput.blocks[0],
        data_ref: { kind: "unsealed_cache", id: "latest-price" },
      },
      baseInput.blocks[1],
    ],
  });

  assert.deepEqual(
    arbitraryDataRef.failures.map((failure) => failure.reason_code),
    ["invalid_block_binding", "fact_binding_mismatch"],
  );
  assert.deepEqual(arbitraryDataRef.failures[0].details, {
    block_id: "metric-revenue",
    field: "data_ref.kind",
    expected: "metric_row",
    actual: "unsealed_cache",
  });

  const rawChart = await verifySnapshotSeal({
    ...baseInput,
    blocks: [
      {
        id: "price-chart",
        kind: "line_chart",
        snapshot_id: snapshotId,
        data_ref: { kind: "line_chart", id: "raw-prices" },
        source_refs: [sourceId],
        as_of: "2026-04-29T00:00:00.000Z",
        series: [{ name: "Price", points: [{ x: "2026-04-29", y: 100 }] }],
      },
      baseInput.blocks[1],
    ],
  });

  assert.deepEqual(
    rawChart.failures.map((failure) => failure.reason_code),
    ["invalid_block_binding"],
  );
  assert.deepEqual(rawChart.failures[0].details, {
    block_id: "price-chart",
    field: "data_ref",
    reason: "missing_sealed_series_or_refs",
  });
});

test("verifySnapshotSeal rejects malformed data_ref snapshot ids", async () => {
  const result = await verifySnapshotSeal({
    ...baseInput,
    blocks: [
      {
        ...baseInput.blocks[0],
        data_ref: {
          ...baseInput.blocks[0].data_ref,
          params: {
            ...baseInput.blocks[0].data_ref.params,
            snapshot_id: 12,
          },
        },
      },
      baseInput.blocks[1],
    ],
  });

  assert.deepEqual(
    result.failures.map((failure) => failure.reason_code),
    ["invalid_block_binding"],
  );
  assert.deepEqual(result.failures[0].details, {
    block_id: "metric-revenue",
    field: "data_ref.params.snapshot_id",
    expected: snapshotId,
    actual: 12,
  });
});

test("verifySnapshotSeal validates unrendered series spec source provenance", async () => {
  const result = await verifySnapshotSeal({
    ...baseInput,
    manifest: {
      ...baseInput.manifest,
      series_specs: [
        { series_ref: seriesRef, source_id: sourceId },
        { source_id: missingId },
      ],
    },
  });

  assert.deepEqual(
    result.failures.map((failure) => failure.reason_code),
    ["missing_source_ref", "missing_source_ref"],
  );
  assert.deepEqual(result.failures[0].details, {
    series_ref: null,
    source_id: missingId,
    scope: "series_source",
  });
  assert.deepEqual(result.failures[1].details, {
    series_ref: null,
    source_id: missingId,
    scope: "series_manifest_source",
  });
});

test("verifySnapshotSeal rejects manifest series specs without source provenance", async () => {
  const result = await verifySnapshotSeal({
    ...baseInput,
    manifest: {
      ...baseInput.manifest,
      series_specs: [{ series_ref: otherSeriesRef }],
    },
  });

  assert.deepEqual(
    result.failures.map((failure) => failure.reason_code),
    ["missing_source_ref"],
  );
  assert.deepEqual(result.failures[0].details, {
    series_ref: otherSeriesRef,
    source_id: null,
    scope: "series",
  });
});

test("verifySnapshotSeal validates series source provenance", async () => {
  const result = await verifySnapshotSeal({
    ...baseInput,
    manifest: {
      ...baseInput.manifest,
      source_ids: [sourceId, missingId],
      series_specs: [{ series_ref: seriesRef, source_id: missingId }],
    },
    sources: [{ source_id: sourceId }, { source_id: missingId }],
    blocks: [
      {
        id: "price-chart",
        kind: "line_chart",
        snapshot_id: snapshotId,
        data_ref: {
          kind: "line_chart",
          id: "price-series",
          params: { series_refs: [seriesRef] },
        },
        source_refs: [sourceId],
        as_of: "2026-04-29T00:00:00.000Z",
        series: [{ name: "Price", points: [{ x: "2026-04-29", y: 100 }] }],
      },
      {
        ...baseInput.blocks[1],
        source_refs: [sourceId, missingId],
      },
    ],
  });

  assert.deepEqual(
    result.failures.map((failure) => failure.reason_code),
    ["missing_source_ref"],
  );
  assert.deepEqual(result.failures[0].details, {
    block_id: "price-chart",
    series_ref: seriesRef,
    source_id: missingId,
    scope: "block_series_source",
  });
});

test("verifySnapshotSeal rejects series refs with missing source provenance", async () => {
  const result = await verifySnapshotSeal({
    ...baseInput,
    manifest: {
      ...baseInput.manifest,
      series_specs: [{ series_ref: otherSeriesRef }],
    },
    blocks: [
      {
        id: "price-chart",
        kind: "line_chart",
        snapshot_id: snapshotId,
        data_ref: {
          kind: "line_chart",
          id: "price-series",
          params: { series_refs: [otherSeriesRef] },
        },
        source_refs: [sourceId],
        as_of: "2026-04-29T00:00:00.000Z",
        series: [{ name: "Price", points: [{ x: "2026-04-29", y: 100 }] }],
      },
      baseInput.blocks[1],
    ],
  });

  assert.deepEqual(
    result.failures.map((failure) => failure.reason_code),
    ["missing_source_ref", "missing_source_ref"],
  );
  assert.deepEqual(result.failures[0].details, {
    series_ref: otherSeriesRef,
    source_id: null,
    scope: "series",
  });
  assert.deepEqual(result.failures[1].details, {
    block_id: "price-chart",
    series_ref: otherSeriesRef,
    source_id: null,
    scope: "series",
  });
});

test("verifySnapshotSeal accepts numeric blocks backed by sealed series specs", async () => {
  const result = await verifySnapshotSeal({
    ...baseInput,
    blocks: [
      {
        id: "price-chart",
        kind: "line_chart",
        snapshot_id: snapshotId,
        data_ref: {
          kind: "line_chart",
          id: "price-series",
          params: { series_refs: [seriesRef] },
        },
        source_refs: [sourceId],
        as_of: "2026-04-29T00:00:00.000Z",
        series: [{ name: "Price", points: [{ x: "2026-04-29", y: 100 }] }],
      },
      baseInput.blocks[1],
    ],
  });

  assert.deepEqual(result, {
    ok: true,
    failures: [],
  });
});

test("verifySnapshotSeal validates sources block item provenance", async () => {
  const result = await verifySnapshotSeal({
    ...baseInput,
    blocks: [
      {
        id: "sources-list",
        kind: "sources",
        snapshot_id: snapshotId,
        data_ref: { kind: "sources", id: "sources-list" },
        source_refs: [],
        as_of: "2026-04-29T00:00:00.000Z",
        items: [{ source_id: missingId }],
      },
      baseInput.blocks[1],
    ],
  });

  assert.deepEqual(
    result.failures.map((failure) => failure.reason_code),
    ["missing_source_ref", "missing_source_ref", "missing_source_ref"],
  );
  assert.deepEqual(result.failures[0].details, {
    block_id: "sources-list",
    source_id: missingId,
    scope: "block_source",
  });
  assert.deepEqual(result.failures[1].details, {
    block_id: "sources-list",
    source_id: missingId,
    scope: "block_source_manifest",
  });
  assert.deepEqual(result.failures[2].details, {
    block_id: "sources-list",
    source_id: missingId,
    scope: "block_source_ref",
  });
});

test("verifySnapshotSeal rejects block subject refs outside the manifest", async () => {
  const result = await verifySnapshotSeal({
    ...baseInput,
    blocks: [
      {
        ...baseInput.blocks[0],
        kind: "perf_comparison",
        data_ref: {
          kind: "perf_comparison",
          id: "perf-series",
          params: { series_refs: [seriesRef] },
        },
        fact_refs: undefined,
        claim_refs: undefined,
        event_refs: undefined,
        subject_refs: [{ kind: "listing", id: otherSubjectId }],
      },
      {
        ...baseInput.blocks[0],
        id: "metrics-comparison",
        kind: "metrics_comparison",
        data_ref: {
          kind: "metrics_comparison",
          id: "metrics-series",
          params: { series_refs: [seriesRef] },
        },
        fact_refs: undefined,
        claim_refs: undefined,
        event_refs: undefined,
        subjects: [{ kind: "listing", id: otherSubjectId }],
      },
      baseInput.blocks[1],
    ],
  });

  assert.deepEqual(
    result.failures.map((failure) => failure.reason_code),
    ["missing_subject_ref", "missing_subject_ref"],
  );
  assert.deepEqual(result.failures[0].details, {
    block_id: "metric-revenue",
    subject_ref: { kind: "listing", id: otherSubjectId },
  });
  assert.deepEqual(result.failures[1].details, {
    block_id: "metrics-comparison",
    subject_ref: { kind: "listing", id: otherSubjectId },
  });
});

test("verifySnapshotSeal validates nested child blocks as blocks", async () => {
  const result = await verifySnapshotSeal({
    ...baseInput,
    blocks: [
      {
        ...baseInput.blocks[0],
        kind: "section",
        data_ref: { kind: "section", id: "summary" },
        fact_refs: undefined,
        claim_refs: undefined,
        event_refs: undefined,
        children: [
          {
            ...baseInput.blocks[0],
            id: "nested-metric",
            snapshot_id: missingId,
            as_of: "2026-04-30T00:00:00.000Z",
            source_refs: [],
            claim_refs: undefined,
            event_refs: undefined,
            data_ref: {
              ...baseInput.blocks[0].data_ref,
              params: {
                fact_bindings: [
                  {
                    fact_id: factId,
                    unit: "shares",
                    period_kind: "fiscal_q",
                    fiscal_year: 2026,
                    fiscal_period: "Q2",
                  },
                ],
              },
            },
          },
        ],
      },
      baseInput.blocks[1],
    ],
  });

  assert.deepEqual(
    result.failures.map((failure) => failure.reason_code),
    [
      "invalid_block_binding",
      "block_after_snapshot_as_of",
      "missing_source_ref",
      "fact_binding_mismatch",
    ],
  );
});

test("verifySnapshotSeal rejects fact bindings outside the manifest", async () => {
  const result = await verifySnapshotSeal({
    ...baseInput,
    manifest: {
      ...baseInput.manifest,
      fact_refs: [],
    },
    blocks: [
      {
        ...baseInput.blocks[0],
        fact_refs: undefined,
      },
      baseInput.blocks[1],
    ],
  });

  assert.deepEqual(
    result.failures.map((failure) => failure.reason_code),
    ["missing_fact_ref"],
  );
  assert.deepEqual(result.failures[0].details, {
    block_id: "metric-revenue",
    fact_id: factId,
  });
});

test("verifySnapshotSeal requires rendered fact refs to have unit and period bindings", async () => {
  const unbound = await verifySnapshotSeal({
    ...baseInput,
    blocks: [
      {
        ...baseInput.blocks[0],
        data_ref: {
          ...baseInput.blocks[0].data_ref,
          params: { fact_bindings: [] },
        },
      },
      baseInput.blocks[1],
    ],
  });

  assert.deepEqual(
    unbound.failures.map((failure) => failure.reason_code),
    ["fact_binding_mismatch"],
  );
  assert.deepEqual(unbound.failures[0].details, {
    block_id: "metric-revenue",
    fact_id: factId,
    mismatches: ["missing_binding"],
  });

  const incomplete = await verifySnapshotSeal({
    ...baseInput,
    blocks: [
      {
        ...baseInput.blocks[0],
        data_ref: {
          ...baseInput.blocks[0].data_ref,
          params: { fact_bindings: [{ fact_id: factId }] },
        },
      },
      baseInput.blocks[1],
    ],
  });

  assert.deepEqual(
    incomplete.failures.map((failure) => failure.reason_code),
    ["fact_binding_mismatch"],
  );
  assert.deepEqual(incomplete.failures[0].details, {
    block_id: "metric-revenue",
    fact_id: factId,
    mismatches: ["unit", "period_kind", "fiscal_year", "fiscal_period"],
  });

  const missingFactMetadata = await verifySnapshotSeal({
    ...baseInput,
    facts: [
      {
        fact_id: factId,
        source_id: sourceId,
      },
    ],
    blocks: [
      {
        ...baseInput.blocks[0],
        data_ref: {
          ...baseInput.blocks[0].data_ref,
          params: { fact_bindings: [{ fact_id: factId }] },
        },
      },
      baseInput.blocks[1],
    ],
  });

  assert.deepEqual(
    missingFactMetadata.failures.map((failure) => failure.reason_code),
    ["fact_binding_mismatch"],
  );
  assert.deepEqual(missingFactMetadata.failures[0].details, {
    block_id: "metric-revenue",
    fact_id: factId,
    mismatches: ["unit", "period_kind"],
  });

  const nullPeriod = await verifySnapshotSeal({
    ...baseInput,
    facts: [
      {
        ...baseInput.facts[0],
        fiscal_year: null,
        fiscal_period: null,
      },
    ],
    blocks: [
      {
        ...baseInput.blocks[0],
        data_ref: {
          ...baseInput.blocks[0].data_ref,
          params: {
            fact_bindings: [
              {
                fact_id: factId,
                unit: "USD",
                period_kind: "fiscal_q",
                fiscal_year: null,
                fiscal_period: null,
              },
            ],
          },
        },
      },
      baseInput.blocks[1],
    ],
  });

  assert.deepEqual(
    nullPeriod.failures.map((failure) => failure.reason_code),
    ["fact_binding_mismatch"],
  );
  assert.deepEqual(nullPeriod.failures[0].details, {
    block_id: "metric-revenue",
    fact_id: factId,
    mismatches: ["fiscal_year", "fiscal_period"],
  });
});

test("verifySnapshotSeal dedupes missing fact refs across rendered refs and bindings", async () => {
  const result = await verifySnapshotSeal({
    ...baseInput,
    manifest: {
      ...baseInput.manifest,
      fact_refs: [],
    },
  });

  assert.deepEqual(
    result.failures.map((failure) => failure.reason_code),
    ["missing_fact_ref"],
  );
  assert.deepEqual(result.failures[0].details, {
    block_id: "metric-revenue",
    fact_id: factId,
  });
});

test("verifySnapshotSeal recognizes nested disclosure blocks", async () => {
  const result = await verifySnapshotSeal({
    ...baseInput,
    blocks: [
      {
        ...baseInput.blocks[0],
        kind: "section",
        data_ref: { kind: "section", id: "summary" },
        fact_refs: undefined,
        claim_refs: undefined,
        event_refs: undefined,
        children: [baseInput.blocks[1]],
      },
    ],
  });

  assert.deepEqual(result, {
    ok: true,
    failures: [],
  });
});

test("verifySnapshotSeal accepts schema-native disclosure data refs", async () => {
  const result = await verifySnapshotSeal({
    ...baseInput,
    blocks: [
      baseInput.blocks[0],
      {
        ...baseInput.blocks[1],
        data_ref: { kind: "disclosure", id: "required" },
      },
    ],
  });

  assert.deepEqual(result, {
    ok: true,
    failures: [],
  });
});

test("verifySnapshotSeal accepts deterministic pending approval ids", async () => {
  const result = await verifySnapshotSeal({
    ...baseInput,
    tool_actions: [
      {
        ...baseInput.tool_actions[0],
        pending_action_id: pendingActionId,
      },
    ],
  });

  assert.deepEqual(result, {
    ok: true,
    failures: [],
  });
});

test("verifySnapshotSeal allows write intents that do not require approval", async () => {
  const result = await verifySnapshotSeal({
    ...baseInput,
    tool_actions: [
      {
        tool_name: "add_to_watchlist",
        read_only: false,
        approval_required: false,
      },
    ],
  });

  assert.deepEqual(result, {
    ok: true,
    failures: [],
  });
});

test("verifySnapshotSeal requires disclosure tier and source provenance", async () => {
  const wrongTier = await verifySnapshotSeal({
    ...baseInput,
    blocks: [
      baseInput.blocks[0],
      {
        ...baseInput.blocks[1],
        disclosure_tier: "delayed_15m",
      },
    ],
  });

  assert.deepEqual(
    wrongTier.failures.map((failure) => failure.reason_code),
    ["missing_required_disclosure"],
  );
  assert.deepEqual(wrongTier.failures[0].details, {
    code: "filing_time_basis",
    item: baseInput.required_disclosures[0].item,
    tier: "filing_time",
    source_refs: [sourceId],
  });

  const missingSource = await verifySnapshotSeal({
    ...baseInput,
    blocks: [
      baseInput.blocks[0],
      {
        ...baseInput.blocks[1],
        source_refs: [],
      },
    ],
  });

  assert.deepEqual(
    missingSource.failures.map((failure) => failure.reason_code),
    ["missing_required_disclosure"],
  );
  assert.deepEqual(missingSource.failures[0].details, {
    code: "filing_time_basis",
    item: baseInput.required_disclosures[0].item,
    tier: "filing_time",
    source_refs: [sourceId],
  });

  const emptySource = await verifySnapshotSeal({
    ...baseInput,
    required_disclosures: [
      {
        ...baseInput.required_disclosures[0],
        source_refs: [],
      },
    ],
    blocks: [
      baseInput.blocks[0],
      {
        ...baseInput.blocks[1],
        source_refs: [],
      },
    ],
  });

  assert.deepEqual(
    emptySource.failures.map((failure) => failure.reason_code),
    ["missing_required_disclosure", "missing_source_ref"],
  );
  assert.deepEqual(emptySource.failures[1].details, {
    code: "filing_time_basis",
    source_id: null,
    scope: "required_disclosure_source",
  });
});

test("verifySnapshotSeal accepts aggregate disclosure blocks with stricter tiers", async () => {
  const result = await verifySnapshotSeal({
    ...baseInput,
    blocks: [
      baseInput.blocks[0],
      {
        ...baseInput.blocks[1],
        disclosure_tier: "candidate",
      },
    ],
  });

  assert.deepEqual(result, {
    ok: true,
    failures: [],
  });
});

test("verifySnapshotSeal rejects write intents without approval metadata", async () => {
  const result = await verifySnapshotSeal({
    ...baseInput,
    tool_actions: [
      {
        tool_name: "create_alert",
        read_only: false,
      },
    ],
  });

  assert.deepEqual(
    result.failures.map((failure) => failure.reason_code),
    ["unapproved_side_effect"],
  );
  assert.deepEqual(result.failures[0].details, {
    tool_name: "create_alert",
    tool_call_id: null,
    approval_required: null,
    pending_action_id: null,
  });
});

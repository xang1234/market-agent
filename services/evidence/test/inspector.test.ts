import assert from "node:assert/strict";
import test from "node:test";

import {
  loadEvidenceInspection,
  EvidenceInspectionError,
  type EvidenceInspectionRef,
} from "../src/inspector.ts";
import {
  GDELT_ARTICLE_DISCOVERY_PROVIDER,
  GDELT_DISCOVERY_DISCLOSURE,
  GDELT_DISCOVERY_LICENSE_CLASS,
  GDELT_DISCOVERY_TRUST_TIER,
} from "../src/gdelt-source.ts";
import { fakePgQuery } from "./fakes.ts";

type QueryCall = { text: string; values?: unknown[] };

const USER_ID = "00000000-0000-4000-8000-000000000001";
const SNAPSHOT_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_ID = "22222222-2222-4222-8222-222222222222";
const DOCUMENT_ID = "33333333-3333-4333-8333-333333333333";
const CLAIM_ID = "44444444-4444-4444-8444-444444444444";
const EVENT_ID = "55555555-5555-4555-8555-555555555555";
const FACT_ID = "66666666-6666-4666-8666-666666666666";
const OUT_OF_SNAPSHOT_SOURCE_ID = "77777777-7777-4777-8777-777777777777";
const OUT_OF_SNAPSHOT_DOCUMENT_ID = "88888888-8888-4888-8888-888888888888";
const SERIES_REF = "99999999-9999-4999-8999-999999999999";
const LISTING_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SERIES_SPEC = {
  series_ref: SERIES_REF,
  source_id: SOURCE_ID,
  listing_id: LISTING_ID,
  bar_range_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  bars_sha256: "3f9a1c0e7b2d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789ab",
  interval: "1d",
  adjustment_basis: "split_adjusted",
  normalization: "pct_return",
  points: "perf_lines",
  delay_class: "eod",
  range: { start: "2025-10-01T00:00:00.000Z", end: "2026-10-15T00:00:00.000Z" },
  window: { kind: "ytd", year: 2026, baseline_date: "2025-12-31", end_date: "2026-10-15" },
  as_of: "2026-10-15T20:00:00.000Z",
};

function stubDb(rowsByQuery: (text: string, values?: unknown[]) => unknown[]) {
  const calls: QueryCall[] = [];
  return {
    calls,
    db: {
      query: fakePgQuery((text, values) => {
        calls.push({ text, values });
        return { rows: rowsByQuery(text, values) };
      }),
    },
  };
}

test("loadEvidenceInspection rejects malformed refs before querying", async () => {
  const { db, calls } = stubDb(() => []);
  await assert.rejects(
    () =>
      loadEvidenceInspection(db, {
        user_id: USER_ID,
        snapshot_id: SNAPSHOT_ID,
        ref: { kind: "claim", id: "not-a-uuid" } as EvidenceInspectionRef,
      }),
    /ref.id must be a UUID/,
  );
  assert.equal(calls.length, 0);
});

test("loadEvidenceInspection hides snapshots that are not visible through a user-owned artifact", async () => {
  const { db, calls } = stubDb(() => []);
  await assert.rejects(
    () =>
      loadEvidenceInspection(db, {
        user_id: USER_ID,
        snapshot_id: SNAPSHOT_ID,
        ref: { kind: "source", id: SOURCE_ID },
      }),
    (err: Error) =>
      err instanceof EvidenceInspectionError &&
      err.status === 404 &&
      /snapshot is not visible/.test(err.message),
  );
  assert.equal(calls.some((call) => call.text.includes("from snapshots")), false);
});

test("loadEvidenceInspection recognizes discovery candidate ownership as a snapshot visibility branch", async () => {
  const { db, calls } = stubDb((text) => {
    if (text.includes("discovery_candidates")) return [{ visible: 1 }];
    if (text.includes("from snapshots")) return [manifestRow()];
    if (text.includes("from sources")) return [sourceRow({ source_id: SOURCE_ID })];
    return [];
  });
  const result = await loadEvidenceInspection(db, { user_id: USER_ID, snapshot_id: SNAPSHOT_ID, ref: { kind: "source", id: SOURCE_ID } });
  assert.equal(result.kind, "source");
  const ownership = calls.find((call) => call.text.includes("discovery_candidates"))?.text ?? "";
  assert.match(ownership, /discovery_candidates/);
  assert.match(ownership, /discovery_runs/);
  assert.match(ownership, /discovery_campaigns/);
});

test("loadEvidenceInspection returns source details only when source belongs to snapshot", async () => {
  const { db, calls } = stubDb((text) => {
    if (text.includes("from chat_messages")) return [{ visible: 1 }];
    if (text.includes("from snapshots")) return [manifestRow()];
    if (text.includes("from sources")) return [sourceRow({ source_id: SOURCE_ID })];
    return [];
  });

  const result = await loadEvidenceInspection(db, {
    user_id: USER_ID,
    snapshot_id: SNAPSHOT_ID,
    ref: { kind: "source", id: SOURCE_ID },
  });

  assert.equal(calls.some((call) => call.text.includes("from chat_messages")), true);
  assert.equal(result.kind, "source");
  assert.equal(result.snapshot_id, SNAPSHOT_ID);
  assert.equal(result.ref.id, SOURCE_ID);
  assert.equal(result.title, "sec filing");
  assert.deepEqual(result.badges, ["primary", "public"]);
  assert.equal(result.rows[0]?.label, "Provider");
  assert.equal(result.rows[0]?.value, "sec");
  assert.deepEqual(result.links, [{ label: "Open source", href: "https://www.sec.gov/Archives/example" }]);
  assertNoRawFields(result);
});

test("loadEvidenceInspection omits unsafe canonical_url links", async () => {
  const { db } = stubDb((text) => {
    if (text.includes("from chat_messages")) return [{ visible: 1 }];
    if (text.includes("from snapshots")) return [manifestRow()];
    if (text.includes("from sources")) {
      return [sourceRow({ source_id: SOURCE_ID, canonical_url: "javascript:alert(1)" })];
    }
    return [];
  });

  const result = await loadEvidenceInspection(db, {
    user_id: USER_ID,
    snapshot_id: SNAPSHOT_ID,
    ref: { kind: "source", id: SOURCE_ID },
  });

  assert.equal(result.subtitle, "javascript:alert(1)");
  assert.deepEqual(result.links, []);
});

test("loadEvidenceInspection returns artifact-safe document details and related source ref", async () => {
  const { db, calls } = stubDb((text) => {
    if (text.includes("from chat_messages")) return [{ visible: 1 }];
    if (text.includes("from snapshots")) return [manifestRow()];
    if (text.includes("from documents")) {
      return [
        {
          document_id: DOCUMENT_ID,
          source_id: SOURCE_ID,
          kind: "filing",
          title: "FY 2026 10-K",
          author: "Apple Inc.",
          published_at: "2026-05-29T00:00:00.000Z",
          parse_status: "parsed",
          provider: "sec",
          canonical_url: "https://www.sec.gov/Archives/example",
          trust_tier: "primary",
          license_class: "public",
          content_hash: "document-hash-must-not-leak",
          raw_blob_id: "sha256:document-raw-blob-must-not-leak",
        },
      ];
    }
    return [];
  });

  const result = await loadEvidenceInspection(db, {
    user_id: USER_ID,
    snapshot_id: SNAPSHOT_ID,
    ref: { kind: "document", id: DOCUMENT_ID },
  });

  assert.equal(calls.some((call) => call.text.includes("from chat_messages")), true);
  assert.equal(result.kind, "document");
  assert.equal(result.title, "FY 2026 10-K");
  assert.ok(result.rows.length >= 2);
  assert.deepEqual(result.related_refs, [{ kind: "source", id: SOURCE_ID, label: "sec" }]);
  assertNoRawFields(result);
});

test("loadEvidenceInspection discloses GDELT documents as metadata-only discovery sources", async () => {
  const { db } = stubDb((text) => {
    if (text.includes("from chat_messages")) return [{ visible: 1 }];
    if (text.includes("from snapshots")) return [manifestRow()];
    if (text.includes("from documents")) {
      return [
        {
          document_id: DOCUMENT_ID,
          source_id: SOURCE_ID,
          kind: "article",
          title: "Acme Robotics wins order as shares rise",
          author: "reuters.com",
          published_at: "2026-05-29T12:30:00.000Z",
          parse_status: "pending",
          provider: GDELT_ARTICLE_DISCOVERY_PROVIDER,
          canonical_url: "https://reuters.com/markets/acme-robotics",
          trust_tier: GDELT_DISCOVERY_TRUST_TIER,
          license_class: GDELT_DISCOVERY_LICENSE_CLASS,
          raw_blob_id: `ephemeral:${SOURCE_ID}`,
          raw_text: "FULL ARTICLE BODY MUST NOT LEAK",
        },
      ];
    }
    return [];
  });

  const result = await loadEvidenceInspection(db, {
    user_id: USER_ID,
    snapshot_id: SNAPSHOT_ID,
    ref: { kind: "document", id: DOCUMENT_ID },
  });

  assert.ok(result.badges.includes("metadata_only"));
  assert.deepEqual(
    result.rows.find((row) => row.label === "Disclosure"),
    { label: "Disclosure", value: GDELT_DISCOVERY_DISCLOSURE },
  );
  assertNoRawFields(result);
});

test("loadEvidenceInspection returns artifact-safe claim details and related document/source refs", async () => {
  const { db, calls } = stubDb((text) => {
    if (text.includes("from chat_messages")) return [{ visible: 1 }];
    if (text.includes("from snapshots")) return [manifestRow()];
    if (text.includes("from claims")) {
      return [
        {
          claim_id: CLAIM_ID,
          document_id: DOCUMENT_ID,
          reported_by_source_id: SOURCE_ID,
          predicate: "revenue_growth",
          text_canonical: "Revenue grew 9% year over year.",
          polarity: "positive",
          modality: "asserted",
          effective_time: "2026-05-29T00:00:00.000Z",
          confidence: "0.87",
          status: "corroborated",
          provider: "sec",
          canonical_url: "https://www.sec.gov/Archives/example",
          document_title: "FY 2026 10-K",
          content_hash: "claim-hash-must-not-leak",
        },
      ];
    }
    return [];
  });

  const result = await loadEvidenceInspection(db, {
    user_id: USER_ID,
    snapshot_id: SNAPSHOT_ID,
    ref: { kind: "claim", id: CLAIM_ID },
  });

  assert.equal(calls.some((call) => call.text.includes("from chat_messages")), true);
  assert.equal(result.kind, "claim");
  assert.equal(result.title, "revenue_growth");
  assert.ok(result.rows.length >= 2);
  assert.deepEqual(result.related_refs, [
    { kind: "document", id: DOCUMENT_ID, label: "FY 2026 10-K" },
    { kind: "source", id: SOURCE_ID, label: "sec" },
  ]);
  assertNoRawFields(result);
});

test("loadEvidenceInspection returns artifact-safe event details and related source/claim refs", async () => {
  const { db, calls } = stubDb((text) => {
    if (text.includes("from chat_messages")) return [{ visible: 1 }];
    if (text.includes("from snapshots")) return [manifestRow()];
    if (text.includes("from events")) {
      return [
        {
          event_id: EVENT_ID,
          event_type: "earnings_release",
          occurred_at: "2026-05-29T00:00:00.000Z",
          status: "confirmed",
          source_claim_ids: [CLAIM_ID],
          source_ids: [SOURCE_ID],
          payload_json: { raw_blob_id: "event-payload-raw-blob-must-not-leak" },
        },
      ];
    }
    return [];
  });

  const result = await loadEvidenceInspection(db, {
    user_id: USER_ID,
    snapshot_id: SNAPSHOT_ID,
    ref: { kind: "event", id: EVENT_ID },
  });

  assert.equal(calls.some((call) => call.text.includes("from chat_messages")), true);
  assert.equal(result.kind, "event");
  assert.equal(result.title, "earnings_release");
  assert.ok(result.rows.length >= 2);
  assert.deepEqual(result.related_refs, [
    { kind: "claim", id: CLAIM_ID },
    { kind: "source", id: SOURCE_ID },
  ]);
  assertNoRawFields(result);
});

test("loadEvidenceInspection returns artifact-safe fact details and related source ref", async () => {
  const { db, calls } = stubDb((text) => {
    if (text.includes("from chat_messages")) return [{ visible: 1 }];
    if (text.includes("from snapshots")) return [manifestRow()];
    if (text.includes("from facts")) {
      return [
        {
          fact_id: FACT_ID,
          source_id: SOURCE_ID,
          value: "42",
          value_text: null,
          unit: "%",
          period_kind: "fiscal_q",
          fiscal_year: 2026,
          fiscal_period: "Q2",
          as_of: "2026-05-29T00:00:00.000Z",
          verification_status: "verified",
          freshness_class: "filing_time",
          coverage_level: "full",
          method: "reported",
          confidence: "0.91",
          provider: "sec",
          canonical_url: "https://www.sec.gov/Archives/example",
          ingestion_batch_id: "fact-batch-must-not-leak",
        },
      ];
    }
    return [];
  });

  const result = await loadEvidenceInspection(db, {
    user_id: USER_ID,
    snapshot_id: SNAPSHOT_ID,
    ref: { kind: "fact", id: FACT_ID },
  });

  assert.equal(calls.some((call) => call.text.includes("from chat_messages")), true);
  assert.equal(result.kind, "fact");
  assert.equal(result.title, "42%");
  assert.ok(result.rows.length >= 2);
  assert.deepEqual(result.related_refs, [{ kind: "source", id: SOURCE_ID, label: "sec" }]);
  assertNoRawFields(result);
});

function factRow(overrides: Record<string, unknown>) {
  return {
    fact_id: FACT_ID,
    source_id: SOURCE_ID,
    value_text: null,
    currency: null,
    metric_name: null,
    metric_unit_class: null,
    period_start: null,
    period_end: null,
    as_of: "2026-09-01T00:00:00.000Z",
    verification_status: "authoritative",
    freshness_class: "filing_time",
    coverage_level: "full",
    method: "reported",
    confidence: "1",
    provider: "sec_edgar",
    canonical_url: null,
    ...overrides,
  };
}

async function inspectFactRow(row: Record<string, unknown>) {
  const { db } = stubDb((text) => {
    if (text.includes("from chat_messages")) return [{ visible: 1 }];
    if (text.includes("from snapshots")) return [manifestRow()];
    if (text.includes("from facts")) return [row];
    return [];
  });
  return loadEvidenceInspection(db, { user_id: USER_ID, snapshot_id: SNAPSHOT_ID, ref: { kind: "fact", id: FACT_ID } });
}

test("a currency fact reads as the answer shows it, under its metric and fiscal year", async () => {
  const result = await inspectFactRow(factRow({
    value: "209911000000",
    unit: "currency",
    currency: "USD",
    metric_name: "Revenue",
    period_kind: "fiscal_y",
    fiscal_year: 2026,
    fiscal_period: "FY",
  }));

  assert.equal(result.title, "$209.9B");
  assert.equal(result.subtitle, "Revenue · FY 2026");
  assert.deepEqual(result.rows.find((row) => row.label === "Value"), { label: "Value", value: "209911000000" });
});

test("a fact's title follows its unit, and its period reads in words", async () => {
  const cases: Array<[Record<string, unknown>, string, string]> = [
    [{ value: "13.9", unit: "percent", metric_name: "ROIC", period_kind: "fiscal_q", fiscal_year: 2026, fiscal_period: "Q2" }, "13.9%", "ROIC · Q2 FY 2026"],
    [{ value: "4.1234", unit: "currency_per_share", currency: "USD", metric_name: "EPS", period_kind: "ttm", fiscal_year: null, fiscal_period: null, period_end: "2026-06-30" }, "$4.12", "EPS · TTM to 2026-06-30"],
    [{ value: "24400000000", unit: "shares", metric_name: "Shares outstanding", period_kind: "point", fiscal_year: null, fiscal_period: null, period_end: "2026-06-30" }, "24.4B shares", "Shares outstanding · 2026-06-30"],
    [{ value: "0.462", unit: "ratio", metric_unit_class: "percent", metric_name: "Gross Margin", period_kind: "fiscal_q", fiscal_year: 2026, fiscal_period: "Q2" }, "46.2%", "Gross Margin · Q2 FY 2026"],
    [{ value: "45.2", unit: "ratio", metric_unit_class: "ratio", metric_name: null, period_kind: "point", fiscal_year: null, fiscal_period: null, period_end: null }, "45.2 ratio", "2026-09-01"],
    [{ value: "Nasdaq", value_text: "Nasdaq", unit: "string", metric_name: "Exchange", period_kind: "point", fiscal_year: null, fiscal_period: null, period_end: null }, "Nasdaq", "Exchange · 2026-09-01"],
    [{ value: "2000000", unit: "currency", currency: "USD", metric_name: null, period_kind: "point", fiscal_year: null, fiscal_period: null }, "$2.0M", "2026-09-01"],
    [{ value: "209911000000", unit: "currency", currency: "US", metric_name: "Revenue", period_kind: "fiscal_y", fiscal_year: 2026, fiscal_period: "FY" }, "209.9B", "Revenue · FY 2026"],
    [{ value: "209911000000", unit: "USD", currency: "EUR", metric_name: "Revenue", period_kind: "fiscal_y", fiscal_year: 2026, fiscal_period: "FY" }, "$209.9B", "Revenue · FY 2026"],
    [{ value: "13.9", unit: "%", metric_name: "Gross margin", period_kind: "range", fiscal_year: null, fiscal_period: null, period_start: "2026-01-01", period_end: "2026-06-30" }, "13.9%", "Gross margin · 2026-01-01 to 2026-06-30"],
  ];
  for (const [overrides, title, subtitle] of cases) {
    const result = await inspectFactRow(factRow(overrides));
    assert.deepEqual([result.title, result.subtitle], [title, subtitle], String(overrides.unit));
  }
});

test("a derived fact lists the facts it was computed from, as their own inspections word them, before its source", async () => {
  const Q3_REVENUE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const Q2_REVENUE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const revenue = (fact_id: string, fiscal_period: string, value: string) =>
    factRow({ fact_id, value, unit: "currency", currency: "USD", metric_name: "Revenue", period_kind: "fiscal_q", fiscal_year: 2026, fiscal_period });
  const facts = [
    factRow({
      value: "0.2195622874013221", unit: "ratio", metric_unit_class: "percent", metric_name: "Revenue Growth (QoQ)",
      period_kind: "fiscal_q", fiscal_year: 2026, fiscal_period: "Q3", method: "derived",
      quality_flags: [{ kind: "derivation", metric: "revenue_growth_qoq", input_fact_ids: [Q3_REVENUE, Q2_REVENUE] }],
    }),
    revenue(Q3_REVENUE, "Q3", "57006000000"),
    revenue(Q2_REVENUE, "Q2", "46743000000"),
  ];
  const inspect = async (fact_refs: string[]) => {
    const { db, calls } = stubDb((text, values) => {
      if (text.includes("from chat_messages")) return [{ visible: 1 }];
      if (text.includes("from snapshots")) return [manifestRow({ fact_refs })];
      if (text.includes("from facts")) return facts.filter((fact) => (values?.[0] as string[]).includes(fact.fact_id));
      return [];
    });
    const result = await loadEvidenceInspection(db, { user_id: USER_ID, snapshot_id: SNAPSHOT_ID, ref: { kind: "fact", id: FACT_ID } });
    return { result, factQueries: calls.filter((call) => call.text.includes("from facts")).map((call) => call.values) };
  };

  const { result, factQueries } = await inspect([FACT_ID, Q3_REVENUE, Q2_REVENUE]);
  assert.deepEqual([result.title, result.subtitle], ["22.0%", "Revenue Growth (QoQ) · Q3 FY 2026"]);
  assert.deepEqual(result.related_refs, [
    { kind: "fact", id: Q3_REVENUE, label: "Revenue · Q3 FY 2026 · $57.0B" },
    { kind: "fact", id: Q2_REVENUE, label: "Revenue · Q2 FY 2026 · $46.7B" },
    { kind: "source", id: SOURCE_ID, label: "sec_edgar" },
  ]);
  assert.deepEqual(factQueries, [[[FACT_ID], USER_ID], [[Q3_REVENUE, Q2_REVENUE], USER_ID]]);
  assert.deepEqual((await inspect([FACT_ID, Q3_REVENUE])).result.related_refs.map((ref) => ref.id), [Q3_REVENUE, SOURCE_ID]);
});

test("loadEvidenceInspection filters related refs to the sealed snapshot manifest", async () => {
  const { db } = stubDb((text) => {
    if (text.includes("from chat_messages")) return [{ visible: 1 }];
    if (text.includes("from snapshots")) return [manifestRow({ source_ids: [SOURCE_ID], document_refs: [DOCUMENT_ID], claim_refs: [CLAIM_ID] })];
    if (text.includes("from claims")) {
      return [
        {
          claim_id: CLAIM_ID,
          document_id: OUT_OF_SNAPSHOT_DOCUMENT_ID,
          reported_by_source_id: OUT_OF_SNAPSHOT_SOURCE_ID,
          predicate: "margin_pressure",
          text_canonical: "Margins may compress.",
          polarity: "negative",
          modality: "asserted",
          effective_time: null,
          confidence: "0.77",
          status: "extracted",
          provider: "news",
          canonical_url: "https://example.com/story",
        },
      ];
    }
    return [];
  });

  const result = await loadEvidenceInspection(db, {
    user_id: USER_ID,
    snapshot_id: SNAPSHOT_ID,
    ref: { kind: "claim", id: CLAIM_ID },
  });

  assert.deepEqual(result.related_refs, []);
  assert.equal(JSON.stringify(result.related_refs).includes(OUT_OF_SNAPSHOT_SOURCE_ID), false);
  assert.equal(JSON.stringify(result.related_refs).includes(OUT_OF_SNAPSHOT_DOCUMENT_ID), false);
});

test("loadEvidenceInspection leaves an untitled document's related ref unlabeled", async () => {
  const { db } = stubDb((text) => {
    if (text.includes("from chat_messages")) return [{ visible: 1 }];
    if (text.includes("from snapshots")) return [manifestRow()];
    if (text.includes("from claims")) {
      return [
        {
          claim_id: CLAIM_ID,
          document_id: DOCUMENT_ID,
          reported_by_source_id: SOURCE_ID,
          predicate: "revenue_growth",
          text_canonical: "Revenue grew 9% year over year.",
          polarity: "positive",
          modality: "asserted",
          effective_time: null,
          confidence: "0.87",
          status: "extracted",
          provider: "polygon",
          canonical_url: null,
          document_title: null,
        },
      ];
    }
    return [];
  });

  const result = await loadEvidenceInspection(db, {
    user_id: USER_ID,
    snapshot_id: SNAPSHOT_ID,
    ref: { kind: "claim", id: CLAIM_ID },
  });

  assert.deepEqual(result.related_refs, [
    { kind: "document", id: DOCUMENT_ID },
    { kind: "source", id: SOURCE_ID, label: "polygon" },
  ]);
});

function seriesDb(manifest = manifestRow({ series_specs: [SERIES_SPEC] })) {
  return stubDb((text, values) => {
    if (text.includes("from chat_messages")) return [{ visible: 1 }];
    if (text.includes("from snapshots")) return [manifest];
    if (text.includes("from listings") && values?.[0] === LISTING_ID && values?.[1] === SOURCE_ID) {
      return [{ ticker: "NVDA", legal_name: "NVIDIA Corporation", canonical_url: "https://www.example.com/bars", provider: "polygon" }];
    }
    return [];
  });
}

test("loadEvidenceInspection renders a sealed YTD series spec with its listing and source", async () => {
  const { db, calls } = seriesDb();

  const result = await loadEvidenceInspection(db, {
    user_id: USER_ID,
    snapshot_id: SNAPSHOT_ID,
    ref: { kind: "series", id: SERIES_REF },
  });

  assert.deepEqual(result, {
    snapshot_id: SNAPSHOT_ID,
    ref: { kind: "series", id: SERIES_REF },
    kind: "series",
    title: "NVDA price series",
    subtitle: "NVIDIA Corporation",
    badges: ["sealed", "points_checked"],
    rows: [
      { label: "Basis", value: "Split-adjusted, excluding dividends" },
      { label: "Return", value: "Price return" },
      { label: "Window", value: "YTD 2026: 2025-12-31 close to 2026-10-15 close" },
      { label: "Interval", value: "Daily" },
      { label: "Delay", value: "End of day" },
      { label: "As of", value: "2026-10-15T20:00:00.000Z" },
      { label: "Bars digest", value: "sha256:3f9a1c0e7b2d" },
    ],
    links: [{ label: "Open source", href: "https://www.example.com/bars" }],
    related_refs: [{ kind: "source", id: SOURCE_ID, label: "polygon" }],
  });
  assert.deepEqual(calls.find((call) => call.text.includes("from listings"))?.values, [LISTING_ID, SOURCE_ID, USER_ID]);
});

test("loadEvidenceInspection words a series without a window by its stored range, from a JSON-text manifest", async () => {
  const { window: _window, points: _points, ...latest } = SERIES_SPEC;
  const { db } = seriesDb(manifestRow({ series_specs: JSON.stringify([latest]) }));

  const result = await loadEvidenceInspection(db, {
    user_id: USER_ID,
    snapshot_id: SNAPSHOT_ID,
    ref: { kind: "series", id: SERIES_REF },
  });

  assert.deepEqual(result.badges, ["sealed"]);
  assert.deepEqual(result.rows.find((row) => row.label === "Window"), { label: "Window", value: "2025-10-01 to 2026-10-15" });
});

test("loadEvidenceInspection rejects a series ref the snapshot did not seal, like a missing fact", async () => {
  for (const ref of [
    { kind: "series", id: OUT_OF_SNAPSHOT_SOURCE_ID },
    { kind: "fact", id: OUT_OF_SNAPSHOT_SOURCE_ID },
  ] as const) {
    const { db, calls } = seriesDb();
    await assert.rejects(
      () => loadEvidenceInspection(db, { user_id: USER_ID, snapshot_id: SNAPSHOT_ID, ref }),
      (err: Error) =>
        err instanceof EvidenceInspectionError &&
        err.status === 404 &&
        err.message === "ref is not present in snapshot manifest",
    );
    assert.equal(calls.some((call) => call.text.includes("from listings")), false);
  }
});

test("loadEvidenceInspection hides a series whose source is not visible to the user", async () => {
  const { db } = stubDb((text) => {
    if (text.includes("from chat_messages")) return [{ visible: 1 }];
    if (text.includes("from snapshots")) return [manifestRow({ series_specs: [SERIES_SPEC] })];
    return [];
  });
  await assert.rejects(
    () => loadEvidenceInspection(db, { user_id: USER_ID, snapshot_id: SNAPSHOT_ID, ref: { kind: "series", id: SERIES_REF } }),
    (err: Error) => err instanceof EvidenceInspectionError && err.status === 404 && err.message === "series not found",
  );
});

test("loadEvidenceInspection rejects an unknown ref kind with a 400 before querying", async () => {
  const { db, calls } = seriesDb();
  await assert.rejects(
    () =>
      loadEvidenceInspection(db, {
        user_id: USER_ID,
        snapshot_id: SNAPSHOT_ID,
        ref: { kind: "listing", id: LISTING_ID } as unknown as EvidenceInspectionRef,
      }),
    (err: Error) => err instanceof EvidenceInspectionError && err.status === 400 && err.message === "ref.kind is invalid",
  );
  assert.equal(calls.length, 0);
});

function manifestRow(input: {
  source_ids?: readonly string[];
  document_refs?: readonly string[];
  claim_refs?: readonly string[];
  event_refs?: readonly string[];
  fact_refs?: readonly string[];
  series_specs?: unknown;
} = {}) {
  return {
    snapshot_id: SNAPSHOT_ID,
    source_ids: input.source_ids ?? [SOURCE_ID],
    document_refs: input.document_refs ?? [DOCUMENT_ID],
    claim_refs: input.claim_refs ?? [CLAIM_ID],
    event_refs: input.event_refs ?? [EVENT_ID],
    fact_refs: input.fact_refs ?? [FACT_ID],
    series_specs: input.series_specs ?? [],
  };
}

function sourceRow(input: { source_id: string; canonical_url?: string | null }) {
  return {
    source_id: input.source_id,
    provider: "sec",
    kind: "filing",
    canonical_url: input.canonical_url ?? "https://www.sec.gov/Archives/example",
    trust_tier: "primary",
    license_class: "public",
    retrieved_at: "2026-05-29T00:00:00.000Z",
    content_hash: "abc123",
    raw_blob_id: "sha256:must-not-leak",
    user_id: null,
  };
}

function assertNoRawFields(value: unknown): void {
  const json = JSON.stringify(value);
  assert.equal(json.includes("content_hash"), false);
  assert.equal(json.includes("raw_blob_id"), false);
  assert.equal(json.includes("raw_blob"), false);
  assert.equal(json.includes("must-not-leak"), false);
}

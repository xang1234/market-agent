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

function stubDb(rowsByQuery: (text: string, values?: unknown[]) => unknown[]) {
  const calls: QueryCall[] = [];
  return {
    calls,
    db: {
      async query<T extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]) {
        calls.push({ text, values });
        return { rows: rowsByQuery(text, values) as T[] };
      },
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
  assert.deepEqual(result.related_refs, [{ kind: "source", id: SOURCE_ID }]);
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
    { kind: "document", id: DOCUMENT_ID },
    { kind: "source", id: SOURCE_ID },
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
  assert.equal(result.title, "42 %");
  assert.ok(result.rows.length >= 2);
  assert.deepEqual(result.related_refs, [{ kind: "source", id: SOURCE_ID }]);
  assertNoRawFields(result);
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

function manifestRow(input: {
  source_ids?: readonly string[];
  document_refs?: readonly string[];
  claim_refs?: readonly string[];
  event_refs?: readonly string[];
  fact_refs?: readonly string[];
} = {}) {
  return {
    snapshot_id: SNAPSHOT_ID,
    source_ids: input.source_ids ?? [SOURCE_ID],
    document_refs: input.document_refs ?? [DOCUMENT_ID],
    claim_refs: input.claim_refs ?? [CLAIM_ID],
    event_refs: input.event_refs ?? [EVENT_ID],
    fact_refs: input.fact_refs ?? [FACT_ID],
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

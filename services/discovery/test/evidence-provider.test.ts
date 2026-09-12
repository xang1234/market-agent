import assert from "node:assert/strict";
import test from "node:test";

import { createEvidenceProvider, createPrimaryDocumentCandidateFinder } from "../src/providers/evidence.ts";
import { fakeOperations } from "./fake-operations.ts";

const USER = "11111111-1111-4111-a111-111111111111";
const ISSUER = "22222222-2222-4222-a222-222222222222";
const LISTING = "33333333-3333-4333-a333-333333333333";
const CANDIDATE = "44444444-4444-4444-a444-444444444444";

test("evidence provider produces deterministic bounded excerpts and marks stale primary evidence", async () => {
  const provider = createEvidenceProvider({
    documents: {
      load: async () => ({
        documents: [{
          document_id: "55555555-5555-4555-a555-555555555555", source_id: "66666666-6666-4666-a666-666666666666",
          family_key: "sec:10-k", title: "Annual report", url: "https://www.sec.gov/Archives/acme", published_at: "2023-01-01T00:00:00.000Z",
          retrieved_at: "2026-09-01T00:00:00.000Z", document_hash: "sha256:doc", normalized_text: "Before. Grid transformer demand grew as utilities upgraded substations. After.",
          primary: true, primary_eligible: true, claims: [{ claim_id: "77777777-7777-4777-a777-777777777777", source_id: "88888888-8888-4888-a888-888888888888", text_canonical: "Grid transformer demand grew." }],
        }], coverage_gaps: [],
      }),
      fetchAndStore: async () => { throw new Error("unexpected"); },
    },
  });

  const result = await provider.acquire({
    brief: brief(), candidate: candidate(), as_of: "2026-09-10T00:00:00.000Z",
    operation_key: "run/research/candidate/evidence", request_hash: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    phase: "research", candidate_id: CANDIDATE,
  }, fakeOperations().operations);

  assert.equal(result.excerpts.length, 1);
  assert.equal(result.excerpts[0]?.normalized_start, 0);
  assert.match(result.excerpts[0]?.text ?? "", /Grid transformer demand/);
  assert.equal(result.claims[0]?.source_id, "88888888-8888-4888-a888-888888888888");
  assert.ok(result.coverage_gaps.includes("primary_evidence_stale"));
  assert.doesNotMatch(JSON.stringify(result), /raw_blob_id|bytes/i);
});

test("evidence provider records an unknown primary publication date instead of treating it as current", async () => {
  const provider = createEvidenceProvider({
    documents: {
      load: async () => ({
        documents: [{
          document_id: "55555555-5555-4555-a555-555555555555", source_id: "66666666-6666-4666-a666-666666666666",
          family_key: "issuer:release", title: "Release", url: "https://investors.acme.example/release", published_at: null,
          retrieved_at: "2026-09-01T00:00:00.000Z", document_hash: "sha256:doc", normalized_text: "Grid transformer demand grew.",
          primary: true, primary_eligible: true, claims: [],
        }], coverage_gaps: [],
      }),
      fetchAndStore: async () => { throw new Error("unexpected"); },
    },
  });

  const result = await provider.acquire({
    brief: brief(), candidate: candidate(), as_of: "2026-09-10T00:00:00.000Z",
    operation_key: "run/research/candidate/evidence", request_hash: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    phase: "research", candidate_id: CANDIDATE,
  }, fakeOperations());

  assert.ok(result.coverage_gaps.includes("primary_evidence_publication_unknown"));
  assert.equal(result.excerpts[0]?.primary_eligible, false);
});

test("primary candidate finder combines only metered SEC and verified-IR document candidates", async () => {
  const finder = createPrimaryDocumentCandidateFinder({
    sec: { find: async () => [{ url: "https://www.sec.gov/Archives/acme.html", title: "10-K", published_at: "2026-02-01T00:00:00.000Z", provider: "sec_edgar", kind: "filing" }] },
    issuer_ir: { find: async () => [{ url: "https://investors.acme.example/release", title: "Release", published_at: "2026-03-01T00:00:00.000Z", provider: "issuer_ir", kind: "press_release" }] },
  });

  const candidates = await finder.find({
    candidate: candidate(), as_of: "2026-09-10T00:00:00.000Z", operation_key: "run/research/candidate/evidence",
    request_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    phase: "research",
  }, fakeOperations());

  assert.deepEqual(candidates.map((item) => item.provider), ["sec_edgar", "issuer_ir"]);
});

test("primary candidate discovery passes remaining capacity and skips issuer IR once SEC fills it", async () => {
  let secCapacity: number | undefined;
  let issuerIrCalled = false;
  const finder = createPrimaryDocumentCandidateFinder({
    sec: { find: async (input) => {
      secCapacity = input.remaining_capacity;
      return Array.from({ length: 4 }, (_, index) => ({
        url: `https://www.sec.gov/Archives/acme-${index}.html`, title: "Filing", published_at: "2026-02-01T00:00:00.000Z", provider: "sec_edgar" as const, kind: "filing" as const,
      }));
    } },
    issuer_ir: { find: async () => {
      issuerIrCalled = true;
      return [];
    } },
  });

  const candidates = await finder.find({
    candidate: candidate(), as_of: "2026-09-10T00:00:00.000Z", operation_key: "run/research/candidate/evidence",
    request_hash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", phase: "research",
    remaining_capacity: 4,
  }, fakeOperations());

  assert.equal(secCapacity, 4);
  assert.equal(candidates.length, 4);
  assert.equal(issuerIrCalled, false);
});

test("evidence acquisition gives candidate discovery only its uncached document capacity", async () => {
  let remainingCapacity: number | undefined;
  const provider = createEvidenceProvider({
    documents: {
      load: async () => ({ documents: Array.from({ length: 4 }, (_, index) => document(index)), coverage_gaps: [] }),
      fetchAndStore: async () => { throw new Error("unexpected"); },
    },
    candidates: { find: async (input) => {
      remainingCapacity = input.remaining_capacity;
      return [];
    } },
  });

  await provider.acquire({
    brief: brief(), candidate: candidate(), as_of: "2026-09-10T00:00:00.000Z",
    operation_key: "run/research/candidate/evidence", request_hash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    phase: "research", candidate_id: CANDIDATE,
  }, fakeOperations());

  assert.equal(remainingCapacity, 2);
});

function document(index: number) {
  return {
    document_id: `55555555-5555-4555-a555-55555555555${index}`, source_id: `66666666-6666-4666-a666-66666666666${index}`,
    family_key: `sec:${index}`, title: "Annual report", url: `https://www.sec.gov/Archives/acme-${index}`, published_at: "2026-02-01T00:00:00.000Z",
    retrieved_at: "2026-09-01T00:00:00.000Z", document_hash: `sha256:doc${index}`, normalized_text: "Grid transformer demand grew.",
    primary: true, primary_eligible: true, claims: [],
  };
}

function candidate() {
  return {
    candidate_id: CANDIDATE, lead_key: "acme", name: "Acme", identity: {
      issuer_id: ISSUER, listing_id: LISTING, legal_name: "Acme", ticker: "ACME", mic: "XNYS", currency: "USD", asset_type: "common_stock" as const, identity_source_ids: [],
    }, origins: ["web" as const], mechanism_ids: ["99999999-9999-4999-a999-999999999999"], seed: false, primary_domain_lead: false,
    first_seen: [0, 0] as [number, number], lead_hit_ids: [], reason_codes: [],
  };
}

function brief() {
  return {
    schema_version: 1 as const, question: "Which listed companies benefit from grid transformer demand?", market: "us_listed" as const,
    horizon_months: 12, lookback_months: 12, mechanisms: [{ mechanism_id: "99999999-9999-4999-a999-999999999999", label: "Grid", chain: ["Grid", "Demand"] }],
    criteria: [{ criterion_id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", importance: "must" as const, statement: "Has grid exposure", falsifier: "No grid exposure" }],
    seed_queries: [], exclusions: [], preferences: [], queries: [{ mechanism_id: "99999999-9999-4999-a999-999999999999", query: "grid transformer demand" }],
  };
}

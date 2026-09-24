import type { AnalystOutput, Brief, CompanyIdentity, SkepticOutput } from "../src/types.ts";
import type { EvidencePacket } from "../src/ports.ts";

const FIRST_MECHANISM_ID = "40000000-0000-4000-8000-000000000001";
const SECOND_MECHANISM_ID = "40000000-0000-4000-8000-000000000002";
const FIRST_CRITERION_ID = "50000000-0000-4000-8000-000000000001";

export function briefFixture(): Brief {
  return {
    schema_version: 1,
    question: "Which US-listed companies benefit from grid modernization spending?",
    market: "us_listed",
    horizon_months: 18,
    lookback_months: 12,
    mechanisms: [
      {
        mechanism_id: FIRST_MECHANISM_ID,
        label: "Grid equipment demand",
        chain: ["Electricity demand rises", "Grid equipment orders grow"],
      },
      {
        mechanism_id: SECOND_MECHANISM_ID,
        label: "Grid software demand",
        chain: ["Utilities upgrade networks", "Software spending rises"],
      },
    ],
    criteria: [{
      criterion_id: FIRST_CRITERION_ID,
      importance: "must",
      statement: "The company sells products used in grid modernization.",
      falsifier: "The company has no material grid modernization exposure.",
    }],
    seed_queries: ["US grid equipment suppliers"],
    exclusions: [],
    preferences: [],
    queries: [
      { mechanism_id: FIRST_MECHANISM_ID, query: "US listed grid equipment suppliers" },
      { mechanism_id: SECOND_MECHANISM_ID, query: "US listed utility grid software vendors" },
    ],
  } as Brief;
}

export function identityFixture(index = 0): CompanyIdentity {
  const suffix = (index + 1).toString(16).padStart(12, "0");
  return {
    issuer_id: `80000000-0000-4000-8000-${suffix}`,
    listing_id: `81000000-0000-4000-8000-${suffix}`,
    legal_name: `Candidate ${index + 1} Inc.`, ticker: `C${index + 1}`, mic: "XNAS", currency: "USD",
    asset_type: "common_stock", identity_source_ids: [],
  };
}

export function packetFixture(): EvidencePacket {
  const identity = identityFixture();
  return {
    candidate_id: "90000000-0000-4000-8000-000000000001", identity,
    excerpts: [
      { excerpt_id: "a0000000-0000-4000-8000-000000000001", document_id: "a1000000-0000-4000-8000-000000000001", source_id: "a2000000-0000-4000-8000-000000000001", family_key: "candidate-primary", title: "Primary disclosure", url: "https://example.test/primary", published_at: null, retrieved_at: "2026-09-10T12:00:00.000Z", document_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", normalized_start: 0, text: "The company sells grid modernization equipment.", primary: true, primary_eligible: true },
      { excerpt_id: "a0000000-0000-4000-8000-000000000002", document_id: "a1000000-0000-4000-8000-000000000002", source_id: "a2000000-0000-4000-8000-000000000002", family_key: "candidate-risk", title: "Risk disclosure", url: "https://example.test/risk", published_at: null, retrieved_at: "2026-09-10T12:00:00.000Z", document_hash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", normalized_start: 0, text: "Project timing can delay grid modernization equipment revenue.", primary: true, primary_eligible: true },
    ],
    claims: [
      { claim_id: "b0000000-0000-4000-8000-000000000001", document_id: "a1000000-0000-4000-8000-000000000001", source_id: "a2000000-0000-4000-8000-000000000001", text_canonical: "The company sells grid modernization equipment." },
      { claim_id: "b0000000-0000-4000-8000-000000000002", document_id: "a1000000-0000-4000-8000-000000000002", source_id: "a2000000-0000-4000-8000-000000000002", text_canonical: "Project timing can delay grid modernization equipment revenue." },
    ],
    facts: [], counter_search_completed: true, coverage_gaps: [],
  };
}

export function analystFixture(): AnalystOutput {
  return {
    exposure: { level: "strong", explanation: "Primary evidence supports exposure.", citations: [{ kind: "claim", id: "b0000000-0000-4000-8000-000000000001" }] },
    business_quality: { level: "unknown", explanation: "Business quality evidence is missing.", citations: [] },
    valuation_context: { level: "unknown", explanation: "Valuation evidence is missing.", citations: [] },
    criteria: [{ criterion_id: FIRST_CRITERION_ID, outcome: "pass", explanation: "Evidence supports the criterion.", citations: [{ kind: "claim", id: "b0000000-0000-4000-8000-000000000001" }] }],
    unresolved_questions: [], next_action: "Review additional primary disclosures.",
  };
}

export function skepticFixture(): SkepticOutput {
  return {
    ...analystFixture(),
    counterarguments: [{ text: "Project timing can delay revenue.", citations: [{ kind: "claim", id: "b0000000-0000-4000-8000-000000000002" }] }],
  };
}

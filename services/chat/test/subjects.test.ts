import assert from "node:assert/strict";
import test from "node:test";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";
import {
  createChatSubjectPreResolver,
  preResolveChatSubject,
} from "../src/subjects.ts";
import type { SearchToSubjectFlowResult } from "../../resolver/src/flow.ts";
import type { QueryExecutor } from "../../resolver/src/lookup.ts";

const googListing = {
  kind: "listing" as const,
  id: "11111111-1111-4111-a111-111111111111",
};

const googlListing = {
  kind: "listing" as const,
  id: "22222222-2222-4222-a222-222222222222",
};

const aaplListing = {
  kind: "listing" as const,
  id: "33333333-3333-4333-a333-333333333333",
};

test("chat subject pre-resolve maps hydrated resolver envelopes to explicit subject context", async () => {
  const requests: string[] = [];
  const result = await preResolveChatSubject({
    text: "AAPL",
    resolveSubject: async ({ text }) => {
      requests.push(text);
      return hydratedAaplFlow();
    },
  });

  assert.deepEqual(requests, ["AAPL"]);
  assert.equal(result.status, "resolved");
  assert.deepEqual(result.subject_ref, aaplListing);
  assert.equal(result.display_label, "AAPL · XNAS — Apple Inc.");
  assert.equal(result.resolution_path, "auto_advanced");
});

test("chat subject pre-resolve converts ambiguous GOOG into a share-class clarification without selecting a subject", async () => {
  const result = await preResolveChatSubject({
    text: "GOOG",
    resolveSubject: async () => ({
      status: "needs_choice",
      stage: "canonical_selection",
      normalized_input: "GOOG",
      candidate_search: {
        outcome: "ambiguous",
        ambiguity_axis: "multiple_listings",
        candidates: googleShareClassCandidates(),
      },
      ambiguity_axis: "multiple_listings",
      candidates: googleShareClassCandidates(),
    }),
  });

  assert.equal(result.status, "needs_clarification");
  assert.equal("subject_ref" in result, false);
  assert.match(result.message, /Which share class/i);
  assert.match(result.message, /GOOG/);
  assert.match(result.message, /GOOGL/);
  assert.deepEqual(result.candidates, googleShareClassCandidates());
});

test("chat subject pre-resolve prefers resolver ambiguity axis for clarification wording", async () => {
  const result = await preResolveChatSubject({
    text: "BRK",
    resolveSubject: async () => ({
      status: "needs_choice",
      stage: "canonical_selection",
      normalized_input: "BRK",
      candidate_search: {
        outcome: "ambiguous",
        ambiguity_axis: "multiple_listings",
        candidates: berkshireListingCandidates(),
      },
      ambiguity_axis: "multiple_listings",
      candidates: berkshireListingCandidates(),
    }),
  });

  assert.equal(result.status, "needs_clarification");
  assert.match(result.message, /Which share class/i);
  assert.match(result.message, /BRK\.A/);
  assert.match(result.message, /BRK\.B/);
});

test("chat subject pre-resolve returns not-found clarification without hydration", async () => {
  const result = await preResolveChatSubject({
    text: "NOTREAL",
    resolveSubject: async () => ({
      status: "not_found",
      stage: "candidate_search",
      normalized_input: "NOTREAL",
      candidate_search: {
        outcome: "not_found",
        normalized_input: "NOTREAL",
        reason: "no_candidates",
      },
      reason: "no_candidates",
    }),
  });

  assert.equal(result.status, "not_found");
  assert.equal("subject_ref" in result, false);
  assert.match(result.message, /could not resolve/i);
  assert.match(result.message, /NOTREAL/);
});

test("chat subject pre-resolve can call the P0.3 search-to-subject flow directly", async () => {
  const queries: string[] = [];
  const db: QueryExecutor = {
    async query(text) {
      queries.push(text);
      return { rows: [], command: "SELECT", rowCount: 0, oid: 0, fields: [] };
    },
  };

  const result = await createChatSubjectPreResolver(() => db, { discoverTicker: async () => [] })({ text: "NOTREAL" });

  assert.equal(result.status, "not_found");
  assert.equal(result.normalized_input, "NOTREAL");
  assert.ok(queries.length > 0);
});

test("a first question about a ticker the import left without a CIK discovers it, once a minute", { timeout: 120_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for chat discovery coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "chat-cikless-discovery");
  const client = await connectedClient(t, databaseUrl);
  const { rows: [issuer] } = await client.query<{ issuer_id: string }>("insert into issuers (legal_name) values ('Micron Technology Inc') returning issuer_id");
  const { rows: [instrument] } = await client.query<{ instrument_id: string }>(
    "insert into instruments (issuer_id, asset_type) values ($1, 'common_stock') returning instrument_id",
    [issuer!.issuer_id],
  );
  const { rows: [listing] } = await client.query<{ listing_id: string }>(
    `insert into listings (instrument_id, mic, ticker, trading_currency, timezone)
     values ($1, 'XNAS', 'MU', 'USD', 'America/New_York') returning listing_id`,
    [instrument!.instrument_id],
  );
  const asked: string[] = [];
  const preResolve = createChatSubjectPreResolver(() => client, {
    discoverTicker: async (ticker) => {
      asked.push(ticker);
      return [{
        ticker: "MU",
        legal_name: "Micron Technology Inc",
        market: "stocks",
        active: true,
        mic: "XNAS",
        trading_currency: "USD",
        timezone: "America/New_York",
        asset_type: "common_stock",
        cik: "0000723125",
      }];
    },
  });

  const first = await preResolve({ text: "MU" });
  const filled = await client.query("select legal_name, cik from issuers");
  // As if that discovery had found no CIK: the next question within the minute does not ask again.
  await client.query("update issuers set cik = null");
  const second = await preResolve({ text: "MU" });

  assert.deepEqual(filled.rows, [{ legal_name: "Micron Technology Inc", cik: "723125" }]);
  assert.deepEqual(asked, ["MU"]);
  assert.deepEqual([first.status === "resolved" && first.subject_ref, second.status === "resolved" && second.subject_ref], [
    { kind: "listing", id: listing!.listing_id },
    { kind: "listing", id: listing!.listing_id },
  ]);
});

function googleShareClassCandidates() {
  return [
    { subject_ref: googListing, display_name: "GOOG (Class C)", confidence: 0.55 },
    { subject_ref: googlListing, display_name: "GOOGL (Class A)", confidence: 0.45 },
  ];
}

function berkshireListingCandidates() {
  return [
    { subject_ref: googListing, display_name: "BRK.A", confidence: 0.55 },
    { subject_ref: googlListing, display_name: "BRK.B", confidence: 0.45 },
  ];
}

function hydratedAaplFlow(): SearchToSubjectFlowResult {
  return {
    status: "hydrated",
    stage: "hydrated_handoff",
    normalized_input: "AAPL",
    candidate_search: {
      outcome: "resolved",
      subject_ref: aaplListing,
      display_name: "AAPL · XNAS — Apple Inc.",
      confidence: 0.95,
      canonical_kind: "listing",
    },
    canonical_selection: {
      outcome: "resolved",
      subject_ref: aaplListing,
      display_name: "AAPL · XNAS — Apple Inc.",
      confidence: 0.95,
      canonical_kind: "listing",
    },
    handoff: {
      subject_ref: aaplListing,
      identity_level: "listing",
      display_label: "AAPL · XNAS — Apple Inc.",
      display_labels: {
        primary: "AAPL · XNAS — Apple Inc.",
        ticker: "AAPL",
        mic: "XNAS",
      },
      normalized_input: "AAPL",
      resolution_path: "auto_advanced",
      confidence: 0.95,
      context: {},
    },
  };
}

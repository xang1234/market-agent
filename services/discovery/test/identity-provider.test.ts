import assert from "node:assert/strict";
import test from "node:test";

import { createCanonicalIdentityProvider } from "../src/providers/identity.ts";
import { fakeOperations } from "./fake-operations.ts";

const HASH = "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const ISSUER = "11111111-1111-4111-a111-111111111111";
const LISTING = "22222222-2222-4222-a222-222222222222";

test("canonical identity accepts an ADR with foreign domicile and no cached quote", async () => {
  const provider = createCanonicalIdentityProvider({
    lookup: {
      findCached: async () => [{
        issuer_id: ISSUER, listing_id: LISTING, legal_name: "Example ADR plc", ticker: "EXMP", mic: "XNAS",
        currency: "USD", asset_type: "adr", active: true, domicile: "GB", identity_source_ids: [],
      }],
      discover: async () => [],
    },
  });
  const fake = fakeOperations();

  const result = await provider.resolve({
    query: "EXMP", hit_ids: [], operation_key: "run-1/discovery/identity/EXMP", request_hash: HASH, phase: "discovery",
  }, fake.operations);

  assert.deepEqual(result, {
    status: "resolved",
    identity: {
      issuer_id: ISSUER, listing_id: LISTING, legal_name: "Example ADR plc", ticker: "EXMP", mic: "XNAS",
      currency: "USD", asset_type: "adr", identity_source_ids: [],
    },
  });
  assert.equal(fake.ledger.size, 0, "a cached identity does not reserve an external lookup");
});

test("canonical identity excludes ETF and unsupported OTC listings", async () => {
  const provider = createCanonicalIdentityProvider({
    lookup: {
      findCached: async () => [
        { issuer_id: ISSUER, listing_id: LISTING, legal_name: "Fund", ticker: "FUND", mic: "XNAS", currency: "USD", asset_type: "etf", active: true, identity_source_ids: [] },
        { issuer_id: ISSUER, listing_id: LISTING, legal_name: "OTC issuer", ticker: "OTC", mic: "OTCM", currency: "USD", asset_type: "common_stock", active: true, identity_source_ids: [] },
      ],
      discover: async () => [],
    },
  });

  const result = await provider.resolve({
    query: "FUND", hit_ids: [], operation_key: "run-1/discovery/identity/FUND", request_hash: HASH, phase: "discovery",
  }, fakeOperations().operations);

  assert.deepEqual(result, { status: "unresolved", reason: "no eligible active US listing" });
});

test("canonical identity leaves multiple eligible issuer matches unresolved", async () => {
  const provider = createCanonicalIdentityProvider({
    lookup: {
      findCached: async () => ["AAA", "BBB"].map((ticker, index) => ({
        issuer_id: `11111111-1111-4111-a111-11111111111${index}`, listing_id: `22222222-2222-4222-a222-22222222222${index}`,
        legal_name: "Acme Holdings", ticker, mic: "XNYS", currency: "USD", asset_type: "common_stock", active: true, identity_source_ids: [],
      })),
      discover: async () => [],
    },
  });

  const result = await provider.resolve({
    query: "Acme Holdings", hit_ids: [], operation_key: "run-1/discovery/identity/acme", request_hash: HASH, phase: "discovery",
  }, fakeOperations().operations);

  assert.deepEqual(result, { status: "unresolved", reason: "ambiguous eligible listing" });
});

import test from "node:test";
import assert from "node:assert/strict";
import { createDevProvidersIssuerProfileRepository } from "../src/dev-providers.ts";
import type { IssuerProfileRecord, IssuerProfileRepository } from "../src/issuer-repository.ts";

const ISSUER_ID = "99999999-9999-4999-9999-999999999999";
const LISTING_ID = "88888888-8888-4888-8888-888888888888";

function sparseProfile(overrides: Partial<IssuerProfileRecord> = {}): IssuerProfileRecord {
  return {
    subject: { kind: "issuer", id: ISSUER_ID },
    legal_name: "Advanced Micro Devices, Inc.",
    former_names: [],
    exchanges: [
      {
        listing: { kind: "listing", id: LISTING_ID },
        mic: "XNAS",
        ticker: "AMD",
        trading_currency: "USD",
        timezone: "America/New_York",
      },
    ],
    ...overrides,
  };
}

test("dev providers profile repository fills missing issuer profile fields from Finviz", async () => {
  const updates: unknown[][] = [];
  const insertedEnrichments: unknown[][] = [];
  const primary: IssuerProfileRepository = {
    async find() {
      return sparseProfile();
    },
  };
  const repo = createDevProvidersIssuerProfileRepository({
    primary,
    db: {
      async query(text, values) {
        if (text.includes("issuer_profile_enrichments")) {
          insertedEnrichments.push(values ?? []);
        } else {
          updates.push(values ?? []);
        }
        return { rows: [] };
      },
    },
    baseUrl: "http://dev-providers.test",
    fetchImpl: async (url, init) => {
      assert.equal(String(url), "http://dev-providers.test/reference/profile");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        listing: { kind: "listing", id: LISTING_ID },
        ticker: "AMD",
        mic: "XNAS",
        currency: "USD",
        timezone: "America/New_York",
      });
      return new Response(JSON.stringify({
        status: "available",
        data: {
          sector: "Technology",
          industry: "Semiconductors",
          domicile: "USA",
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const profile = await repo.find(ISSUER_ID);

  assert.equal(profile?.sector, "Technology");
  assert.equal(profile?.industry, "Semiconductors");
  assert.equal(profile?.domicile, "USA");
  assert.deepEqual(updates[0], [ISSUER_ID, "USA", "Technology", "Semiconductors"]);
  assert.deepEqual(insertedEnrichments, [
    [ISSUER_ID, "domicile", "USA", "00000000-0000-4000-a000-00000000000c"],
    [ISSUER_ID, "sector", "Technology", "00000000-0000-4000-a000-00000000000c"],
    [ISSUER_ID, "industry", "Semiconductors", "00000000-0000-4000-a000-00000000000c"],
  ]);
});

test("dev providers profile repository does not update issuers when provenance insert fails", async () => {
  const updates: unknown[][] = [];
  const primaryProfile = sparseProfile();
  const repo = createDevProvidersIssuerProfileRepository({
    primary: {
      async find() {
        return primaryProfile;
      },
    },
    db: {
      async query(text, values) {
        if (text.includes("issuer_profile_enrichments")) {
          throw new Error("missing source row");
        }
        updates.push(values ?? []);
        return { rows: [] };
      },
    },
    baseUrl: "http://dev-providers.test",
    fetchImpl: async () => new Response(JSON.stringify({
      status: "available",
      data: { sector: "Technology" },
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });

  assert.equal(await repo.find(ISSUER_ID), primaryProfile);
  assert.deepEqual(updates, []);
});

test("dev providers profile repository fills nulls only and keeps primary provider values", async () => {
  const primary: IssuerProfileRepository = {
    async find() {
      return sparseProfile({ sector: "Existing Sector" });
    },
  };
  const repo = createDevProvidersIssuerProfileRepository({
    primary,
    db: {
      async query() {
        return { rows: [] };
      },
    },
    baseUrl: "http://dev-providers.test",
    fetchImpl: async () => new Response(JSON.stringify({
      status: "available",
      data: {
        sector: "Finviz Sector",
        industry: "Semiconductors",
      },
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });

  const profile = await repo.find(ISSUER_ID);

  assert.equal(profile?.sector, "Existing Sector");
  assert.equal(profile?.industry, "Semiconductors");
});

test("dev providers profile repository degrades unavailable Finviz responses to the primary profile", async () => {
  let updates = 0;
  const primaryProfile = sparseProfile();
  const repo = createDevProvidersIssuerProfileRepository({
    primary: {
      async find() {
        return primaryProfile;
      },
    },
    db: {
      async query() {
        updates++;
        return { rows: [] };
      },
    },
    baseUrl: "http://dev-providers.test",
    fetchImpl: async () => new Response(JSON.stringify({
      status: "unavailable",
      reason: "missing_coverage",
      retryable: false,
      detail: "finviz unsupported venue",
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });

  assert.equal(await repo.find(ISSUER_ID), primaryProfile);
  assert.equal(updates, 0);
});

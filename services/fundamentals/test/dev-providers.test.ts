import test from "node:test";
import assert from "node:assert/strict";
import {
  createDevProviderRuntime,
  createDevProvidersConsensusRepository,
  createDevProvidersEarningsRepository,
  createDevProvidersHoldersRepository,
  createDevProvidersIssuerProfileRepository,
} from "../src/dev-providers.ts";
import { FundamentalsDataUnavailableError } from "../src/availability.ts";
import { YAHOO_FINANCE_DEV_FUNDAMENTALS_SOURCE_ID } from "../src/provider-sources.ts";
import type { IssuerProfileRecord, IssuerProfileRepository } from "../src/issuer-repository.ts";

const ISSUER_ID = "99999999-9999-4999-9999-999999999999";
const LISTING_ID = "88888888-8888-4888-8888-888888888888";

type DbQuery = (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

function testDb(query: DbQuery) {
  return {
    query,
    async connect() {
      return {
        query,
        release() {
          // Test double; pg clients expose release but have no useful behavior here.
        },
      };
    },
  };
}

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
      ...testDb(async (text, values) => {
        if (text.includes("issuer_profile_enrichments")) {
          insertedEnrichments.push(values ?? []);
        } else if (text.includes("update issuers")) {
          updates.push(values ?? []);
        }
        return { rows: [] };
      }),
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

test("dev providers profile repository rolls back and surfaces persistence failures", async () => {
  const queries: string[] = [];
  const primaryProfile = sparseProfile();
  const repo = createDevProvidersIssuerProfileRepository({
    primary: {
      async find() {
        return primaryProfile;
      },
    },
    db: {
      ...testDb(async (text) => {
        queries.push(text);
        if (text.includes("update issuers")) {
          throw new Error("issuer update failed");
        }
        return { rows: [] };
      }),
    },
    baseUrl: "http://dev-providers.test",
    fetchImpl: async () => new Response(JSON.stringify({
      status: "available",
      data: { sector: "Technology" },
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });

  await assert.rejects(() => repo.find(ISSUER_ID), /issuer update failed/);
  assert.match(queries[0], /^begin$/i);
  assert.ok(queries.some((text) => text.includes("issuer_profile_enrichments")));
  assert.ok(queries.some((text) => text.includes("update issuers")));
  assert.ok(queries.some((text) => /^rollback$/i.test(text)));
  assert.ok(!queries.some((text) => /^commit$/i.test(text)));
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
      ...testDb(async () => {
        return { rows: [] };
      }),
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
      ...testDb(async () => {
        updates++;
        return { rows: [] };
      }),
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

test("dev provider runtime keeps earnings and holders on the primary profile repository", async () => {
  const paths: string[] = [];
  let profileFinds = 0;
  let dbQueries = 0;
  const runtime = createDevProviderRuntime({
    profiles: {
      async find() {
        profileFinds++;
        return sparseProfile();
      },
    },
    db: testDb(async () => {
      dbQueries++;
      return { rows: [] };
    }),
    baseUrl: "http://dev-providers.test",
    sourceId: YAHOO_FINANCE_DEV_FUNDAMENTALS_SOURCE_ID,
    fetchImpl: async (url, init) => {
      paths.push(new URL(String(url)).pathname);
      const body = JSON.parse(String(init?.body));
      if (paths[paths.length - 1] === "/fundamentals/holders") {
        return new Response(JSON.stringify({
          status: "available",
          data: {
            currency: "USD",
            as_of: "2026-05-31T12:00:00.000Z",
            holders: [
              {
                holder_name: "Blackrock Inc.",
                shares_held: 1_144_695_425,
                market_value: 357_213_651_530,
                percent_of_shares_outstanding: 7.79,
                shares_change: -9_930_000,
                filing_date: "2026-03-31",
              },
            ],
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      assert.equal(body.ticker, "AMD");
      return new Response(JSON.stringify({
        status: "available",
        data: {
          currency: "USD",
          as_of: "2026-05-31T12:00:00.000Z",
          events: [
            {
              release_date: "2026-04-30",
              period_end: "2026-03-31",
              eps_actual: 2.01,
              eps_estimate_at_release: 1.94,
              as_of: "2026-05-31T12:00:00.000Z",
            },
          ],
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const earnings = await runtime.earnings.find(ISSUER_ID);
  const holders = await runtime.holders.find(ISSUER_ID, "institutional");

  assert.equal(earnings?.subject.id, ISSUER_ID);
  assert.equal(holders?.subject.id, ISSUER_ID);
  assert.deepEqual(paths, ["/fundamentals/earnings", "/fundamentals/holders"]);
  assert.equal(profileFinds, 2);
  assert.equal(dbQueries, 0);
});

test("dev providers earnings repository maps sidecar rows onto the requested issuer", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const repo = createDevProvidersEarningsRepository({
    profiles: {
      async find() {
        return sparseProfile();
      },
    },
    baseUrl: "http://dev-providers.test",
    sourceId: YAHOO_FINANCE_DEV_FUNDAMENTALS_SOURCE_ID,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({
        status: "available",
        data: {
          currency: "USD",
          as_of: "2026-05-31T12:00:00.000Z",
          events: [
            {
              release_date: "2026-04-30",
              period_end: "2026-03-31",
              eps_actual: 2.01,
              eps_estimate_at_release: 1.94,
              as_of: "2026-05-31T12:00:00.000Z",
            },
          ],
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const envelope = await repo.find(ISSUER_ID);

  assert.equal(envelope?.subject.id, ISSUER_ID);
  assert.equal(envelope?.events[0].source_id, YAHOO_FINANCE_DEV_FUNDAMENTALS_SOURCE_ID);
  assert.equal(envelope?.events[0].release_date, "2026-04-30");
  assert.equal(envelope?.events[0].fiscal_year, 2026);
  assert.equal(envelope?.events[0].fiscal_period, "Q1");
  assert.equal(calls[0].url, "http://dev-providers.test/fundamentals/earnings");
  assert.deepEqual(calls[0].body, {
    ticker: "AMD",
    mic: "XNAS",
    currency: "USD",
    timezone: "America/New_York",
  });
});

test("dev providers earnings repository preserves sidecar unavailable errors", async () => {
  const repo = createDevProvidersEarningsRepository({
    profiles: {
      async find() {
        return sparseProfile();
      },
    },
    baseUrl: "http://dev-providers.test",
    sourceId: YAHOO_FINANCE_DEV_FUNDAMENTALS_SOURCE_ID,
    fetchImpl: async () => new Response(JSON.stringify({
      status: "unavailable",
      reason: "rate_limited",
      retryable: true,
      detail: "yfinance throttled earnings lookup",
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });

  await assert.rejects(
    () => repo.find(ISSUER_ID),
    (error: unknown) =>
      error instanceof FundamentalsDataUnavailableError &&
      error.reason === "rate_limited" &&
      error.retryable === true &&
      /throttled/.test(error.message),
  );
});

test("dev providers earnings repository labels yfinance period_end rows with issuer fiscal calendars", async () => {
  const repo = createDevProvidersEarningsRepository({
    profiles: {
      async find() {
        return sparseProfile({
          legal_name: "Apple Inc.",
          cik: "0000320193",
          exchanges: [
            {
              listing: { kind: "listing", id: LISTING_ID },
              mic: "XNAS",
              ticker: "AAPL",
              trading_currency: "USD",
              timezone: "America/New_York",
            },
          ],
        });
      },
    },
    baseUrl: "http://dev-providers.test",
    sourceId: YAHOO_FINANCE_DEV_FUNDAMENTALS_SOURCE_ID,
    fetchImpl: async () => new Response(JSON.stringify({
      status: "available",
      data: {
        currency: "USD",
        as_of: "2026-05-31T12:00:00.000Z",
        events: [
          {
            release_date: "2025-05-01",
            period_end: "2025-03-31",
            eps_actual: 1.65,
            eps_estimate_at_release: 1.62,
            as_of: "2026-05-31T12:00:00.000Z",
          },
        ],
      },
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });

  const envelope = await repo.find(ISSUER_ID);

  assert.equal(envelope?.events[0].fiscal_year, 2025);
  assert.equal(envelope?.events[0].fiscal_period, "Q2");
});

test("dev providers earnings repository rejects malformed available payloads as provider errors", async () => {
  const repo = createDevProvidersEarningsRepository({
    profiles: {
      async find() {
        return sparseProfile();
      },
    },
    baseUrl: "http://dev-providers.test",
    sourceId: YAHOO_FINANCE_DEV_FUNDAMENTALS_SOURCE_ID,
    fetchImpl: async () => new Response(JSON.stringify({
      status: "available",
      data: {
        as_of: "2026-05-31T12:00:00.000Z",
        events: [{ release_date: "not-a-date" }],
      },
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });

  await assert.rejects(
    () => repo.find(ISSUER_ID),
    (error: unknown) =>
      error instanceof FundamentalsDataUnavailableError &&
      error.reason === "provider_error" &&
      /malformed earnings/.test(error.message),
  );
});

test("dev providers holders repository maps institutional and insider sidecar rows", async () => {
  const requestedKinds: unknown[] = [];
  const repo = createDevProvidersHoldersRepository({
    profiles: {
      async find() {
        return sparseProfile();
      },
    },
    baseUrl: "http://dev-providers.test",
    sourceId: YAHOO_FINANCE_DEV_FUNDAMENTALS_SOURCE_ID,
    fetchImpl: async (url, init) => {
      assert.equal(String(url), "http://dev-providers.test/fundamentals/holders");
      const body = JSON.parse(String(init?.body));
      requestedKinds.push(body.kind);
      return new Response(JSON.stringify({
        status: "available",
        data: body.kind === "institutional"
          ? {
              currency: "USD",
              as_of: "2026-05-31T12:00:00.000Z",
              holders: [
                {
                  holder_name: "Blackrock Inc.",
                  shares_held: 1_144_695_425,
                  market_value: 357_213_651_530,
                  percent_of_shares_outstanding: 7.79,
                  shares_change: -9_930_000,
                  filing_date: "2026-03-31",
                },
              ],
            }
          : {
              currency: "USD",
              as_of: "2026-05-31T12:00:00.000Z",
              holders: [
                {
                  insider_name: "BORDERS BEN",
                  insider_role: "Officer",
                  transaction_date: "2026-05-08",
                  transaction_type: "sell",
                  shares: 1274,
                  price: 290,
                  value: 369460,
                },
              ],
            },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const institutional = await repo.find(ISSUER_ID, "institutional");
  const insider = await repo.find(ISSUER_ID, "insider");

  assert.equal(institutional?.subject.id, ISSUER_ID);
  assert.equal(institutional?.kind, "institutional");
  assert.equal(institutional?.source_id, YAHOO_FINANCE_DEV_FUNDAMENTALS_SOURCE_ID);
  assert.equal(institutional?.holders[0].filing_date, "2026-03-31");
  assert.equal(insider?.subject.id, ISSUER_ID);
  assert.equal(insider?.kind, "insider");
  assert.equal(insider?.holders[0].transaction_date, "2026-05-08");
  assert.deepEqual(requestedKinds, ["institutional", "insider"]);
});

test("dev providers holders repository preserves sidecar unavailable errors", async () => {
  const repo = createDevProvidersHoldersRepository({
    profiles: {
      async find() {
        return sparseProfile();
      },
    },
    baseUrl: "http://dev-providers.test",
    sourceId: YAHOO_FINANCE_DEV_FUNDAMENTALS_SOURCE_ID,
    fetchImpl: async () => new Response(JSON.stringify({
      status: "unavailable",
      reason: "provider_error",
      retryable: true,
      detail: "yfinance holders endpoint changed shape",
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });

  await assert.rejects(
    () => repo.find(ISSUER_ID, "institutional"),
    (error: unknown) =>
      error instanceof FundamentalsDataUnavailableError &&
      error.reason === "provider_error" &&
      error.retryable === true &&
      /changed shape/.test(error.message),
  );
});

test("dev providers consensus repository maps a sidecar envelope onto the issuer", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const repo = createDevProvidersConsensusRepository({
    profiles: { async find() { return sparseProfile(); } },
    baseUrl: "http://dev-providers.test",
    sourceId: YAHOO_FINANCE_DEV_FUNDAMENTALS_SOURCE_ID,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(
        JSON.stringify({
          status: "available",
          data: {
            as_of: "2026-06-04T12:00:00.000Z",
            currency: "USD",
            analyst_count: 41,
            rating_distribution: { strong_buy: 14, buy: 17, hold: 8, sell: 1, strong_sell: 1 },
            price_target: { low: 170, mean: 220.5, median: 215, high: 280 },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  const envelope = await repo.find(ISSUER_ID);
  assert.equal(envelope?.subject.id, ISSUER_ID);
  assert.equal(envelope?.analyst_count, 41);
  assert.equal(envelope?.rating_distribution?.counts.strong_buy, 14);
  assert.equal(envelope?.rating_distribution?.contributor_count, 41);
  assert.equal(envelope?.rating_distribution?.source_id, YAHOO_FINANCE_DEV_FUNDAMENTALS_SOURCE_ID);
  assert.equal(envelope?.price_target?.high, 280);
  assert.equal(envelope?.price_target?.currency, "USD");
  assert.equal(calls[0].url, "http://dev-providers.test/fundamentals/consensus");
  assert.deepEqual(calls[0].body, {
    ticker: "AMD",
    mic: "XNAS",
    currency: "USD",
    timezone: "America/New_York",
  });
});

test("dev providers consensus repository keeps a price target when ratings are absent", async () => {
  const repo = createDevProvidersConsensusRepository({
    profiles: { async find() { return sparseProfile(); } },
    baseUrl: "http://dev-providers.test",
    sourceId: YAHOO_FINANCE_DEV_FUNDAMENTALS_SOURCE_ID,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          status: "available",
          data: {
            as_of: "2026-06-04T12:00:00.000Z",
            currency: "USD",
            analyst_count: 5,
            rating_distribution: null,
            price_target: { low: 100, mean: 120, median: 118, high: 140 },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  });
  const envelope = await repo.find(ISSUER_ID);
  assert.equal(envelope?.rating_distribution, null);
  assert.equal(envelope?.price_target?.mean, 120);
});

test("dev providers consensus repository returns null when coverage is missing", async () => {
  const repo = createDevProvidersConsensusRepository({
    profiles: { async find() { return sparseProfile(); } },
    baseUrl: "http://dev-providers.test",
    sourceId: YAHOO_FINANCE_DEV_FUNDAMENTALS_SOURCE_ID,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({ status: "unavailable", reason: "missing_coverage", retryable: false, detail: "none" }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  });
  assert.equal(await repo.find(ISSUER_ID), null);
});

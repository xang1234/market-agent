import test from "node:test";
import assert from "node:assert/strict";
import { createPostgresIssuerProfileRepository } from "../src/issuer-repository.ts";

test("postgres issuer profile repository builds profile records from canonical identity tables", async () => {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const repo = createPostgresIssuerProfileRepository({
    query: async (text, values) => {
      queries.push({ text, values });
      if (text.includes("from issuers")) {
        return {
          rows: [
            {
              issuer_id: "99999999-9999-4999-9999-999999999999",
              legal_name: "Sundial Growers Inc. Common Shares",
              former_names: [],
              cik: "1766600",
              lei: null,
              domicile: null,
              sector: null,
              industry: null,
            },
          ],
        };
      }
      if (text.includes("from listings")) {
        return {
          rows: [
            {
              listing_id: "88888888-8888-4888-8888-888888888888",
              mic: "XNAS",
              ticker: "SNDL",
              trading_currency: "USD",
              timezone: "America/New_York",
            },
          ],
        };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  });

  const profile = await repo.find("99999999-9999-4999-9999-999999999999");

  assert.ok(profile);
  assert.equal(profile.legal_name, "Sundial Growers Inc. Common Shares");
  assert.equal(profile.cik, "1766600");
  assert.equal(profile.exchanges.length, 1);
  assert.deepEqual(profile.exchanges[0], {
    listing: { kind: "listing", id: "88888888-8888-4888-8888-888888888888" },
    mic: "XNAS",
    ticker: "SNDL",
    trading_currency: "USD",
    timezone: "America/New_York",
  });
  assert.deepEqual(queries.map((query) => query.values), [
    ["99999999-9999-4999-9999-999999999999"],
    ["99999999-9999-4999-9999-999999999999"],
  ]);
});

test("postgres issuer profile repository returns null for unknown issuers", async () => {
  const repo = createPostgresIssuerProfileRepository({
    query: async () => ({ rows: [] }),
  });

  assert.equal(await repo.find("99999999-9999-4999-9999-999999999999"), null);
});

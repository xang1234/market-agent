import test from "node:test";
import assert from "node:assert/strict";
import { createPostgresListingRepository } from "../src/listings.ts";

test("postgres listing repository returns listing context by id", async () => {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const repo = createPostgresListingRepository({
    query: async (text, values) => {
      queries.push({ text, values });
      return {
        rows: [
          {
            listing_id: "66666666-6666-4666-a666-666666666666",
            ticker: "AMD",
            mic: "XNAS",
            trading_currency: "USD",
            timezone: "America/New_York",
          },
        ],
      };
    },
  });

  const record = await repo.find("66666666-6666-4666-a666-666666666666");

  assert.deepEqual(record, {
    listing_id: "66666666-6666-4666-a666-666666666666",
    ticker: "AMD",
    mic: "XNAS",
    trading_currency: "USD",
    timezone: "America/New_York",
  });
  assert.deepEqual(queries[0].values, ["66666666-6666-4666-a666-666666666666"]);
  assert.match(queries[0].text, /from listings/);
});

test("postgres listing repository returns null for an unknown listing", async () => {
  const repo = createPostgresListingRepository({
    query: async () => ({ rows: [] }),
  });

  assert.equal(await repo.find("99999999-9999-4999-a999-999999999999"), null);
});

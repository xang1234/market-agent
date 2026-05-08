import test from "node:test";
import assert from "node:assert/strict";
import { createPostgresCandidateRepository } from "../src/db-candidates.ts";

test("Postgres screener candidate repository reloads candidates on each list", async () => {
  const db = new FakeCandidateDb();
  const repo = createPostgresCandidateRepository(db, () => new Date("2026-05-08T00:00:00.000Z"));

  const first = await repo.list();
  db.price = 12;
  const second = await repo.list();

  assert.equal(db.listQueryCount, 2);
  assert.equal(first[0]?.quote.last_price, 10);
  assert.equal(second[0]?.quote.last_price, 12);
});

class FakeCandidateDb {
  price = 10;
  listQueryCount = 0;

  async query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
  ): Promise<{ rows: R[] }> {
    if (text.includes("from listings l")) {
      this.listQueryCount += 1;
      return rows([
        {
          issuer_id: "11111111-1111-4111-8111-111111111111",
          listing_id: "22222222-2222-4222-8222-222222222222",
          legal_name: "Provider Co",
          share_class: null,
          asset_type: "common_stock",
          mic: "XNAS",
          ticker: "PROV",
          trading_currency: "USD",
          domicile: "US",
          sector: "Technology",
          industry: "Software",
          price: this.price,
          prev_close: 8,
          delay_class: "delayed",
          currency: "USD",
          as_of: "2026-05-08T00:00:00.000Z",
        },
      ] as R[]);
    }
    if (text.includes("with latest_year as")) {
      return rows([]);
    }
    throw new Error(`unhandled query: ${text}`);
  }
}

function rows<R extends Record<string, unknown>>(rows: R[]): { rows: R[] } {
  return { rows };
}

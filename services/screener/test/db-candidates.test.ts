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
    if (text.includes("from facts f")) {
      return rows([]);
    }
    if (text.includes("from insider_transactions")) {
      return rows([]);
    }
    throw new Error(`unhandled query: ${text}`);
  }
}

function rows<R extends Record<string, unknown>>(rows: R[]): { rows: R[] } {
  return { rows };
}

test("Postgres screener candidate repository computes current/prior fundamentals", async () => {
  const db = new FakeFundamentalsDb();
  const repo = createPostgresCandidateRepository(db, () => new Date("2026-05-08T00:00:00.000Z"));

  const candidates = await repo.list();
  const f = candidates[0]?.fundamentals;

  assert.ok(f, "a candidate is produced");
  assert.equal(f.market_cap, 120, "shares_outstanding_diluted(10) * price(12)");
  assert.equal(f.pe_ratio, 6, "price(12) / eps_diluted(2)");
  assert.equal(f.gross_margin, 0.4, "gross_profit(40) / revenue(100)");
  assert.equal(f.operating_margin, 0.3, "operating_income(30) / revenue(100)");
  assert.equal(f.net_margin, 0.2, "net_income(20) / revenue(100)");
  assert.equal(f.revenue_growth_yoy, 0.25, "(revenue 100 - prior 80) / prior 80");
  assert.equal(f.insider_net_shares_90d, 5000, "net insider shares from the read model");
});

class FakeFundamentalsDb {
  async query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
  ): Promise<{ rows: R[] }> {
    if (text.includes("from listings l")) {
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
          price: 12,
          prev_close: 8,
          delay_class: "delayed",
          currency: "USD",
          as_of: "2026-05-08T00:00:00.000Z",
        },
      ] as R[]);
    }
    if (text.includes("f.entitlement_channels")) {
      // Matches the canonical reader's eligibility query (not the legacy CTE,
      // which has no entitlement filter). Rows are ordered fiscal_year desc,
      // as_of desc, metric_key, as the reader returns them.
      return rows(
        [
          fact("revenue", 2024, 100),
          fact("gross_profit", 2024, 40),
          fact("operating_income", 2024, 30),
          fact("net_income", 2024, 20),
          fact("eps_diluted", 2024, 2),
          fact("shares_outstanding_diluted", 2024, 10),
          fact("revenue", 2023, 80),
        ] as R[],
      );
    }
    if (text.includes("from insider_transactions")) {
      return rows([{ net_shares: "5000" }] as R[]);
    }
    throw new Error(`unhandled query: ${text}`);
  }
}

function fact(metric_key: string, fiscal_year: number, value_num: number) {
  return {
    fact_id: `f-${metric_key}-${fiscal_year}`,
    metric_key,
    display_name: metric_key,
    value_num,
    value_text: null,
    unit: "currency",
    currency: "USD",
    fiscal_year,
    fiscal_period: "FY",
    as_of: "2026-05-08T00:00:00.000Z",
    source_id: "33333333-3333-4333-8333-333333333333",
  };
}

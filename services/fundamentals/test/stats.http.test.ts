import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import {
  createFundamentalsServer,
  type FundamentalsServerDeps,
  type GetStatsResponse,
} from "../src/http.ts";
import { createInMemoryIssuerProfileRepository } from "../src/issuer-repository.ts";
import {
  createInMemoryStatsRepository,
  type StatsRepository,
} from "../src/stats-repository.ts";
import {
  DEV_FUNDAMENTALS_SOURCE_ID,
  DEV_ISSUER_PROFILES,
} from "../src/dev-fixtures.ts";
import {
  DEV_PRICE_SOURCE_ID,
  DEV_STATEMENT_SOURCE_ID,
  DEV_STATS_INPUTS,
} from "../src/dev-stats-fixtures.ts";
import type { KeyStat } from "../src/key-stats.ts";
import type { UnavailableEnvelope } from "../src/availability.ts";

const FIXED_NOW = new Date("2026-04-26T15:30:00.000Z");

const APPLE_ISSUER_ID = DEV_STATS_INPUTS[0].subject_id;
const NVDA_ISSUER_ID = DEV_STATS_INPUTS[1].subject_id;

function buildDeps(overrides: Partial<FundamentalsServerDeps> = {}): FundamentalsServerDeps {
  const profiles = createInMemoryIssuerProfileRepository(DEV_ISSUER_PROFILES);
  const stats = createInMemoryStatsRepository(DEV_STATS_INPUTS);
  return {
    profiles,
    stats,
    source_id: DEV_FUNDAMENTALS_SOURCE_ID,
    clock: () => FIXED_NOW,
    ...overrides,
  };
}

async function startServer(t: TestContext, deps: FundamentalsServerDeps): Promise<string> {
  const server = createFundamentalsServer(deps);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

function statByKey(stats: ReadonlyArray<KeyStat>, key: KeyStat["stat_key"]): KeyStat {
  const found = stats.find((s) => s.stat_key === key);
  if (!found) throw new Error(`stat "${key}" missing from envelope`);
  return found;
}

test("GET /v1/fundamentals/stats returns the full key-stats envelope when all inputs are present", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(
    `${url}/v1/fundamentals/stats?subject_kind=issuer&subject_id=${APPLE_ISSUER_ID}`,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as GetStatsResponse;

  assert.equal(body.stats.subject.kind, "issuer");
  assert.equal(body.stats.subject.id, APPLE_ISSUER_ID);
  assert.equal(body.stats.family, "key_stats");
  assert.equal(body.stats.basis, "as_reported");
  assert.equal(body.stats.fiscal_year, 2024);
  assert.equal(body.stats.fiscal_period, "FY");
  assert.equal(body.stats.reporting_currency, "USD");

  const grossMargin = statByKey(body.stats.stats, "gross_margin");
  const operatingMargin = statByKey(body.stats.stats, "operating_margin");
  const netMargin = statByKey(body.stats.stats, "net_margin");
  const revenueGrowth = statByKey(body.stats.stats, "revenue_growth_yoy");
  const peRatio = statByKey(body.stats.stats, "pe_ratio");

  for (const stat of [grossMargin, operatingMargin, netMargin, revenueGrowth, peRatio]) {
    assert.notEqual(stat.value_num, null, `expected ${stat.stat_key} to compute`);
    assert.equal(stat.coverage_level, "full", `${stat.stat_key} coverage must be full`);
    assert.equal(stat.warnings.length, 0, `${stat.stat_key} should have no warnings on full inputs`);
  }

  assert.ok(grossMargin.value_num !== null);
  assert.ok(
    Math.abs(grossMargin.value_num! - 180_683 / 391_035) < 1e-6,
    `gross_margin should equal gross_profit/revenue, got ${grossMargin.value_num}`,
  );
});

test("GET /v1/fundamentals/stats exposes basis/period/as_of on every stat (derivation transparency)", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(
    `${url}/v1/fundamentals/stats?subject_kind=issuer&subject_id=${APPLE_ISSUER_ID}`,
  );
  const body = (await res.json()) as GetStatsResponse;

  for (const stat of body.stats.stats) {
    assert.equal(stat.basis, "as_reported", `${stat.stat_key} missing basis`);
    assert.equal(stat.period_kind, "fiscal_y", `${stat.stat_key} missing period_kind`);
    assert.equal(stat.fiscal_year, 2024, `${stat.stat_key} missing fiscal_year`);
    assert.equal(stat.fiscal_period, "FY", `${stat.stat_key} missing fiscal_period`);
    assert.ok(typeof stat.as_of === "string" && stat.as_of.length > 0, `${stat.stat_key} missing as_of`);
    assert.ok(stat.computation.expression.length > 0, `${stat.stat_key} missing computation expression`);
  }
});

test("GET /v1/fundamentals/stats exposes per-input source_id on every stat input (provenance)", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(
    `${url}/v1/fundamentals/stats?subject_kind=issuer&subject_id=${APPLE_ISSUER_ID}`,
  );
  const body = (await res.json()) as GetStatsResponse;

  for (const stat of body.stats.stats) {
    assert.ok(stat.inputs.length > 0, `${stat.stat_key} should cite its inputs`);
    for (const input of stat.inputs) {
      assert.ok(typeof input.source_id === "string" && input.source_id.length > 0,
        `${stat.stat_key} input missing source_id`);
      assert.ok(typeof input.as_of === "string" && input.as_of.length > 0,
        `${stat.stat_key} input missing as_of`);
    }
  }

  const peRatio = statByKey(body.stats.stats, "pe_ratio");
  const priceInput = peRatio.inputs.find((i) => i.kind === "market_fact");
  const epsInput = peRatio.inputs.find((i) => i.kind === "statement_line" && i.metric_key === "eps_diluted");
  assert.equal(priceInput?.source_id, DEV_PRICE_SOURCE_ID);
  assert.equal(epsInput?.source_id, DEV_STATEMENT_SOURCE_ID);
});

test("GET /v1/fundamentals/stats: sparse inputs flow warnings through unmodified instead of fabricating values", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(
    `${url}/v1/fundamentals/stats?subject_kind=issuer&subject_id=${NVDA_ISSUER_ID}`,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as GetStatsResponse;

  const grossMargin = statByKey(body.stats.stats, "gross_margin");
  assert.notEqual(grossMargin.value_num, null);
  assert.equal(grossMargin.warnings.length, 0);

  const revenueGrowth = statByKey(body.stats.stats, "revenue_growth_yoy");
  assert.equal(revenueGrowth.value_num, null);
  assert.equal(revenueGrowth.coverage_level, "unavailable");
  assert.ok(
    revenueGrowth.warnings.some((w) => w.code === "missing_statement_line"),
    "revenue_growth_yoy should carry a missing_statement_line warning when no prior",
  );

  const peRatio = statByKey(body.stats.stats, "pe_ratio");
  assert.equal(peRatio.value_num, null);
  assert.equal(peRatio.coverage_level, "unavailable");
  assert.ok(
    peRatio.warnings.some((w) => w.code === "missing_market_price"),
    "pe_ratio should carry a missing_market_price warning when no price input",
  );
});

test("GET /v1/fundamentals/stats returns 404 with structured unavailable envelope for unknown issuer", async (t) => {
  const url = await startServer(t, buildDeps());
  const unknown = "99999999-9999-4999-a999-999999999999";
  const res = await fetch(
    `${url}/v1/fundamentals/stats?subject_kind=issuer&subject_id=${unknown}`,
  );
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: string; unavailable: UnavailableEnvelope };
  assert.equal(body.error, "fundamentals stats unavailable");
  assert.equal(body.unavailable.outcome, "unavailable");
  assert.equal(body.unavailable.reason, "missing_coverage");
  assert.equal(body.unavailable.subject.id, unknown);
  assert.equal(body.unavailable.retryable, false);
  assert.equal(body.unavailable.as_of, FIXED_NOW.toISOString());
  assert.match(body.unavailable.detail ?? "", /stats not found/);
});

test("GET /v1/fundamentals/stats rejects a non-issuer subject_kind as 404", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(
    `${url}/v1/fundamentals/stats?subject_kind=listing&subject_id=${APPLE_ISSUER_ID}`,
  );
  assert.equal(res.status, 404);
});

test("GET /v1/fundamentals/stats rejects a malformed UUID as 404", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(
    `${url}/v1/fundamentals/stats?subject_kind=issuer&subject_id=not-a-uuid`,
  );
  assert.equal(res.status, 404);
});

test("POST /v1/fundamentals/stats is not allowed (only GET is wired)", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(
    `${url}/v1/fundamentals/stats?subject_kind=issuer&subject_id=${APPLE_ISSUER_ID}`,
    { method: "POST" },
  );
  assert.equal(res.status, 404);
});

test("GET /v1/fundamentals/stats returns 502 when the stats repository throws", async (t) => {
  const throwingStats: StatsRepository = {
    async find() {
      throw new Error("synthetic stats repo failure");
    },
  };
  const url = await startServer(t, buildDeps({ stats: throwingStats }));
  const res = await fetch(
    `${url}/v1/fundamentals/stats?subject_kind=issuer&subject_id=${APPLE_ISSUER_ID}`,
  );
  assert.equal(res.status, 502);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, "upstream fundamentals data unavailable");
});

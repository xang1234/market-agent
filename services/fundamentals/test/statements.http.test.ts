import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import {
  createFundamentalsServer,
  type FundamentalsServerDeps,
  type GetStatementsRequest,
  type GetStatementsResponse,
} from "../src/http.ts";
import { createInMemoryConsensusRepository } from "../src/consensus-repository.ts";
import { createInMemoryEarningsRepository } from "../src/earnings-repository.ts";
import { createInMemoryIssuerProfileRepository } from "../src/issuer-repository.ts";
import { createInMemorySegmentsRepository } from "../src/segments-repository.ts";
import {
  createInMemoryStatementRepository,
  type StatementRepository,
} from "../src/statement-repository.ts";
import { createInMemoryStatsRepository } from "../src/stats-repository.ts";
import { DEV_CONSENSUS_INPUTS } from "../src/dev-consensus-fixtures.ts";
import { DEV_EARNINGS_INPUTS } from "../src/dev-earnings-fixtures.ts";
import {
  DEV_FUNDAMENTALS_SOURCE_ID,
  DEV_ISSUER_PROFILES,
} from "../src/dev-fixtures.ts";
import { DEV_SEGMENTS } from "../src/dev-segment-fixtures.ts";
import {
  DEV_STATEMENTS,
  DEV_STATEMENT_FIXTURE_SOURCE_ID,
} from "../src/dev-statement-fixtures.ts";
import { DEV_STATS_INPUTS } from "../src/dev-stats-fixtures.ts";
import type { UnavailableEnvelope } from "../src/availability.ts";

const FIXED_NOW = new Date("2026-04-26T15:30:00.000Z");
const APPLE_ISSUER_ID = DEV_ISSUER_PROFILES[0].subject.id;

function buildDeps(overrides: Partial<FundamentalsServerDeps> = {}): FundamentalsServerDeps {
  const profiles = createInMemoryIssuerProfileRepository(DEV_ISSUER_PROFILES);
  const stats = createInMemoryStatsRepository(DEV_STATS_INPUTS);
  const statements = createInMemoryStatementRepository(DEV_STATEMENTS);
  const segments = createInMemorySegmentsRepository(DEV_SEGMENTS);
  const consensus = createInMemoryConsensusRepository(DEV_CONSENSUS_INPUTS);
  const earnings = createInMemoryEarningsRepository(DEV_EARNINGS_INPUTS);
  return {
    profiles,
    stats,
    statements,
    segments,
    consensus,
    earnings,
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

async function postStatements(
  url: string,
  body: unknown,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${url}/v1/fundamentals/statements`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });
}

function appleIncomeRequest(periods: string[]): GetStatementsRequest {
  return {
    subject_ref: { kind: "issuer", id: APPLE_ISSUER_ID },
    statement: "income",
    periods,
    basis: "as_reported",
  };
}

test("POST /v1/fundamentals/statements returns per-period statements and echoes the binding query", async (t) => {
  const url = await startServer(t, buildDeps());
  const request = appleIncomeRequest(["2024-FY", "2023-FY", "2022-FY", "2021-FY", "2020-FY"]);
  const res = await postStatements(url, request);

  assert.equal(res.status, 200);
  const body = (await res.json()) as GetStatementsResponse;

  assert.deepEqual(body.query, request);
  assert.equal(body.results.length, 5);

  for (const entry of body.results) {
    assert.equal(entry.outcome.outcome, "available");
    if (entry.outcome.outcome !== "available") return;
    const statement = entry.outcome.data;
    assert.equal(statement.subject.id, APPLE_ISSUER_ID);
    assert.equal(statement.family, "income");
    assert.equal(statement.basis, "as_reported");
    assert.equal(statement.fiscal_period, "FY");
    assert.equal(statement.reporting_currency, "USD");
    assert.equal(statement.source_id, DEV_STATEMENT_FIXTURE_SOURCE_ID);
    assert.ok(statement.lines.length >= 6, `${entry.period} should carry an income line set`);
  }

  const fy2024 = body.results.find((e) => e.period === "2024-FY")?.outcome;
  assert.ok(fy2024 && fy2024.outcome === "available");
  if (fy2024 && fy2024.outcome === "available") {
    const revenue = fy2024.data.lines.find((l) => l.metric_key === "revenue");
    assert.equal(revenue?.value_num, 391_035_000_000);
  }
});

test("POST /v1/fundamentals/statements per-period misses become missing_coverage without polluting siblings", async (t) => {
  const url = await startServer(t, buildDeps());
  // FY2019 isn't seeded; FY2024 is.
  const res = await postStatements(url, appleIncomeRequest(["2024-FY", "2019-FY"]));

  assert.equal(res.status, 200);
  const body = (await res.json()) as GetStatementsResponse;
  assert.equal(body.results.length, 2);

  assert.equal(body.results[0].outcome.outcome, "available");

  const missing = body.results[1].outcome;
  assert.equal(missing.outcome, "unavailable");
  if (missing.outcome !== "unavailable") return;
  assert.equal(missing.reason, "missing_coverage");
  assert.equal(missing.subject.id, APPLE_ISSUER_ID);
  assert.equal(missing.retryable, false);
  assert.match(missing.detail ?? "", /2019-FY/);
});

test("POST /v1/fundamentals/statements honors the basis branch (as_reported vs as_restated)", async (t) => {
  const url = await startServer(t, buildDeps());
  const asReported = await postStatements(url, appleIncomeRequest(["2020-FY"]));
  const asRestatedReq = { ...appleIncomeRequest(["2020-FY"]), basis: "as_restated" as const };
  const asRestated = await postStatements(url, asRestatedReq);

  const reportedBody = (await asReported.json()) as GetStatementsResponse;
  const restatedBody = (await asRestated.json()) as GetStatementsResponse;

  const reportedOutcome = reportedBody.results[0].outcome;
  const restatedOutcome = restatedBody.results[0].outcome;
  assert.equal(reportedOutcome.outcome, "available");
  assert.equal(restatedOutcome.outcome, "available");
  if (reportedOutcome.outcome !== "available" || restatedOutcome.outcome !== "available") return;

  assert.equal(reportedOutcome.data.basis, "as_reported");
  assert.equal(restatedOutcome.data.basis, "as_restated");

  // The fixture restated EPS by a cent; the assertion proves the basis branch
  // is plumbed through to per-line data, not just to the envelope label.
  const reportedEps = reportedOutcome.data.lines.find((l) => l.metric_key === "eps_diluted");
  const restatedEps = restatedOutcome.data.lines.find((l) => l.metric_key === "eps_diluted");
  assert.notEqual(reportedEps?.value_num, restatedEps?.value_num);
});

test("POST /v1/fundamentals/statements: requesting a basis that exists for one period but not the other surfaces per-period miss", async (t) => {
  const url = await startServer(t, buildDeps());
  // as_restated only exists for 2020-FY in the fixture.
  const res = await postStatements(url, {
    ...appleIncomeRequest(["2020-FY", "2021-FY"]),
    basis: "as_restated",
  });
  const body = (await res.json()) as GetStatementsResponse;
  assert.equal(body.results[0].outcome.outcome, "available");
  assert.equal(body.results[1].outcome.outcome, "unavailable");
});

test("POST /v1/fundamentals/statements rejects malformed period strings with 400", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await postStatements(url, appleIncomeRequest(["2024-FY", "not-a-period"]));
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /not-a-period/);
});

test("POST /v1/fundamentals/statements rejects duplicate period strings", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await postStatements(url, appleIncomeRequest(["2024-FY", "2024-FY"]));
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /duplicate/);
});

test("POST /v1/fundamentals/statements rejects an empty periods array", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await postStatements(url, appleIncomeRequest([]));
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /periods/);
});

test("POST /v1/fundamentals/statements rejects a non-issuer subject_ref", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await postStatements(url, {
    ...appleIncomeRequest(["2024-FY"]),
    subject_ref: { kind: "listing", id: APPLE_ISSUER_ID },
  });
  assert.equal(res.status, 400);
});

test("POST /v1/fundamentals/statements rejects an unknown statement family", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await postStatements(url, {
    ...appleIncomeRequest(["2024-FY"]),
    statement: "segments",
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /income, balance, cashflow/);
});

test("POST /v1/fundamentals/statements rejects an unknown basis value", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await postStatements(url, {
    ...appleIncomeRequest(["2024-FY"]),
    basis: "as_predicted",
  });
  assert.equal(res.status, 400);
});

test("POST /v1/fundamentals/statements rejects malformed JSON with 400", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await postStatements(url, "{ not json");
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /invalid JSON/i);
});

test("POST /v1/fundamentals/statements rejects non-JSON content-type with 415", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(`${url}/v1/fundamentals/statements`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: JSON.stringify(appleIncomeRequest(["2024-FY"])),
  });
  assert.equal(res.status, 415);
});

test("GET /v1/fundamentals/statements is not allowed (only POST is wired)", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(`${url}/v1/fundamentals/statements`);
  assert.equal(res.status, 404);
});

test("POST /v1/fundamentals/statements 502s when the statements repository throws", async (t) => {
  const throwing: StatementRepository = {
    async find() {
      throw new Error("synthetic statements repo failure");
    },
  };
  const url = await startServer(t, buildDeps({ statements: throwing }));
  const res = await postStatements(url, appleIncomeRequest(["2024-FY"]));
  assert.equal(res.status, 502);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, "upstream fundamentals data unavailable");
});

test("POST /v1/fundamentals/statements: missing_coverage envelope as_of is pinned to the injected clock", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await postStatements(url, appleIncomeRequest(["2019-FY"]));
  const body = (await res.json()) as GetStatementsResponse;
  const outcome = body.results[0].outcome;
  assert.equal(outcome.outcome, "unavailable");
  if (outcome.outcome !== "unavailable") return;
  assert.equal((outcome as UnavailableEnvelope).as_of, FIXED_NOW.toISOString());
});

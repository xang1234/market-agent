import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import {
  createFundamentalsServer,
  type FundamentalsServerDeps,
  type GetConsensusResponse,
} from "../src/http.ts";
import {
  createInMemoryConsensusRepository,
  type ConsensusRepository,
} from "../src/consensus-repository.ts";
import { createInMemoryEarningsRepository } from "../src/earnings-repository.ts";
import { createInMemoryHoldersRepository } from "../src/holders-repository.ts";
import { createInMemoryIssuerProfileRepository } from "../src/issuer-repository.ts";
import { createInMemorySegmentsRepository } from "../src/segments-repository.ts";
import { createInMemoryStatementRepository } from "../src/statement-repository.ts";
import { createInMemoryStatsRepository } from "../src/stats-repository.ts";
import {
  DEV_CONSENSUS_INPUTS,
  DEV_CONSENSUS_SOURCE_ID,
} from "../src/dev-consensus-fixtures.ts";
import { DEV_EARNINGS_INPUTS } from "../src/dev-earnings-fixtures.ts";
import {
  DEV_INSIDER_HOLDERS_INPUTS,
  DEV_INSTITUTIONAL_HOLDERS_INPUTS,
} from "../src/dev-holders-fixtures.ts";
import {
  DEV_FUNDAMENTALS_SOURCE_ID,
  DEV_ISSUER_PROFILES,
} from "../src/dev-fixtures.ts";
import { DEV_SEGMENTS } from "../src/dev-segment-fixtures.ts";
import { DEV_STATEMENTS } from "../src/dev-statement-fixtures.ts";
import { DEV_STATS_INPUTS } from "../src/dev-stats-fixtures.ts";
import type { UnavailableEnvelope } from "../src/availability.ts";

const FIXED_NOW = new Date("2026-04-26T15:30:00.000Z");
const APPLE_ISSUER_ID = DEV_CONSENSUS_INPUTS[0].subject_id;

function buildDeps(overrides: Partial<FundamentalsServerDeps> = {}): FundamentalsServerDeps {
  const profiles = createInMemoryIssuerProfileRepository(DEV_ISSUER_PROFILES);
  const stats = createInMemoryStatsRepository(DEV_STATS_INPUTS);
  const statements = createInMemoryStatementRepository(DEV_STATEMENTS);
  const segments = createInMemorySegmentsRepository(DEV_SEGMENTS);
  const consensus = createInMemoryConsensusRepository(DEV_CONSENSUS_INPUTS);
  const earnings = createInMemoryEarningsRepository(DEV_EARNINGS_INPUTS);
  const holders = createInMemoryHoldersRepository({
    institutional: DEV_INSTITUTIONAL_HOLDERS_INPUTS,
    insider: DEV_INSIDER_HOLDERS_INPUTS,
  });
  return {
    profiles,
    stats,
    statements,
    segments,
    consensus,
    earnings,
    holders,
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

test("GET /v1/fundamentals/consensus returns the analyst-consensus envelope", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(
    `${url}/v1/fundamentals/consensus?subject_kind=issuer&subject_id=${APPLE_ISSUER_ID}`,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as GetConsensusResponse;

  assert.equal(body.consensus.subject.kind, "issuer");
  assert.equal(body.consensus.subject.id, APPLE_ISSUER_ID);
  assert.equal(body.consensus.family, "analyst_consensus");
  assert.equal(body.consensus.analyst_count, 41);

  assert.ok(body.consensus.rating_distribution, "rating_distribution should be present");
  assert.equal(body.consensus.rating_distribution!.contributor_count, 41);
  assert.equal(body.consensus.rating_distribution!.counts.strong_buy, 14);
  assert.equal(body.consensus.rating_distribution!.source_id, DEV_CONSENSUS_SOURCE_ID);

  assert.ok(body.consensus.price_target, "price_target should be present");
  assert.equal(body.consensus.price_target!.currency, "USD");
  assert.equal(body.consensus.price_target!.mean, 220.5);
  assert.ok(
    body.consensus.price_target!.low <= body.consensus.price_target!.median,
    "low <= median expected",
  );

  assert.equal(body.consensus.estimates.length, 2);
  const epsEstimate = body.consensus.estimates.find((e) => e.metric_key === "eps_diluted");
  assert.ok(epsEstimate, "eps_diluted estimate should be present");
  assert.equal(epsEstimate!.fiscal_year, 2026);
  assert.equal(epsEstimate!.fiscal_period, "FY");
});

test("GET /v1/fundamentals/consensus exposes per-input source_id and as_of (provenance)", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(
    `${url}/v1/fundamentals/consensus?subject_kind=issuer&subject_id=${APPLE_ISSUER_ID}`,
  );
  const body = (await res.json()) as GetConsensusResponse;

  assert.ok(body.consensus.rating_distribution!.as_of.length > 0);
  assert.equal(body.consensus.rating_distribution!.source_id, DEV_CONSENSUS_SOURCE_ID);
  assert.ok(body.consensus.price_target!.as_of.length > 0);
  assert.equal(body.consensus.price_target!.source_id, DEV_CONSENSUS_SOURCE_ID);
  for (const estimate of body.consensus.estimates) {
    assert.ok(estimate.as_of.length > 0, `${estimate.metric_key} missing as_of`);
    assert.equal(estimate.source_id, DEV_CONSENSUS_SOURCE_ID);
  }
});

test("GET /v1/fundamentals/consensus returns 404 with structured unavailable envelope for unknown issuer", async (t) => {
  const url = await startServer(t, buildDeps());
  const unknown = "99999999-9999-4999-a999-999999999999";
  const res = await fetch(
    `${url}/v1/fundamentals/consensus?subject_kind=issuer&subject_id=${unknown}`,
  );
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: string; unavailable: UnavailableEnvelope };
  assert.equal(body.error, "fundamentals consensus unavailable");
  assert.equal(body.unavailable.outcome, "unavailable");
  assert.equal(body.unavailable.reason, "missing_coverage");
  assert.equal(body.unavailable.subject.id, unknown);
  assert.equal(body.unavailable.retryable, false);
  assert.equal(body.unavailable.as_of, FIXED_NOW.toISOString());
  assert.match(body.unavailable.detail ?? "", /consensus not found/);
});

test("GET /v1/fundamentals/consensus rejects a non-issuer subject_kind as 404", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(
    `${url}/v1/fundamentals/consensus?subject_kind=listing&subject_id=${APPLE_ISSUER_ID}`,
  );
  assert.equal(res.status, 404);
});

test("GET /v1/fundamentals/consensus rejects a malformed UUID as 404", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(
    `${url}/v1/fundamentals/consensus?subject_kind=issuer&subject_id=not-a-uuid`,
  );
  assert.equal(res.status, 404);
});

test("POST /v1/fundamentals/consensus is not allowed (only GET is wired)", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(
    `${url}/v1/fundamentals/consensus?subject_kind=issuer&subject_id=${APPLE_ISSUER_ID}`,
    { method: "POST" },
  );
  assert.equal(res.status, 404);
});

test("GET /v1/fundamentals/consensus returns 502 when the consensus repository throws", async (t) => {
  const throwingConsensus: ConsensusRepository = {
    async find() {
      throw new Error("synthetic consensus repo failure");
    },
  };
  const url = await startServer(t, buildDeps({ consensus: throwingConsensus }));
  const res = await fetch(
    `${url}/v1/fundamentals/consensus?subject_kind=issuer&subject_id=${APPLE_ISSUER_ID}`,
  );
  assert.equal(res.status, 502);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, "upstream fundamentals data unavailable");
});

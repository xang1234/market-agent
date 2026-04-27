import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import {
  createFundamentalsServer,
  type FundamentalsServerDeps,
  type GetEarningsResponse,
} from "../src/http.ts";
import { createInMemoryConsensusRepository } from "../src/consensus-repository.ts";
import {
  createInMemoryEarningsRepository,
  type EarningsRepository,
} from "../src/earnings-repository.ts";
import { createInMemoryIssuerProfileRepository } from "../src/issuer-repository.ts";
import { createInMemorySegmentsRepository } from "../src/segments-repository.ts";
import { createInMemoryStatementRepository } from "../src/statement-repository.ts";
import { createInMemoryStatsRepository } from "../src/stats-repository.ts";
import { DEV_CONSENSUS_INPUTS } from "../src/dev-consensus-fixtures.ts";
import {
  DEV_EARNINGS_INPUTS,
  DEV_EARNINGS_SOURCE_ID,
} from "../src/dev-earnings-fixtures.ts";
import {
  DEV_FUNDAMENTALS_SOURCE_ID,
  DEV_ISSUER_PROFILES,
} from "../src/dev-fixtures.ts";
import { DEV_SEGMENTS } from "../src/dev-segment-fixtures.ts";
import { DEV_STATEMENTS } from "../src/dev-statement-fixtures.ts";
import { DEV_STATS_INPUTS } from "../src/dev-stats-fixtures.ts";
import type { UnavailableEnvelope } from "../src/availability.ts";

const FIXED_NOW = new Date("2026-04-26T15:30:00.000Z");
const APPLE_ISSUER_ID = DEV_EARNINGS_INPUTS[0].subject.id;

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

test("GET /v1/fundamentals/earnings returns the earnings-events envelope", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(
    `${url}/v1/fundamentals/earnings?subject_kind=issuer&subject_id=${APPLE_ISSUER_ID}`,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as GetEarningsResponse;

  assert.equal(body.earnings.subject.kind, "issuer");
  assert.equal(body.earnings.subject.id, APPLE_ISSUER_ID);
  assert.equal(body.earnings.family, "earnings_events");
  assert.equal(body.earnings.currency, "USD");
  assert.equal(body.earnings.events.length, 8);
});

test("GET /v1/fundamentals/earnings sorts events newest-first by release_date", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(
    `${url}/v1/fundamentals/earnings?subject_kind=issuer&subject_id=${APPLE_ISSUER_ID}`,
  );
  const body = (await res.json()) as GetEarningsResponse;

  for (let i = 1; i < body.earnings.events.length; i++) {
    assert.ok(
      body.earnings.events[i - 1].release_date >= body.earnings.events[i].release_date,
      `expected newest-first ordering at index ${i}`,
    );
  }
  assert.equal(body.earnings.events[0].release_date, "2024-10-31");
});

test("GET /v1/fundamentals/earnings exposes surprise_pct + direction on the wire", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(
    `${url}/v1/fundamentals/earnings?subject_kind=issuer&subject_id=${APPLE_ISSUER_ID}`,
  );
  const body = (await res.json()) as GetEarningsResponse;

  const beats = body.earnings.events.filter((e) => e.surprise_direction === "beat");
  const misses = body.earnings.events.filter((e) => e.surprise_direction === "miss");
  assert.ok(beats.length > 0, "Apple's recent quarters include beats");
  assert.ok(misses.length > 0, "Apple's recent quarters include at least one miss");

  for (const event of body.earnings.events) {
    if (event.eps_actual === null || event.eps_estimate_at_release === null) continue;
    assert.ok(event.surprise_pct !== null, `${event.fiscal_period} should have surprise_pct`);
    assert.ok(typeof event.surprise_pct === "number" && Number.isFinite(event.surprise_pct));
  }
});

test("GET /v1/fundamentals/earnings exposes per-event source_id and as_of (provenance)", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(
    `${url}/v1/fundamentals/earnings?subject_kind=issuer&subject_id=${APPLE_ISSUER_ID}`,
  );
  const body = (await res.json()) as GetEarningsResponse;

  for (const event of body.earnings.events) {
    assert.equal(event.source_id, DEV_EARNINGS_SOURCE_ID);
    assert.ok(event.as_of.length > 0);
  }
});

test("GET /v1/fundamentals/earnings returns 404 with structured unavailable envelope for unknown issuer", async (t) => {
  const url = await startServer(t, buildDeps());
  const unknown = "99999999-9999-4999-a999-999999999999";
  const res = await fetch(
    `${url}/v1/fundamentals/earnings?subject_kind=issuer&subject_id=${unknown}`,
  );
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: string; unavailable: UnavailableEnvelope };
  assert.equal(body.error, "fundamentals earnings unavailable");
  assert.equal(body.unavailable.outcome, "unavailable");
  assert.equal(body.unavailable.reason, "missing_coverage");
  assert.equal(body.unavailable.subject.id, unknown);
  assert.equal(body.unavailable.retryable, false);
  assert.equal(body.unavailable.as_of, FIXED_NOW.toISOString());
  assert.match(body.unavailable.detail ?? "", /earnings not found/);
});

test("GET /v1/fundamentals/earnings rejects a non-issuer subject_kind as 404", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(
    `${url}/v1/fundamentals/earnings?subject_kind=listing&subject_id=${APPLE_ISSUER_ID}`,
  );
  assert.equal(res.status, 404);
});

test("GET /v1/fundamentals/earnings rejects a malformed UUID as 404", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(
    `${url}/v1/fundamentals/earnings?subject_kind=issuer&subject_id=not-a-uuid`,
  );
  assert.equal(res.status, 404);
});

test("POST /v1/fundamentals/earnings is not allowed (only GET is wired)", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(
    `${url}/v1/fundamentals/earnings?subject_kind=issuer&subject_id=${APPLE_ISSUER_ID}`,
    { method: "POST" },
  );
  assert.equal(res.status, 404);
});

test("GET /v1/fundamentals/earnings returns 502 when the earnings repository throws", async (t) => {
  const throwingEarnings: EarningsRepository = {
    async find() {
      throw new Error("synthetic earnings repo failure");
    },
  };
  const url = await startServer(t, buildDeps({ earnings: throwingEarnings }));
  const res = await fetch(
    `${url}/v1/fundamentals/earnings?subject_kind=issuer&subject_id=${APPLE_ISSUER_ID}`,
  );
  assert.equal(res.status, 502);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, "upstream fundamentals data unavailable");
});

import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import {
  createFundamentalsServer,
  type FundamentalsServerDeps,
  type GetHoldersResponse,
} from "../src/http.ts";
import { createInMemoryConsensusRepository } from "../src/consensus-repository.ts";
import { createInMemoryEarningsRepository } from "../src/earnings-repository.ts";
import {
  createInMemoryHoldersRepository,
  type HoldersRepository,
} from "../src/holders-repository.ts";
import { createInMemoryIssuerProfileRepository } from "../src/issuer-repository.ts";
import { createInMemorySegmentsRepository } from "../src/segments-repository.ts";
import { createInMemoryStatementRepository } from "../src/statement-repository.ts";
import { createInMemoryStatsRepository } from "../src/stats-repository.ts";
import { DEV_CONSENSUS_INPUTS } from "../src/dev-consensus-fixtures.ts";
import { DEV_EARNINGS_INPUTS } from "../src/dev-earnings-fixtures.ts";
import {
  DEV_FUNDAMENTALS_SOURCE_ID,
  DEV_ISSUER_PROFILES,
} from "../src/dev-fixtures.ts";
import {
  DEV_HOLDERS_SOURCE_ID,
  DEV_INSIDER_HOLDERS_INPUTS,
  DEV_INSTITUTIONAL_HOLDERS_INPUTS,
} from "../src/dev-holders-fixtures.ts";
import { DEV_SEGMENTS } from "../src/dev-segment-fixtures.ts";
import { DEV_STATEMENTS } from "../src/dev-statement-fixtures.ts";
import { DEV_STATS_INPUTS } from "../src/dev-stats-fixtures.ts";
import type { UnavailableEnvelope } from "../src/availability.ts";

const FIXED_NOW = new Date("2026-04-26T15:30:00.000Z");
const APPLE_ISSUER_ID = DEV_INSTITUTIONAL_HOLDERS_INPUTS[0].subject.id;

function buildDeps(overrides: Partial<FundamentalsServerDeps> = {}): FundamentalsServerDeps {
  return {
    profiles: createInMemoryIssuerProfileRepository(DEV_ISSUER_PROFILES),
    stats: createInMemoryStatsRepository(DEV_STATS_INPUTS),
    statements: createInMemoryStatementRepository(DEV_STATEMENTS),
    segments: createInMemorySegmentsRepository(DEV_SEGMENTS),
    consensus: createInMemoryConsensusRepository(DEV_CONSENSUS_INPUTS),
    earnings: createInMemoryEarningsRepository(DEV_EARNINGS_INPUTS),
    holders: createInMemoryHoldersRepository({
      institutional: DEV_INSTITUTIONAL_HOLDERS_INPUTS,
      insider: DEV_INSIDER_HOLDERS_INPUTS,
    }),
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

test("GET /v1/fundamentals/holders?kind=institutional returns the institutional envelope", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(
    `${url}/v1/fundamentals/holders?subject_kind=issuer&subject_id=${APPLE_ISSUER_ID}&kind=institutional`,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as GetHoldersResponse;

  assert.equal(body.holders.subject.kind, "issuer");
  assert.equal(body.holders.subject.id, APPLE_ISSUER_ID);
  assert.equal(body.holders.family, "holders");
  assert.equal(body.holders.kind, "institutional");
  assert.equal(body.holders.currency, "USD");
  assert.equal(body.holders.source_id, DEV_HOLDERS_SOURCE_ID);
  assert.ok(body.holders.holders.length >= 5, "expected several institutional positions");
  if (body.holders.kind === "institutional") {
    const top = body.holders.holders[0];
    assert.ok(top.holder_name.length > 0);
    assert.ok(Number.isInteger(top.shares_held) && top.shares_held > 0);
    assert.ok(top.percent_of_shares_outstanding >= 0 && top.percent_of_shares_outstanding <= 100);
  }
});

test("GET /v1/fundamentals/holders?kind=insider returns the insider envelope sorted newest-first", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(
    `${url}/v1/fundamentals/holders?subject_kind=issuer&subject_id=${APPLE_ISSUER_ID}&kind=insider`,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as GetHoldersResponse;

  assert.equal(body.holders.kind, "insider");
  if (body.holders.kind !== "insider") return;
  assert.ok(body.holders.holders.length > 0);
  for (let i = 1; i < body.holders.holders.length; i++) {
    assert.ok(
      body.holders.holders[i - 1].transaction_date >= body.holders.holders[i].transaction_date,
      `expected newest-first ordering at index ${i}`,
    );
  }
});

test("GET /v1/fundamentals/holders rejects an unknown kind as 404", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(
    `${url}/v1/fundamentals/holders?subject_kind=issuer&subject_id=${APPLE_ISSUER_ID}&kind=mystery`,
  );
  assert.equal(res.status, 404);
});

test("GET /v1/fundamentals/holders without a kind parameter is 404", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(
    `${url}/v1/fundamentals/holders?subject_kind=issuer&subject_id=${APPLE_ISSUER_ID}`,
  );
  assert.equal(res.status, 404);
});

test("GET /v1/fundamentals/holders returns 404 with an unavailable envelope for an unknown issuer", async (t) => {
  const url = await startServer(t, buildDeps());
  const unknown = "99999999-9999-4999-a999-999999999999";
  const res = await fetch(
    `${url}/v1/fundamentals/holders?subject_kind=issuer&subject_id=${unknown}&kind=institutional`,
  );
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: string; unavailable: UnavailableEnvelope };
  assert.equal(body.error, "fundamentals holders unavailable");
  assert.equal(body.unavailable.outcome, "unavailable");
  assert.equal(body.unavailable.reason, "missing_coverage");
  assert.equal(body.unavailable.subject.id, unknown);
  assert.equal(body.unavailable.retryable, false);
  assert.equal(body.unavailable.as_of, FIXED_NOW.toISOString());
  assert.match(body.unavailable.detail ?? "", /institutional holders not found/);
});

test("GET /v1/fundamentals/holders rejects a non-issuer subject_kind as 404", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(
    `${url}/v1/fundamentals/holders?subject_kind=listing&subject_id=${APPLE_ISSUER_ID}&kind=institutional`,
  );
  assert.equal(res.status, 404);
});

test("GET /v1/fundamentals/holders rejects a malformed UUID as 404", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(
    `${url}/v1/fundamentals/holders?subject_kind=issuer&subject_id=not-a-uuid&kind=institutional`,
  );
  assert.equal(res.status, 404);
});

test("POST /v1/fundamentals/holders is not allowed (only GET is wired)", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(
    `${url}/v1/fundamentals/holders?subject_kind=issuer&subject_id=${APPLE_ISSUER_ID}&kind=institutional`,
    { method: "POST" },
  );
  assert.equal(res.status, 404);
});

test("GET /v1/fundamentals/holders returns 502 when the holders repository throws", async (t) => {
  const throwingHolders: HoldersRepository = {
    async find() {
      throw new Error("synthetic holders repo failure");
    },
  };
  const url = await startServer(t, buildDeps({ holders: throwingHolders }));
  const res = await fetch(
    `${url}/v1/fundamentals/holders?subject_kind=issuer&subject_id=${APPLE_ISSUER_ID}&kind=institutional`,
  );
  assert.equal(res.status, 502);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, "upstream fundamentals data unavailable");
});

test("AAPL acceptance: holders endpoint surfaces top institutional + recent insider activity", async (t) => {
  const url = await startServer(t, buildDeps());
  const [instRes, insRes] = await Promise.all([
    fetch(
      `${url}/v1/fundamentals/holders?subject_kind=issuer&subject_id=${APPLE_ISSUER_ID}&kind=institutional`,
    ),
    fetch(
      `${url}/v1/fundamentals/holders?subject_kind=issuer&subject_id=${APPLE_ISSUER_ID}&kind=insider`,
    ),
  ]);
  assert.equal(instRes.status, 200);
  assert.equal(insRes.status, 200);
  const inst = (await instRes.json()) as GetHoldersResponse;
  const ins = (await insRes.json()) as GetHoldersResponse;
  if (inst.holders.kind !== "institutional") throw new Error("expected institutional kind");
  if (ins.holders.kind !== "insider") throw new Error("expected insider kind");
  assert.ok(
    inst.holders.holders.some((h) => /Vanguard/i.test(h.holder_name)),
    "AAPL institutional list should include Vanguard",
  );
  assert.ok(
    ins.holders.holders.some((h) => /COOK/i.test(h.insider_name)),
    "AAPL insider activity should include CEO transactions",
  );
});

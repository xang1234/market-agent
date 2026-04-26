import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import {
  createFundamentalsServer,
  type FundamentalsServerDeps,
  type GetProfileResponse,
} from "../src/http.ts";
import { createInMemoryIssuerProfileRepository } from "../src/issuer-repository.ts";
import { createInMemoryStatementRepository } from "../src/statement-repository.ts";
import { createInMemoryStatsRepository } from "../src/stats-repository.ts";
import {
  DEV_FUNDAMENTALS_SOURCE_ID,
  DEV_ISSUER_PROFILES,
} from "../src/dev-fixtures.ts";
import { DEV_STATEMENTS } from "../src/dev-statement-fixtures.ts";
import { DEV_STATS_INPUTS } from "../src/dev-stats-fixtures.ts";
import type { UnavailableEnvelope } from "../src/availability.ts";
import { assertIssuerProfileContract } from "../src/profile.ts";

const FIXED_NOW = new Date("2026-04-26T15:30:00.000Z");

function buildDeps(): FundamentalsServerDeps {
  const profiles = createInMemoryIssuerProfileRepository(DEV_ISSUER_PROFILES);
  const stats = createInMemoryStatsRepository(DEV_STATS_INPUTS);
  const statements = createInMemoryStatementRepository(DEV_STATEMENTS);
  return {
    profiles,
    stats,
    statements,
    source_id: DEV_FUNDAMENTALS_SOURCE_ID,
    clock: () => FIXED_NOW,
  };
}

async function startServer(t: TestContext, deps: FundamentalsServerDeps): Promise<string> {
  const server = createFundamentalsServer(deps);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

const APPLE_ISSUER_ID = DEV_ISSUER_PROFILES[0].subject.id;
const APPLE_LISTING_ID = DEV_ISSUER_PROFILES[0].exchanges[0].listing.id;

test("GET /healthz returns ok", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(`${url}/healthz`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: "ok", service: "fundamentals" });
});

test("GET /v1/fundamentals/profile returns the issuer profile envelope", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(
    `${url}/v1/fundamentals/profile?subject_kind=issuer&subject_id=${APPLE_ISSUER_ID}`,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as GetProfileResponse;

  assert.doesNotThrow(() => assertIssuerProfileContract(body.profile));

  assert.equal(body.profile.subject.kind, "issuer");
  assert.equal(body.profile.subject.id, APPLE_ISSUER_ID);
  assert.equal(body.profile.legal_name, "Apple Inc.");
  assert.equal(body.profile.sector, "Technology");
  assert.equal(body.profile.industry, "Consumer Electronics");
  assert.equal(body.profile.source_id, DEV_FUNDAMENTALS_SOURCE_ID);
  assert.notEqual(body.profile.source_id, "p1.2-stub");

  assert.equal(body.profile.exchanges.length, 1);
  assert.equal(body.profile.exchanges[0].listing.kind, "listing");
  assert.equal(body.profile.exchanges[0].listing.id, APPLE_LISTING_ID);
  assert.equal(body.profile.exchanges[0].mic, "XNAS");
  assert.equal(body.profile.exchanges[0].ticker, "AAPL");
});

test("GET /v1/fundamentals/profile pins the response as_of to the injected clock", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(
    `${url}/v1/fundamentals/profile?subject_kind=issuer&subject_id=${APPLE_ISSUER_ID}`,
  );
  const body = (await res.json()) as GetProfileResponse;
  assert.equal(body.profile.as_of, FIXED_NOW.toISOString());
});

test("GET /v1/fundamentals/profile surfaces unknown issuer as a 404 with structured unavailable envelope", async (t) => {
  const url = await startServer(t, buildDeps());
  const unknown = "99999999-9999-4999-a999-999999999999";
  const res = await fetch(
    `${url}/v1/fundamentals/profile?subject_kind=issuer&subject_id=${unknown}`,
  );
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: string; unavailable: UnavailableEnvelope };
  assert.equal(body.error, "fundamentals profile unavailable");
  assert.equal(body.unavailable.outcome, "unavailable");
  assert.equal(body.unavailable.reason, "missing_coverage");
  assert.equal(body.unavailable.subject.kind, "issuer");
  assert.equal(body.unavailable.subject.id, unknown);
  assert.equal(body.unavailable.retryable, false);
  assert.equal(body.unavailable.as_of, FIXED_NOW.toISOString());
  assert.match(body.unavailable.detail ?? "", /issuer not found/);
});

test("GET /v1/fundamentals/profile rejects a non-issuer subject_kind as not-found", async (t) => {
  // Spec §6.3.1: listing identity is not appropriate for fundamentals reads.
  const url = await startServer(t, buildDeps());
  const res = await fetch(
    `${url}/v1/fundamentals/profile?subject_kind=listing&subject_id=${APPLE_ISSUER_ID}`,
  );
  assert.equal(res.status, 404);
});

test("GET /v1/fundamentals/profile rejects a malformed subject_id with 404 (no dispatch)", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(
    `${url}/v1/fundamentals/profile?subject_kind=issuer&subject_id=not-a-uuid`,
  );
  assert.equal(res.status, 404);
});

test("GET /v1/fundamentals/profile rejects a missing subject_id with 404 (no dispatch)", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(`${url}/v1/fundamentals/profile?subject_kind=issuer`);
  assert.equal(res.status, 404);
});

test("POST /v1/fundamentals/profile is not allowed (only GET is wired)", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(
    `${url}/v1/fundamentals/profile?subject_kind=issuer&subject_id=${APPLE_ISSUER_ID}`,
    { method: "POST" },
  );
  assert.equal(res.status, 404);
});

test("unknown routes return 404 without leaking implementation details", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(`${url}/v1/fundamentals/unknown`);
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, "not found");
});

test("GET /v1/fundamentals/profile returns 502 when the repository throws an unexpected error", async (t) => {
  const deps: FundamentalsServerDeps = {
    profiles: {
      async find() {
        throw new Error("synthetic repo failure");
      },
    },
    stats: createInMemoryStatsRepository(DEV_STATS_INPUTS),
    statements: createInMemoryStatementRepository(DEV_STATEMENTS),
    source_id: DEV_FUNDAMENTALS_SOURCE_ID,
    clock: () => FIXED_NOW,
  };
  const url = await startServer(t, deps);
  const res = await fetch(
    `${url}/v1/fundamentals/profile?subject_kind=issuer&subject_id=${APPLE_ISSUER_ID}`,
  );
  assert.equal(res.status, 502);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, "upstream fundamentals data unavailable");
});

test("response surfaces every issuer in DEV_ISSUER_PROFILES with its declared legal_name", async (t) => {
  const url = await startServer(t, buildDeps());
  for (const record of DEV_ISSUER_PROFILES) {
    const res = await fetch(
      `${url}/v1/fundamentals/profile?subject_kind=issuer&subject_id=${record.subject.id}`,
    );
    assert.equal(res.status, 200, `expected 200 for ${record.legal_name}`);
    const body = (await res.json()) as GetProfileResponse;
    assert.equal(body.profile.legal_name, record.legal_name);
    assert.equal(body.profile.source_id, DEV_FUNDAMENTALS_SOURCE_ID);
  }
});

test("former_names round-trip through the wire so issuers like Alphabet keep their lineage", async (t) => {
  const url = await startServer(t, buildDeps());
  const alphabet = DEV_ISSUER_PROFILES.find((r) => r.legal_name === "Alphabet Inc.");
  assert.ok(alphabet, "Alphabet fixture missing — adjust the test if you renamed it");

  const res = await fetch(
    `${url}/v1/fundamentals/profile?subject_kind=issuer&subject_id=${alphabet!.subject.id}`,
  );
  const body = (await res.json()) as GetProfileResponse;
  assert.deepEqual([...body.profile.former_names], ["Google Inc."]);
});

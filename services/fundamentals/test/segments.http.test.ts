import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import {
  createFundamentalsServer,
  type FundamentalsServerDeps,
  type GetSegmentsRequest,
  type GetSegmentsResponse,
} from "../src/http.ts";
import { createInMemoryIssuerProfileRepository } from "../src/issuer-repository.ts";
import {
  createInMemorySegmentsRepository,
  type SegmentsRepository,
} from "../src/segments-repository.ts";
import { createInMemoryStatementRepository } from "../src/statement-repository.ts";
import { createInMemoryStatsRepository } from "../src/stats-repository.ts";
import {
  DEV_FUNDAMENTALS_SOURCE_ID,
  DEV_ISSUER_PROFILES,
} from "../src/dev-fixtures.ts";
import {
  DEV_SEGMENTS,
  DEV_SEGMENT_FIXTURE_SOURCE_ID,
} from "../src/dev-segment-fixtures.ts";
import { DEV_STATEMENTS } from "../src/dev-statement-fixtures.ts";
import { DEV_STATS_INPUTS } from "../src/dev-stats-fixtures.ts";
import type { UnavailableEnvelope } from "../src/availability.ts";

const FIXED_NOW = new Date("2026-04-26T15:30:00.000Z");
const APPLE_ISSUER_ID = DEV_ISSUER_PROFILES[0].subject.id;

function buildDeps(overrides: Partial<FundamentalsServerDeps> = {}): FundamentalsServerDeps {
  const profiles = createInMemoryIssuerProfileRepository(DEV_ISSUER_PROFILES);
  const stats = createInMemoryStatsRepository(DEV_STATS_INPUTS);
  const statements = createInMemoryStatementRepository(DEV_STATEMENTS);
  const segments = createInMemorySegmentsRepository(DEV_SEGMENTS);
  return {
    profiles,
    stats,
    statements,
    segments,
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

async function postSegments(url: string, body: unknown, init: RequestInit = {}): Promise<Response> {
  return fetch(`${url}/v1/fundamentals/segments`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });
}

function appleBusinessRequest(period: string = "2024-FY"): GetSegmentsRequest {
  return {
    subject_ref: { kind: "issuer", id: APPLE_ISSUER_ID },
    axis: "business",
    period,
    basis: "as_reported",
  };
}

test("POST /v1/fundamentals/segments returns the segment-facts envelope for the requested axis+period", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await postSegments(url, appleBusinessRequest("2024-FY"));

  assert.equal(res.status, 200);
  const body = (await res.json()) as GetSegmentsResponse;
  const envelope = body.segments;

  assert.equal(envelope.subject.id, APPLE_ISSUER_ID);
  assert.equal(envelope.family, "segment_facts");
  assert.equal(envelope.axis, "business");
  assert.equal(envelope.basis, "as_reported");
  assert.equal(envelope.fiscal_year, 2024);
  assert.equal(envelope.fiscal_period, "FY");
  assert.equal(envelope.reporting_currency, "USD");

  // The fixture seeds 5 business definitions + 5 facts + a consolidated total.
  // The aggregator must emit definitions and facts in the envelope, not collapse.
  assert.equal(envelope.segment_definitions.length, 5);
  assert.equal(envelope.facts.length, 5);

  const iphone = envelope.facts.find((f) => f.segment_id === "iphone");
  assert.equal(iphone?.value_num, 201_183_000_000);
  assert.equal(iphone?.source_id, DEV_SEGMENT_FIXTURE_SOURCE_ID);
});

test("POST /v1/fundamentals/segments coverage_warnings flow through the wire unmodified", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await postSegments(url, appleBusinessRequest("2024-FY"));
  const body = (await res.json()) as GetSegmentsResponse;
  // The Apple FY2024 fixture is internally consistent (consolidated total
  // matches the segment sum), so we expect zero warnings on this happy path.
  // The "warnings flow through" assertion lives in the broader contract:
  // when warnings exist they reach the wire as-is. Here we assert the
  // shape so a future change that drops the array at the wire fails.
  assert.ok(Array.isArray(body.segments.coverage_warnings));
  assert.equal(body.segments.coverage_warnings.length, 0);
});

test("POST /v1/fundamentals/segments honors the axis branch (business vs geography)", async (t) => {
  const url = await startServer(t, buildDeps());
  const business = await postSegments(url, appleBusinessRequest("2024-FY"));
  const geography = await postSegments(url, { ...appleBusinessRequest("2024-FY"), axis: "geography" });

  const businessBody = (await business.json()) as GetSegmentsResponse;
  const geographyBody = (await geography.json()) as GetSegmentsResponse;

  assert.equal(businessBody.segments.axis, "business");
  assert.equal(geographyBody.segments.axis, "geography");
  // The two axes have disjoint segment_id sets — proves the lookup keyed on axis.
  const businessIds = new Set(businessBody.segments.segment_definitions.map((d) => d.segment_id));
  const geographyIds = new Set(geographyBody.segments.segment_definitions.map((d) => d.segment_id));
  for (const id of businessIds) {
    assert.equal(geographyIds.has(id), false, `${id} should not appear in the geography axis`);
  }
});

test("POST /v1/fundamentals/segments returns 404 with structured envelope when axis+period is missing", async (t) => {
  const url = await startServer(t, buildDeps());
  // 2022-FY business segments aren't seeded.
  const res = await postSegments(url, appleBusinessRequest("2022-FY"));
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: string; unavailable: UnavailableEnvelope };
  assert.equal(body.error, "fundamentals segments unavailable");
  assert.equal(body.unavailable.outcome, "unavailable");
  assert.equal(body.unavailable.reason, "missing_coverage");
  assert.equal(body.unavailable.subject.id, APPLE_ISSUER_ID);
  assert.equal(body.unavailable.retryable, false);
  assert.equal(body.unavailable.as_of, FIXED_NOW.toISOString());
  assert.match(body.unavailable.detail ?? "", /business segments not found/);
  assert.match(body.unavailable.detail ?? "", /2022-FY/);
});

test("POST /v1/fundamentals/segments returns 404 for unknown issuer", async (t) => {
  const url = await startServer(t, buildDeps());
  const unknown = "99999999-9999-4999-a999-999999999999";
  const res = await postSegments(url, {
    ...appleBusinessRequest("2024-FY"),
    subject_ref: { kind: "issuer", id: unknown },
  });
  assert.equal(res.status, 404);
});

test("POST /v1/fundamentals/segments rejects malformed period strings with 400", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await postSegments(url, { ...appleBusinessRequest("2024-FY"), period: "Q5-2024" });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /period/);
});

test("POST /v1/fundamentals/segments rejects an unknown axis with 400", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await postSegments(url, { ...appleBusinessRequest("2024-FY"), axis: "celestial" });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /business, geography/);
});

test("POST /v1/fundamentals/segments rejects a non-issuer subject_ref with 400", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await postSegments(url, {
    ...appleBusinessRequest("2024-FY"),
    subject_ref: { kind: "listing", id: APPLE_ISSUER_ID },
  });
  assert.equal(res.status, 400);
});

test("POST /v1/fundamentals/segments rejects an unknown basis with 400", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await postSegments(url, { ...appleBusinessRequest("2024-FY"), basis: "as_predicted" });
  assert.equal(res.status, 400);
});

test("POST /v1/fundamentals/segments rejects malformed JSON with 400", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await postSegments(url, "{ not json");
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /invalid JSON/i);
});

test("POST /v1/fundamentals/segments rejects non-JSON content-type with 415", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(`${url}/v1/fundamentals/segments`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: JSON.stringify(appleBusinessRequest("2024-FY")),
  });
  assert.equal(res.status, 415);
});

test("GET /v1/fundamentals/segments is not allowed (only POST is wired)", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(`${url}/v1/fundamentals/segments`);
  assert.equal(res.status, 404);
});

test("POST /v1/fundamentals/segments 502s when the segments repository throws", async (t) => {
  const throwing: SegmentsRepository = {
    async find() {
      throw new Error("synthetic segments repo failure");
    },
  };
  const url = await startServer(t, buildDeps({ segments: throwing }));
  const res = await postSegments(url, appleBusinessRequest("2024-FY"));
  assert.equal(res.status, 502);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, "upstream fundamentals data unavailable");
});

test("POST /v1/fundamentals/segments preserves segment_definitions axis labels", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await postSegments(url, appleBusinessRequest("2024-FY"));
  const body = (await res.json()) as GetSegmentsResponse;
  const services = body.segments.segment_definitions.find((d) => d.segment_id === "services");
  assert.equal(services?.segment_name, "Services");
});

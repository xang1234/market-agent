import assert from "node:assert/strict";
import test from "node:test";

import { runGoldenLiveCheck } from "../scripts/golden-live-check.ts";
import { candidateQuarters, warmGoldenLiveData } from "../scripts/golden-live-warmup.ts";
import { GOLDEN_COMPANIES } from "./golden/dataset.ts";

const BASE = "http://stack.test";
const LIVE_ISSUERS: Record<string, string> = {
  NVDA: "70000000-0000-4000-8000-000000000001",
  AMD: "70000000-0000-4000-8000-000000000002",
};

// A faked stack: the resolver and fundamentals routes the warm-up calls, with SEC
// reporting through FY2025 plus one quarter of FY2026.
function fakeStack(overrides: { issuers?: Record<string, string | null>; reported?: (period: string) => boolean } = {}) {
  const issuers = { ...LIVE_ISSUERS, ...overrides.issuers };
  const reported = overrides.reported ?? ((period: string) => period <= "2026-Q1");
  const requests: Array<{ path: string; periods?: string[] }> = [];
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ path: url.pathname, ...(body?.periods ? { periods: body.periods } : {}) });
    if (url.pathname === "/v1/subjects/resolve") {
      const id = issuers[body.text];
      return json(200, id ? { subjects: [{ context: { issuer: { subject_ref: { kind: "issuer", id } } } }] } : { subjects: [] });
    }
    if (url.pathname === "/v1/fundamentals/stats") return json(200, { stats: { fiscal_year: 2025 } });
    if (url.pathname === "/v1/fundamentals/statements") {
      const outcome = reported(body.periods[0]) ? "available" : "missing_coverage";
      return json(200, { results: [{ period: body.periods[0], outcome: { outcome } }] });
    }
    return json(404, { error: "not found" });
  };
  return { fetchImpl, requests };
}

test("the warm-up resolves each ticker, reads stats, and ingests quarters newest first until 8 are available", async () => {
  const stack = fakeStack();
  const failures = await warmGoldenLiveData(BASE, { fetchImpl: stack.fetchImpl, log: () => {} });

  assert.deepEqual(failures, []);
  const nvda = stack.requests.slice(0, stack.requests.findIndex((r, i) => i > 0 && r.path === "/v1/subjects/resolve"));
  assert.deepEqual(nvda.slice(0, 2).map((r) => r.path), ["/v1/subjects/resolve", "/v1/fundamentals/stats"]);
  // One period per request (each live lookup downloads SEC company facts), stopping at 8.
  assert.deepEqual(nvda.slice(2).map((r) => r.periods), [
    ["2026-Q4"], ["2026-Q3"], ["2026-Q2"], ["2026-Q1"],
    ["2025-Q4"], ["2025-Q3"], ["2025-Q2"], ["2025-Q1"],
    ["2024-Q4"], ["2024-Q3"], ["2024-Q2"],
  ]);
});

test("the warm-up reports an unresolved ticker or too few quarters, and still warms the others", async () => {
  const stack = fakeStack({ issuers: { NVDA: null }, reported: (period) => period >= "2025-Q1" && period <= "2025-Q4" });
  const failures = await warmGoldenLiveData(BASE, { fetchImpl: stack.fetchImpl, log: () => {} });

  assert.equal(failures.length, 2);
  assert.match(failures[0]!, /NVDA: the resolver found no issuer/);
  assert.match(failures[1]!, /AMD: only 4 of 8 quarterly income statements/);
});

test("the warm-up refuses a stack serving the frozen golden dataset", async () => {
  const stack = fakeStack({ issuers: { NVDA: GOLDEN_COMPANIES[0]!.issuer_id } });
  await assert.rejects(
    () => warmGoldenLiveData(BASE, { fetchImpl: stack.fetchImpl, log: () => {} }),
    /frozen golden dataset/,
  );
  assert.deepEqual(stack.requests.map((r) => r.path), ["/v1/subjects/resolve"], "nothing is read or written past the identity");
});

test("golden:live stops before any turn when the warm-up fails", async () => {
  const requested: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    requested.push(String(input));
    throw new Error("no turn may run");
  };
  try {
    assert.equal(await runGoldenLiveCheck(BASE, { warmup: async () => ["NVDA: not ready"] }), 1);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(requested, []);
});

test("candidate quarters run newest first across the year after the latest annual report", () => {
  assert.deepEqual(candidateQuarters(2025).slice(0, 5), ["2026-Q4", "2026-Q3", "2026-Q2", "2026-Q1", "2025-Q4"]);
  assert.equal(candidateQuarters(2025).length, 12);
});

import assert from "node:assert/strict";
import test from "node:test";

import { createWorkerDeps } from "../src/worker-deps.ts";
import type { DiscoveryRepository, Lease, Providers } from "../src/ports.ts";

test("worker dependencies construct every provider and model with the leased user", () => {
  const seen: string[] = [];
  const providers = Object.freeze({
    search: { search: async () => ({ hits: [], hits_truncated: 0 }) },
    identity: { resolve: async () => ({ status: "unresolved" as const, reason: "unused" }) },
    evidence: { acquire: async () => { throw new Error("unused"); } },
    financials: { read: async () => ({ facts: [], missing_fields: [], coverage_gaps: [] }) },
  }) satisfies Providers;
  const deps = createWorkerDeps({
    repo: {} as DiscoveryRepository,
    clock: () => new Date(),
    providerFactory: {
      search: (user) => { seen.push(`search:${user}`); return providers.search; },
      identity: (user) => { seen.push(`identity:${user}`); return providers.identity; },
      evidence: (user) => { seen.push(`evidence:${user}`); return providers.evidence; },
      financials: (user) => { seen.push(`financials:${user}`); return providers.financials; },
    },
    modelFactory: (user) => { seen.push(`model:${user}`); return { complete: async () => ({ text: "{}", deployment: { channel: "fixture", model: "fixture" } }) }; },
    loadExisting: async () => [],
    persistQuotes: async () => new Map(),
    commitAssessment: async () => ({ decision: {} as never, snapshot_id: "00000000-0000-4000-8000-000000000001" }),
  });
  const lease: Lease = { run_id: "00000000-0000-4000-8000-000000000001", user_id: "00000000-0000-4000-8000-000000000002", worker_id: "fixture", epoch: 1, expires_at: new Date().toISOString() };
  assert.equal(deps.providers(lease).financials, providers.financials);
  void deps.model(lease, {} as never);
  assert.deepEqual(seen, [
    `search:${lease.user_id}`, `identity:${lease.user_id}`, `evidence:${lease.user_id}`, `financials:${lease.user_id}`, `model:${lease.user_id}`,
  ]);
});

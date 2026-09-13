import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createDiscoveryService } from "../src/service.ts";
import { DiscoveryError } from "../src/types.ts";
import { DEFAULT_LIMITS } from "../src/policy.ts";
import { briefFixture } from "./fixtures.ts";

const USER = "10000000-0000-4000-8000-000000000001";
const CAMPAIGN = "20000000-0000-4000-8000-000000000001";

test("draft proposal is metered, remapped, and never saves the brief", async () => {
  const h = draftHarness();
  const service = createDiscoveryService({
    repo: h.repo as never,
    reads: {} as never,
    readiness: () => ({ ready: true, missing: [] }),
    draftPlanner: async () => briefFixture(),
  });

  const proposal = await service.draftBrief(USER, CAMPAIGN, 0);
  assert.equal(proposal.base_version, 0);
  assert.notEqual(proposal.brief.mechanisms[0]?.mechanism_id, briefFixture().mechanisms[0]?.mechanism_id);
  assert.equal(h.calls.reserve, 1);
  assert.equal(h.calls.finish, 1);
  assert.equal(h.calls.release, 1);
  assert.equal(h.calls.save, 0, "a draft remains a proposal until the explicit save endpoint");
  assert.deepEqual(h.calls.phase, ["draft"]);
});

test("draft rechecks expected version after the provider result and returns stale_brief", async () => {
  const h = draftHarness({ changeAfterDraft: true });
  const service = createDiscoveryService({
    repo: h.repo as never,
    reads: {} as never,
    readiness: () => ({ ready: true, missing: [] }),
    draftPlanner: async () => briefFixture(),
  });

  await assert.rejects(service.draftBrief(USER, CAMPAIGN, 0), { code: "stale_brief" });
  assert.equal(h.calls.finish, 1, "the paid provider attempt stays durably metered");
  assert.equal(h.calls.release, 1);
});

test("missing model readiness rejects before acquiring a draft token", async () => {
  const h = draftHarness();
  const service = createDiscoveryService({ repo: h.repo as never, reads: {} as never });
  await assert.rejects(service.draftBrief(USER, CAMPAIGN, 0), (error: unknown) => error instanceof DiscoveryError && error.code === "unavailable");
  assert.equal(h.calls.acquire, 0);
});

test("starting a run snapshots the configured secret-free model identities and limits", async () => {
  let received: unknown;
  const service = createDiscoveryService({
    repo: {
      async startRun(_userId: string, _campaignId: string, input: unknown) {
        received = input;
        return { run_id: "30000000-0000-4000-8000-000000000001" };
      },
    } as never,
    reads: {} as never,
    runConfiguration: () => ({
      model_config: [{ role: "planner", provider: "fixture", model: "brief-drafter", max_output_tokens: 800, as_of: "2026-09-13T00:00:00.000Z" }],
      limits: DEFAULT_LIMITS,
    }),
  });

  await service.startRun(USER, CAMPAIGN, {
    brief_version: 1,
    brief_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    request_key: "40000000-0000-4000-8000-000000000001",
  });

  assert.deepEqual(received, {
    brief_version: 1,
    brief_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    request_key: "40000000-0000-4000-8000-000000000001",
    model_config: [{ role: "planner", provider: "fixture", model: "brief-drafter", max_output_tokens: 800, as_of: "2026-09-13T00:00:00.000Z" }],
    limits: DEFAULT_LIMITS,
  });
  assert.equal(JSON.stringify(received).includes("api_key"), false);
});

function draftHarness(options: { changeAfterDraft?: boolean } = {}) {
  const calls = { acquire: 0, reserve: 0, finish: 0, release: 0, save: 0, phase: [] as string[] };
  const token = randomUUID();
  let briefReads = 0;
  const repo = {
    async getCampaign() { return { campaign_id: CAMPAIGN, user_id: USER }; },
    async currentBrief() {
      briefReads += 1;
      if (options.changeAfterDraft === true && briefReads > 1) return { version: 1, hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", brief: briefFixture() };
      return null;
    },
    async acquireDraft() { calls.acquire += 1; return { draft_token: token, expires_at: "2026-09-10T12:01:30.000Z" }; },
    async releaseDraft() { calls.release += 1; },
    async reserveAttempt(_scope: unknown, input: { phase: string }) {
      calls.reserve += 1; calls.phase.push(input.phase);
      return { attempt_id: randomUUID(), attempt_number: 1 as const, state: "dispatch" as const, result: null };
    },
    async finishAttempt() { calls.finish += 1; },
    async saveBrief() { calls.save += 1; },
  };
  return { repo, calls };
}

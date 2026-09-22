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
    readiness: () => ({ ready: true, missing: [] }),
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

test("starting a run requires every missing provider capability before it reaches the repository", async () => {
  for (const missing of ["model", "search", "reference"] as const) {
    let startRunCalls = 0;
    const service = createDiscoveryService({
      repo: { async startRun() { startRunCalls += 1; throw new Error("must not start"); } } as never,
      reads: {} as never,
      readiness: () => ({ ready: false, missing: [missing] }),
    });

    await assert.rejects(
      service.startRun(USER, CAMPAIGN, { brief_version: 1, brief_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", request_key: "40000000-0000-4000-8000-000000000001" }),
      (error: unknown) => error instanceof DiscoveryError && error.code === "unavailable" && error.message.includes(missing),
    );
    assert.equal(startRunCalls, 0, `${missing} readiness prevents repository run creation`);
  }
});

test("campaign questions and saved briefs remain writable while run readiness is unavailable", async () => {
  let created = 0;
  let saved = 0;
  const service = createDiscoveryService({
    repo: {
      async createCampaign() { created += 1; return { campaign_id: CAMPAIGN }; },
      async saveBrief() { saved += 1; return { brief_id: "brief", campaign_id: CAMPAIGN, version: 1, brief: briefFixture(), hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", approved_at: null, created_at: "2026-09-10T00:00:00.000Z" }; },
    } as never,
    reads: {} as never,
  });

  await service.createCampaign(USER, { name: "Grid", question: "Which US-listed companies benefit from grid modernization spending?" });
  await service.saveBrief(USER, CAMPAIGN, 0, briefFixture());

  assert.equal(created, 1);
  assert.equal(saved, 1);
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

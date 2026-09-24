import assert from "node:assert/strict";
import test from "node:test";

import { assessCompany } from "../src/assessment.ts";
import { buildAssessmentMessages } from "../src/assessment-prompts.ts";
import { citationMapKey } from "../src/assessment-validation.ts";
import type { CampaignModel } from "../src/ports.ts";
import { requestHash } from "../src/scout-support.ts";
import { DiscoveryError } from "../src/types.ts";
import { analystFixture, briefFixture, packetFixture, skepticFixture } from "./fixtures.ts";

test("role prompts give Analyst and Skeptic the same packet without Analyst output", () => {
  const packet = packetFixture();
  const analyst = buildAssessmentMessages({ role: "analyst", brief: briefFixture(), packet, as_of: "2026-09-10T12:00:00Z" });
  const skeptic = buildAssessmentMessages({ role: "skeptic", brief: briefFixture(), packet, as_of: "2026-09-10T12:00:00Z" });

  assert.deepEqual(JSON.parse(analyst[1]!.content), JSON.parse(skeptic[1]!.content));
  assert.equal(JSON.stringify(skeptic).includes("Analyst output"), false);
  assert.ok(JSON.stringify(analyst).length <= 64_000);
  assert.ok(JSON.stringify(skeptic).length <= 64_000);
});

test("assessment validates both independent role results before deciding", async () => {
  const calls: Parameters<CampaignModel["complete"]>[0][] = [];
  const model: CampaignModel = {
    async complete(input) {
      calls.push(input);
      return {
        text: JSON.stringify(input.role === "analyst" ? analystFixture() : skepticFixture()),
        deployment: { channel: "test", model: "structured" },
      };
    },
  };
  const packet = packetFixture();

  const result = await assessCompany({
    run_id: "70000000-0000-4000-8000-000000000001",
    brief: briefFixture(),
    packet,
    model,
    as_of: "2026-09-10T12:00:00Z",
    persistQuotes: async () => new Map(),
    reloadPacket: async () => packet,
    saveValidatedRole: async () => undefined,
    loadValidatedRoles: async () => ({ analyst: null, skeptic: null }),
  });

  assert.equal(result.state, "eligible_not_shortlisted");
  assert.deepEqual(calls.map((call) => call.role), ["analyst", "skeptic"]);
  assert.ok(calls.every((call) => call.candidate_id === packet.candidate_id && call.model_initial === true));
  assert.equal(calls[0]!.request_hash === calls[1]!.request_hash, false);
});

test("assessment repairs one malformed cached role output using the original request identity", async () => {
  const calls: Parameters<CampaignModel["complete"]>[0][] = [];
  const model: CampaignModel = {
    async complete(input) {
      calls.push(input);
      if (input.role === "analyst" && input.attempt_number !== 2) return { text: "{not json", deployment: { channel: "test", model: "structured" } };
      return { text: JSON.stringify(input.role === "analyst" ? analystFixture() : skepticFixture()), deployment: { channel: "test", model: "structured" } };
    },
  };

  await assessCompany({
    run_id: "70000000-0000-4000-8000-000000000001", brief: briefFixture(), packet: packetFixture(), model,
    as_of: "2026-09-10T12:00:00Z", persistQuotes: async () => new Map(), reloadPacket: async () => packetFixture(), saveValidatedRole: async () => undefined, loadValidatedRoles: async () => ({ analyst: null, skeptic: null }),
  });

  assert.equal(calls.length, 3);
  assert.equal(calls[0]!.request_hash, calls[1]!.request_hash);
  assert.equal(calls[1]!.attempt_number, 2);
  assert.equal(calls[1]!.model_initial, false);
});

test("an invalid repair stops after the explicit second attempt", async () => {
  const calls: Parameters<CampaignModel["complete"]>[0][] = [];
  const model: CampaignModel = {
    async complete(input) {
      calls.push(input);
      return { text: "{not json", deployment: { channel: "test", model: "structured" } };
    },
  };

  await assert.rejects(
    assessCompany({
      run_id: "70000000-0000-4000-8000-000000000001", brief: briefFixture(), packet: packetFixture(), model,
      as_of: "2026-09-10T12:00:00Z", persistQuotes: async () => new Map(), reloadPacket: async () => packetFixture(), saveValidatedRole: async () => undefined, loadValidatedRoles: async () => ({ analyst: null, skeptic: null }),
    }),
    /not valid JSON/i,
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.request_hash, calls[1]!.request_hash);
  assert.equal(calls[1]!.attempt_number, 2);
});

test("control errors propagate without repair or fallback", async () => {
  const calls: Parameters<CampaignModel["complete"]>[0][] = [];
  const model: CampaignModel = {
    async complete(input) {
      calls.push(input);
      throw new DiscoveryError("operation_in_progress", "assessment is already in progress");
    },
  };

  await assert.rejects(
    assessCompany({
      run_id: "70000000-0000-4000-8000-000000000001", brief: briefFixture(), packet: packetFixture(), model,
      as_of: "2026-09-10T12:00:00Z", persistQuotes: async () => new Map(), reloadPacket: async () => packetFixture(), saveValidatedRole: async () => undefined, loadValidatedRoles: async () => ({ analyst: null, skeptic: null }),
    }),
    { code: "operation_in_progress" },
  );
  assert.equal(calls.length, 1);
});

test("reloaded evidence is revalidated before saving normalized role checkpoints", async () => {
  const packet = packetFixture();
  let saved = 0;
  let persisted = 0;
  const model: CampaignModel = {
    async complete(input) {
      return { text: JSON.stringify(input.role === "analyst" ? analystFixture() : skepticFixture()), deployment: { channel: "test", model: "structured" } };
    },
  };

  await assert.rejects(
    assessCompany({
      run_id: "70000000-0000-4000-8000-000000000001", brief: briefFixture(), packet, model,
      as_of: "2026-09-10T12:00:00Z", persistQuotes: async () => { persisted += 1; return new Map(); },
      reloadPacket: async () => ({ ...packet, claims: [] }), saveValidatedRole: async () => { saved += 1; }, loadValidatedRoles: async () => ({ analyst: null, skeptic: null }),
    }),
    /outside the supplied packet/i,
  );
  assert.equal(saved, 0);
  assert.equal(persisted, 0);
});

test("a persisted Analyst checkpoint resumes the missing Skeptic with its original request identity", async () => {
  const packet = packetFixture();
  const reloadedPacket = { ...packet, coverage_gaps: ["reloaded-after-model-call"] };
  const saved: unknown[] = [];
  const firstCalls: Parameters<CampaignModel["complete"]>[0][] = [];
  const persisted: Array<{ request_hash: string; operation_key: string }> = [];
  const quote = packet.excerpts[0]!.text;
  const analyst = analystFixture();
  analyst.exposure.citations = [{ kind: "excerpt", id: packet.excerpts[0]!.excerpt_id, quote }];
  analyst.criteria[0]!.citations = [{ kind: "excerpt", id: packet.excerpts[0]!.excerpt_id, quote }];
  const initialModel: CampaignModel = {
    async complete(input) {
      firstCalls.push(input);
      if (input.role === "skeptic") throw new DiscoveryError("operation_in_progress", "Skeptic attempt is still in progress");
      return { text: JSON.stringify(analyst), deployment: { channel: "test", model: "structured" } };
    },
  };

  await assert.rejects(
    assessCompany({
      run_id: "70000000-0000-4000-8000-000000000001", brief: briefFixture(), packet, model: initialModel,
      as_of: "2026-09-10T12:00:00Z",
      persistQuotes: async (_raw, _visiblePacket, request) => {
        persisted.push(request);
        return new Map([[citationMapKey({ kind: "excerpt", id: packet.excerpts[0]!.excerpt_id, quote }), { kind: "claim" as const, id: packet.claims[0]!.claim_id }]]);
      },
      reloadPacket: async () => reloadedPacket,
      saveValidatedRole: async (checkpoint) => { saved.push(checkpoint); },
      loadValidatedRoles: async () => ({ analyst: null, skeptic: null }),
    }),
    { code: "operation_in_progress" },
  );

  assert.equal(saved.length, 1, "a valid normalized Analyst checkpoint survives a nonterminal Skeptic failure");
  const analystCheckpoint = saved[0] as {
    role: string; request_hash: string; request_packet_hash: string; packet_hash: string;
    output: { exposure: { citations: Array<{ kind: string; id: string }> } };
  };
  assert.equal(analystCheckpoint.role, "analyst");
  assert.equal(analystCheckpoint.request_hash, firstCalls[0]!.request_hash);
  assert.equal(analystCheckpoint.request_packet_hash, requestHash(packet));
  assert.equal(analystCheckpoint.packet_hash, requestHash(reloadedPacket));
  assert.deepEqual(analystCheckpoint.output.exposure.citations, [{ kind: "claim", id: packet.claims[0]!.claim_id }]);
  assert.deepEqual(persisted, [{
    role: "analyst",
    request_hash: firstCalls[0]!.request_hash,
    operation_key: firstCalls[0]!.operation_key,
    request_packet_hash: requestHash(packet),
  }]);

  const resumedCalls: Parameters<CampaignModel["complete"]>[0][] = [];
  const resumedModel: CampaignModel = {
    async complete(input) {
      resumedCalls.push(input);
      if (input.role === "analyst") throw new Error("resume must not invoke the Analyst model");
      return { text: JSON.stringify(skepticFixture()), deployment: { channel: "test", model: "structured" } };
    },
  };
  const result = await assessCompany({
    run_id: "70000000-0000-4000-8000-000000000001", brief: briefFixture(), packet, model: resumedModel,
    as_of: "2026-09-10T12:00:00Z", persistQuotes: async () => new Map(), reloadPacket: async () => reloadedPacket,
    saveValidatedRole: async (checkpoint) => { saved.push(checkpoint); },
    loadValidatedRoles: async () => ({ analyst: analystCheckpoint as never, skeptic: null }),
  });

  assert.equal(result.state, "eligible_not_shortlisted");
  assert.deepEqual(resumedCalls.map((call) => call.role), ["skeptic"]);
  assert.equal(resumedCalls[0]!.request_hash, firstCalls[1]!.request_hash);
  assert.deepEqual(resumedCalls[0]!.messages, firstCalls[1]!.messages);
});

test("a resumed checkpoint cannot authorize a claim that fresh evidence revoked", async () => {
  const packet = packetFixture();
  const analyst = analystFixture();
  const saved: unknown[] = [];
  const initialModel: CampaignModel = {
    async complete(input) {
      if (input.role === "skeptic") throw new DiscoveryError("operation_in_progress", "Skeptic attempt is still in progress");
      return { text: JSON.stringify(analyst), deployment: { channel: "test", model: "structured" } };
    },
  };
  await assert.rejects(
    assessCompany({
      run_id: "70000000-0000-4000-8000-000000000001", brief: briefFixture(), packet, model: initialModel,
      as_of: "2026-09-10T12:00:00Z", persistQuotes: async () => new Map(), reloadPacket: async () => packet,
      saveValidatedRole: async (checkpoint) => { saved.push(checkpoint); }, loadValidatedRoles: async () => ({ analyst: null, skeptic: null }),
    }),
    { code: "operation_in_progress" },
  );
  const calls: Parameters<CampaignModel["complete"]>[0][] = [];
  await assert.rejects(
    assessCompany({
      run_id: "70000000-0000-4000-8000-000000000001", brief: briefFixture(), packet,
      model: { async complete(input) { calls.push(input); return { text: JSON.stringify(skepticFixture()), deployment: { channel: "test", model: "structured" } }; } },
      as_of: "2026-09-10T12:00:00Z", persistQuotes: async () => new Map(), reloadPacket: async () => ({ ...packet, claims: [] }),
      saveValidatedRole: async () => undefined,
      loadValidatedRoles: async () => ({ analyst: saved[0] as never, skeptic: null }),
    }),
    /outside the supplied packet/i,
  );
  assert.deepEqual(calls, [], "the saved checkpoint is revalidated before any missing role can be dispatched");
});

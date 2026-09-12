import assert from "node:assert/strict";
import test from "node:test";

import { assessCompany } from "../src/assessment.ts";
import { buildAssessmentMessages } from "../src/assessment-prompts.ts";
import type { CampaignModel } from "../src/ports.ts";
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
    as_of: "2026-09-10T12:00:00Z", persistQuotes: async () => new Map(), reloadPacket: async () => packetFixture(), saveValidatedRole: async () => undefined,
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
      as_of: "2026-09-10T12:00:00Z", persistQuotes: async () => new Map(), reloadPacket: async () => packetFixture(), saveValidatedRole: async () => undefined,
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
      as_of: "2026-09-10T12:00:00Z", persistQuotes: async () => new Map(), reloadPacket: async () => packetFixture(), saveValidatedRole: async () => undefined,
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
      reloadPacket: async () => ({ ...packet, claims: [] }), saveValidatedRole: async () => { saved += 1; },
    }),
    /outside the supplied packet/i,
  );
  assert.equal(saved, 0);
  assert.equal(persisted, 0);
});

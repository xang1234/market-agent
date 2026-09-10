import assert from "node:assert/strict";
import test from "node:test";

import { parseLlmEnv } from "../../llm/src/channel-config.ts";
import { createLlmRouter } from "../../llm/src/router.ts";
import { createCampaignModel } from "../src/model.ts";
import { fakeOperations } from "./fake-operations.ts";

test("campaign model rejects oversized input before reserving a model attempt", async () => {
  const fake = fakeOperations();
  const router = createLlmRouter({
    settings: settings(),
    client: async () => ({ text: "unexpected" }),
  });
  const model = createCampaignModel(router, fake.operations);

  await assert.rejects(
    model.complete({
      operation_key: "00000000-0000-4000-8000-000000000001/discovery/pool/planner",
      request_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      role: "planner",
      phase: "discovery",
      messages: [{ role: "user", content: "x".repeat(64_000) }],
    }),
    { code: "validation" },
  );
  assert.equal(fake.providerAttempts.length, 0);
});

test("campaign model preserves the approved 10,000-token provider ceiling", async () => {
  const fake = fakeOperations();
  let maxTokens: number | undefined;
  const router = createLlmRouter({
    settings: settings(),
    client: async (_deployment, request) => {
      maxTokens = request.maxTokens;
      return { text: "bounded" };
    },
  });
  const model = createCampaignModel(router, fake.operations);

  const result = await model.complete({
    operation_key: "00000000-0000-4000-8000-000000000001/discovery/pool/planner",
    request_hash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    role: "planner",
    phase: "discovery",
    messages: [{ role: "user", content: "Plan the bounded campaign." }],
  });

  assert.equal(result.text, "bounded");
  assert.equal(maxTokens, 10_000);
});

test("campaign model charges each router fallback as a distinct provider attempt", async () => {
  const fake = fakeOperations();
  const dispatched: string[] = [];
  const router = createLlmRouter({
    settings: settings(),
    client: async (deployment) => {
      dispatched.push(deployment.model);
      if (dispatched.length === 1) throw new Error("transient");
      return { text: "fallback" };
    },
  });
  const model = createCampaignModel(router, fake.operations);

  const result = await model.complete({
    operation_key: "00000000-0000-4000-8000-000000000001/discovery/pool/planner",
    request_hash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    role: "planner",
    phase: "discovery",
    messages: [{ role: "user", content: "Plan the bounded campaign." }],
  });

  assert.equal(result.text, "fallback");
  assert.deepEqual(dispatched, ["gpt-4.1", "deepseek-chat"]);
  assert.deepEqual(fake.providerAttempts.map((attempt) => attempt.index), [0, 1]);
});

test("campaign model uses only the explicit second attempt for a repair with the original request hash", async () => {
  const fake = fakeOperations();
  const seenMessages: string[] = [];
  const router = createLlmRouter({
    settings: settings(),
    client: async (_deployment, request) => {
      seenMessages.push(request.messages[0]!.content);
      return { text: `response-${seenMessages.length}` };
    },
  });
  const model = createCampaignModel(router, fake.operations);
  const request_hash = "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
  const operation_key = "00000000-0000-4000-8000-000000000001/research/00000000-0000-4000-8000-000000000002/analyst";

  await model.complete({
    operation_key,
    request_hash,
    role: "analyst",
    phase: "research",
    candidate_id: "00000000-0000-4000-8000-000000000002",
    model_initial: true,
    messages: [{ role: "user", content: "Original structured analysis." }],
  });
  const repair = await model.complete({
    operation_key,
    request_hash,
    attempt_number: 2,
    role: "analyst",
    phase: "research",
    candidate_id: "00000000-0000-4000-8000-000000000002",
    messages: [{ role: "user", content: "Repair the malformed response." }],
  });

  assert.equal(repair.text, "response-2");
  assert.deepEqual(seenMessages, ["Original structured analysis.", "Repair the malformed response."]);
  assert.deepEqual(fake.providerAttempts.map((attempt) => ({ index: attempt.index, request_hash: attempt.request_hash })), [
    { index: 0, request_hash },
    { index: 1, request_hash },
  ]);
});

test("campaign model requires initial analyst and skeptic calls to reserve their protected slot", async () => {
  const fake = fakeOperations();
  const model = createCampaignModel(createLlmRouter({
    settings: settings(),
    client: async () => ({ text: "unexpected" }),
  }), fake.operations);

  await assert.rejects(
    model.complete({
      operation_key: "00000000-0000-4000-8000-000000000001/research/00000000-0000-4000-8000-000000000002/analyst",
      request_hash: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      role: "analyst",
      phase: "research",
      candidate_id: "00000000-0000-4000-8000-000000000002",
      messages: [{ role: "user", content: "Assess this candidate." }],
    }),
    { code: "validation" },
  );
  assert.equal(fake.providerAttempts.length, 0);
});

test("campaign model identifies the protected analyst role at reservation", async () => {
  const fake = fakeOperations();
  const model = createCampaignModel(createLlmRouter({
    settings: settings(),
    client: async () => ({ text: "analysis" }),
  }), fake.operations);
  const operation_key = "00000000-0000-4000-8000-000000000001/research/00000000-0000-4000-8000-000000000002/analyst";

  await model.complete({
    operation_key,
    request_hash: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    role: "analyst",
    phase: "research",
    candidate_id: "00000000-0000-4000-8000-000000000002",
    model_initial: true,
    messages: [{ role: "user", content: "Assess this candidate." }],
  });

  assert.deepEqual(fake.providerReservations, [{
    key: operation_key,
    index: 0,
    model_initial: true,
    model_role: "analyst",
  }]);
});

function settings() {
  return parseLlmEnv({
    LLM_CHANNELS: "openai,deepseek",
    LLM_OPENAI_PROTOCOL: "openai",
    LLM_OPENAI_API_KEY: "sk-openai",
    LLM_OPENAI_MODELS: "gpt-4.1",
    LLM_DEEPSEEK_PROTOCOL: "openai-compatible",
    LLM_DEEPSEEK_BASE_URL: "https://api.deepseek.com/v1",
    LLM_DEEPSEEK_API_KEY: "ds-key",
    LLM_DEEPSEEK_MODELS: "deepseek-chat",
    LITELLM_MODEL: "openai/gpt-4.1",
    LITELLM_FALLBACK_MODELS: "deepseek/deepseek-chat",
  });
}

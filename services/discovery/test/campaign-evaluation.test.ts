import assert from "node:assert/strict";
import test from "node:test";

import { createCampaignModel } from "../src/model.ts";
import { validateAnalystOutput } from "../src/assessment-validation.ts";
import { validateModelRequest } from "../src/validation.ts";
import { uniqueLeads } from "../src/scout-leads.ts";
import { rankShortlist } from "../src/selection.ts";
import { createOperationRunner } from "../src/operations.ts";
import { DEFAULT_LIMITS } from "../src/policy.ts";
import type { CandidateDecision, DiscoveredCandidate } from "../src/types.ts";
import { dbOptions } from "./db-fixture.ts";
import { analystFixture, briefFixture, identityFixture, packetFixture } from "./fixtures.ts";
import { createRunnerHarness } from "./runner-harness.ts";

test("model requests accept the exact 64,000-character and 10,000-token boundaries", () => {
  const messages = messagesAtSerializedLength(64_000);
  assert.equal(JSON.stringify(messages).length, 64_000);
  assert.doesNotThrow(() => validateModelRequest(messages, 10_000));
  assert.throws(() => validateModelRequest(messagesAtSerializedLength(64_001), 10_000), /64000 input characters/);
  assert.throws(() => validateModelRequest(messages, 10_001), /between 1 and 10000/);
});

test("campaign model shares one two-attempt ledger between fallback and repair", async () => {
  const reserved: number[] = [];
  const router = {
    async complete(_request: unknown, controls: { maxAttempts?: number; executeAttempt?: Function }) {
      assert.equal(controls.maxAttempts, 2);
      try {
        return await controls.executeAttempt!({ index: 0 }, async () => { throw new Error("first transport failed"); });
      } catch {
        return controls.executeAttempt!({ index: 1 }, async () => ({ text: "{}" }));
      }
    },
  };
  const model = createCampaignModel(router as never, {
    async providerAttempt(input: { index: 0 | 1; execute: (signal: AbortSignal) => Promise<unknown> }) {
      reserved.push(input.index);
      return input.execute(new AbortController().signal);
    },
  } as never);

  const result = await model.complete({ operation_key: "run/candidate/analyst", request_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", role: "analyst", phase: "research", candidate_id: "90000000-0000-4000-8000-000000000001", model_initial: true, messages: [{ role: "user", content: "fixture" }] });
  assert.equal(result.text, "{}");
  assert.deepEqual(reserved, [0, 1]);
});

test("large malformed model output and fabricated citations are rejected before any acceptance path", () => {
  const packet = packetFixture();
  assert.throws(() => validateAnalystOutput("x".repeat(100_001), briefFixture(), packet), /response size limit/);

  const fabricated = analystFixture();
  fabricated.exposure.citations = [{ kind: "excerpt", id: packet.excerpts[0]!.excerpt_id, quote: "Invented evidence that does not occur in the source document." }];
  assert.throws(() => validateAnalystOutput(fabricated, briefFixture(), packet), /quote does not match/);
});

test("duplicate source leads remain one candidate and ranking is stable across input order", () => {
  const identity = identityFixture();
  const lead: DiscoveredCandidate = {
    candidate_id: "90000000-0000-4000-8000-000000000001", lead_key: "source:https://fixture.example.test/one", name: identity.legal_name,
    identity, origins: ["web"], mechanism_ids: [briefFixture().mechanisms[0]!.mechanism_id], seed: false, primary_domain_lead: true,
    first_seen: [0, 0], lead_hit_ids: ["70000000-0000-4000-8000-000000000001"], reason_codes: ["fixture"],
  };
  const merged = uniqueLeads([
    { ...lead, identity_query: identity.ticker, canonical_identity: identity },
    { ...lead, reason_codes: ["duplicate_document"], identity_query: identity.ticker, canonical_identity: identity },
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0]!.reason_codes.sort(), ["duplicate_document", "fixture"]);

  const first = decision("80000000-0000-4000-8000-000000000002");
  const second = decision("80000000-0000-4000-8000-000000000001");
  const ranks = [rankShortlist([first, second]), rankShortlist([second, first])];
  assert.deepEqual(ranks[0].map((item) => [item.identity.issuer_id, item.rank]), ranks[1].map((item) => [item.identity.issuer_id, item.rank]));
  assert.deepEqual(ranks[0].map((item) => item.rank), [1, 2]);
});

test("real worker records partial work, resumes a fenced lease, and honors cancellation", dbOptions, async (t) => {
  const partial = await createRunnerHarness(t, { failOnceAt: "reservation" });
  await partial.executeOnce();
  assert.equal((await partial.repo.readRun(partial.userId, partial.runId)).status, "partial");

  const resumed = await createRunnerHarness(t, { crashAfter: "candidate_commit" });
  await assert.rejects(resumed.executeOnce(), /injected crash/);
  resumed.advanceClock(91_000);
  await resumed.resumeWithWorker("task10-replacement");
  assert.equal((await resumed.repo.readRun(resumed.userId, resumed.runId)).status, "completed");

  const cancelled = await createRunnerHarness(t, { cancelDuring: "research" });
  await cancelled.executeOnce();
  assert.equal((await cancelled.repo.readRun(cancelled.userId, cancelled.runId)).status, "cancelled");
});

test("a controllable slow transport is aborted per attempt and production keeps the 30-second cap", async () => {
  const finished: Array<{ outcome: string; name: string }> = [];
  let reservations = 0;
  const runner = createOperationRunner({
    async readRun() { return { limits: { ...DEFAULT_LIMITS, request_timeout_ms: 2 } }; },
    async reserveAttempt() {
      reservations += 1;
      return { state: "dispatch", attempt_id: `00000000-0000-4000-8000-00000000000${reservations}`, attempt_number: reservations as 1 | 2, result: null };
    },
    async finishAttempt(_scope, input) { finished.push({ outcome: input.outcome, name: (input.result as { name?: string }).name ?? "unknown" }); },
  } as never, {
    run_id: "30000000-0000-4000-8000-000000000001", user_id: "10000000-0000-4000-8000-000000000001", worker_id: "task10", epoch: 1, expires_at: "2026-09-10T00:00:00.000Z",
  }, new AbortController().signal);

  await assert.rejects(
    runner.run({
      key: "30000000-0000-4000-8000-000000000001/research/pool/slow-fixture",
      request_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      resource: "search",
      phase: "research",
      execute: ({ signal }) => new Promise<never>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })),
    }),
    (error: unknown) => error instanceof DOMException && error.name === "TimeoutError",
  );
  assert.equal(DEFAULT_LIMITS.request_timeout_ms, 30_000);
  assert.equal(reservations, 2);
  assert.deepEqual(finished, [{ outcome: "error", name: "TimeoutError" }, { outcome: "error", name: "TimeoutError" }]);
});

function messagesAtSerializedLength(length: number) {
  const base = JSON.stringify([{ role: "user", content: "" }]).length;
  return [{ role: "user" as const, content: "x".repeat(length - base) }];
}

function decision(issuer_id: string): CandidateDecision {
  const identity = { ...identityFixture(), issuer_id, listing_id: issuer_id.replace("800", "810"), identity_source_ids: [] };
  const unknown = { level: "unknown" as const, explanation: "No additional evidence is available.", citations: [] };
  return {
    candidate_id: issuer_id.replace("800", "900"), identity, state: "eligible_not_shortlisted",
    dimensions: { theme_exposure: { level: "strong", explanation: "Primary evidence supports exposure.", citations: [] }, evidence_strength: unknown, business_quality: unknown, valuation_context: unknown },
    criteria: [], counterarguments: [], unresolved_questions: [], next_action: "Review the next disclosure.", reason_codes: [],
  };
}

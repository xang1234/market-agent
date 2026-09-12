import assert from "node:assert/strict";
import test from "node:test";

import { dbOptions } from "./db-fixture.ts";
import { IDS, createRunnerHarness } from "./runner-harness.ts";

test("restart reuses committed company output and fences the old worker", dbOptions, async (t) => {
  const h = await createRunnerHarness(t, { crashAfter: "candidate_commit" });
  await assert.rejects(h.executeOnce(), /injected crash/);
  const committedCandidateId = (await h.selectedCandidateIds())[0];
  assert.ok(committedCandidateId);
  const callsBefore = h.callsForCompany(IDS.issuer);
  h.advanceClock(91_000);
  await h.resumeWithWorker("replacement");
  assert.equal(h.callsForCompany(IDS.issuer), callsBefore);
  await assert.rejects(h.commitUsingOldLease(), { code: "lease_lost" });
  assert.equal((await h.repo.readRun(h.userId, h.runId)).status, "completed");
  assert.equal(await h.snapshotCountForIssuer(IDS.issuer), 1);
  const events = await h.events();
  assert.equal(events.filter((event) => event.kind === "criterion_assessed" && event.candidate_id === committedCandidateId).length, 1);
  assert.equal(events.filter((event) => event.kind === "criterion_assessed").length, 2);
  assert.ok(events.every((event, index) => index === 0 || event.sequence > events[index - 1]!.sequence));
  await h.assertCountersReconcile();
});

test("restart after cohort commit retains exactly one cohort event", dbOptions, async (t) => {
  const h = await createRunnerHarness(t, { crashAfter: "cohort_commit" });
  await assert.rejects(h.executeOnce(), /injected crash/);
  h.advanceClock(91_000);
  await h.resumeWithWorker("replacement");
  const events = await h.events();
  assert.equal(events.filter((event) => event.kind === "lead_resolved").length, 1);
  assert.ok(events.every((event, index) => index === 0 || event.sequence > events[index - 1]!.sequence));
});

test("restart retains the immutable Analyst packet and dispatches only the missing Skeptic role", dbOptions, async (t) => {
  const h = await createRunnerHarness(t, { crashAfter: "analyst_checkpoint" });
  await assert.rejects(h.executeOnce(), /injected crash/);
  const analyst = h.requestFor("analyst");
  h.advanceClock(91_000);
  await h.resumeWithWorker("replacement");
  assert.equal(h.callsForCompanyRole(IDS.issuer, "analyst"), 1);
  assert.equal(h.callsForCompanyRole(IDS.issuer, "skeptic"), 1);
  assert.deepEqual(h.requestFor("analyst"), analyst);
  assert.equal((await h.repo.readRun(h.userId, h.runId)).status, "completed");
  await h.assertCountersReconcile();
});

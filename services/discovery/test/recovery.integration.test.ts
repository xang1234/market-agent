import assert from "node:assert/strict";
import test from "node:test";

import { dbOptions } from "./db-fixture.ts";
import { IDS, createRunnerHarness } from "./runner-harness.ts";

test("restart reuses committed company output and fences the old worker", dbOptions, async (t) => {
  const h = await createRunnerHarness(t, { crashAfter: "candidate_commit" });
  await assert.rejects(h.executeOnce(), /injected crash/);
  const callsBefore = h.callsForCompany(IDS.issuer);
  h.advanceClock(91_000);
  await h.resumeWithWorker("replacement");
  assert.equal(h.callsForCompany(IDS.issuer), callsBefore);
  await assert.rejects(h.commitUsingOldLease(), { code: "lease_lost" });
  assert.equal((await h.repo.readRun(h.userId, h.runId)).status, "completed");
  assert.equal(await h.snapshotCountForIssuer(IDS.issuer), 1);
  await h.assertCountersReconcile();
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

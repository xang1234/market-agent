// A thread whose answer named an issuer that repair:issuer-splits later merged away (#705).

import assert from "node:assert/strict";
import test from "node:test";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import { issuerLabels as evidenceIssuerLabels } from "../../evidence/src/local-runtime-evidence.ts";
import { issuerLabels } from "../../financial-engine/src/request.ts";
import { IDS } from "../../financial-engine/test/db-fixtures.ts";
import { mergeIssuerAway } from "../../fundamentals/test/issuer-merge-fixture.ts";
import { companyListings } from "../src/perf-block.ts";
import { loadPriorScope, loadPriorSubjects } from "../src/thread-context.ts";
import { chatDatabase, chatHarness, completed, LISTING_A, revenueModel, seedListingA } from "./financial-fixtures.ts";

test("a thread scoped to an issuer since merged away carries the kept issuer forward (#705)", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for a merged issuer's thread");
    return;
  }
  const { db, pool, threadId } = await chatDatabase(t, "chat-merged-issuer");
  await seedListingA(db);
  completed((await chatHarness(pool, { model: revenueModel(["AAA"]) }).run({ threadId, userId: IDS.owner, userIntent: "What was AAA's revenue?" })).events);
  const kept = await mergeIssuerAway(pool, IDS.issuerA, "Alpha Holdings Corp.");

  const subjects = await loadPriorSubjects(pool, { threadId });
  assert.deepEqual(subjects.map((subject) => [subject.subject_ref, subject.input_text]), [[{ kind: "issuer", id: kept }, "ALPX"]]);
  assert.deepEqual((await loadPriorScope(pool, { threadId }))?.companies.map((company) => company.issuer_id), [kept]);

  // Labels and listings read for a saved issuer id are the kept issuer's, under that id.
  const asOf = new Date().toISOString();
  assert.deepEqual([...await issuerLabels(pool, [IDS.issuerA])], [[IDS.issuerA, "Alpha Holdings Corp."]]);
  assert.deepEqual(await evidenceIssuerLabels(pool, [IDS.issuerA], asOf), [{ issuer_id: IDS.issuerA, label: "ALPX" }]);
  assert.deepEqual([...await companyListings(pool, [IDS.issuerA], asOf)], [[IDS.issuerA, { listing_id: LISTING_A, label: "ALPX" }]]);
});

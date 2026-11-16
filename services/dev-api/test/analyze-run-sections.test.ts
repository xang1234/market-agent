import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { ANALYZE_PLAYBOOKS } from "../../analyze/src/playbook.ts";
import { primaryIssuerRef, runAnalyzeWorkflow } from "../src/local-runtime.ts";

test("primaryIssuerRef returns the issuer ref when the run has an issuer subject", () => {
  assert.deepEqual(
    primaryIssuerRef([
      { kind: "listing", id: "11111111-1111-4111-a111-111111111111" },
      { kind: "issuer", id: "22222222-2222-4222-a222-222222222222" },
    ]),
    { kind: "issuer", id: "22222222-2222-4222-a222-222222222222" },
  );
});

test("primaryIssuerRef returns null when no subject resolves to an issuer", () => {
  assert.equal(
    primaryIssuerRef([{ kind: "listing", id: "11111111-1111-4111-a111-111111111111" }]),
    null,
  );
  assert.equal(primaryIssuerRef([]), null);
});

test("the runtime module's Analyze workflow is the analyst agent's, which writes no playbook prompt into a run", async () => {
  const { blocks } = await runAnalyzeWorkflow({
    userId: randomUUID(), template: { template_id: randomUUID(), version: 1 } as never, body: {}, runId: randomUUID(), snapshotId: randomUUID(), instructions: "Review",
    playbook: ANALYZE_PLAYBOOKS.find((candidate) => candidate.playbook_id === "earnings_quality")!, sourceCategories: ["filings"], bundleIds: [],
    subjectRefs: [{ kind: "issuer", id: randomUUID() }],
  });
  assert.deepEqual(blocks.map((block) => block.segments), [[{ type: "text", text: "The analyst agent writes no section of this playbook yet; it writes the Investment memo's narrative sections." }]]);
});

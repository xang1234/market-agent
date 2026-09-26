import assert from "node:assert/strict";
import test from "node:test";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import { evaluateSavedRule } from "../../financial-engine/src/saved-rule.ts";
import { createRuntimeAuthority } from "../../financial-core/src/index.ts";
import { createEvidenceFinancialPort } from "../../financial-engine/src/evidence-adapter.ts";
import { listRecoverableRuns } from "../../financial-engine/src/recovery.ts";
import { IDS } from "../../financial-engine/test/db-fixtures.ts";
import { CUTOFF, financialCampaign, MARGIN_ID, REVENUE_ID } from "./financial-fixtures.ts";

test("discovery numerical criteria execution", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for discovery financial coverage");
    return;
  }
  const { db, pool, lease, brief, evaluate, certificates } = await financialCampaign(t, "discovery-fin-exec");
  const computations = async () => Number((await db.query(`select count(*)::int as n from computations c join financial_runs r on r.run_id = c.financial_run_id where r.parent_id = $1`, [lease.run_id])).rows[0].n);

  await t.test("each criterion is a certified calculation under the campaign run", async () => {
    const outcomes = await evaluate();
    assert.deepEqual([...outcomes.values()].map((outcome) => [outcome.criterion_id, outcome.outcome]), [[REVENUE_ID, "pass"], [MARGIN_ID, "fail"]]);
    for (const outcome of outcomes.values()) {
      assert.ok(outcome.certified?.certificate_digest && outcome.certified.snapshot_id);
      assert.deepEqual(outcome.citations, []);
    }
    assert.equal(await certificates(), 2);
    const runs = (await db.query(`select parent_kind, parent_version, request_key from financial_runs where parent_id = $1 order by request_key`, [lease.run_id])).rows;
    assert.ok(runs.every((run) => run.parent_kind === "discovery_run" && run.parent_version.startsWith(`brief-v${brief.version}:`)));
    const attribution = (await db.query(`select p.plan->'thresholds'->0->'attribution' as a from financial_plans p join financial_runs r on r.plan_id = p.plan_id where r.parent_id = $1 limit 1`, [lease.run_id])).rows[0].a;
    assert.equal(attribution.kind, "approved_discovery_brief");
  });

  await t.test("a resumed candidate reuses its calculations", async () => {
    const [before, count] = [await computations(), await certificates()];
    const again = await evaluate();
    assert.deepEqual([...again.values()].map((outcome) => outcome.outcome), ["pass", "fail"]);
    assert.deepEqual([await computations(), await certificates()], [before, count]);
  });

  await t.test("a calculation parented by the campaign run cannot be leased without the campaign's fence", async () => {
    const outcome = await evaluateSavedRule({ pool, evidence: createEvidenceFinancialPort }, {
      authority: createRuntimeAuthority({
        owner_user_id: IDS.owner, egress_channel: "discovery",
        parent: { kind: "discovery_run", id: lease.run_id, version: "brief:unfenced" },
        allowed_source_classes: ["sec_filing"], feature: { surface: "discovery", capability: "financial-criterion", mode: "enforce" },
        approval_state: "approved", lease: null,
      }),
      request_key: "unfenced", subject: { kind: "issuer", id: IDS.issuerA },
      rule: brief.brief.criteria[1]!.metric!, as_of: CUTOFF, reporting_basis: "as_restated",
      origin: { kind: "discovery_criterion", ref: "unfenced" }, threshold_attribution: { kind: "approved_discovery_brief", ref: "unfenced" },
      publication_unit_kind: "discovery_assessment", persistParent: async () => {},
    });
    assert.deepEqual([outcome.status, outcome.reason_code], ["unresolved", "parent_authority_required"]);
  });

  await t.test("the recovery supervisor never resumes a campaign's calculations", async () => {
    // Every campaign calculation above released its lease, so each would otherwise be eligible.
    const recoverable = await listRecoverableRuns(db, { parent_kinds: ["discovery_run"], limit: 50 });
    assert.ok(!recoverable.some((run) => run.parent_id === lease.run_id));
  });
});

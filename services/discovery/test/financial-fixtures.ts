// Shared harness for Discovery's numerical criteria: a real engine database,
// an approved brief with numerical criteria, a running campaign under a
// worker lease, and one candidate (the seeded issuer) being researched.

import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import { connectedPool } from "../../../db/test/docker-pg.ts";
import type { ThesisMetricCheck } from "../../agents/src/thesis-types.ts";
import { createEvidenceFinancialPort } from "../../financial-engine/src/evidence-adapter.ts";
import { databaseUrl, engineDatabase, IDS } from "../../financial-engine/test/db-fixtures.ts";
import { createFinancialCriteriaEvaluator } from "../src/financial-execution.ts";
import type { Lease } from "../src/ports.ts";
import { createDiscoveryRepository } from "../src/repository.ts";
import type { Brief, CompanyIdentity, Criterion } from "../src/types.ts";
import { briefFixture } from "./fixtures.ts";

/** After both fixture filings are public; as-reported revenue is the original FY2023 disclosure. */
export const CUTOFF = "2024-03-01T00:00:00.000Z";
export const NARRATIVE_ID = briefFixture().criteria[0]!.criterion_id;
export const REVENUE_ID = "50000000-0000-4000-8000-0000000000a1";
export const MARGIN_ID = "50000000-0000-4000-8000-0000000000a2";

export const ALPHA: CompanyIdentity = {
  issuer_id: IDS.issuerA, listing_id: "81000000-0000-4000-8000-0000000000a1", legal_name: "Alpha Industries Inc.",
  ticker: "ALPH", mic: "XNAS", currency: "USD", asset_type: "common_stock", identity_source_ids: [],
};

const metric = (metric_key: string, operator: ThesisMetricCheck["operator"], threshold: string): ThesisMetricCheck =>
  ({ metric_key, unit: "currency", period_kind: "fiscal_y", operator, threshold, max_age_days: 730 });

/** The fixture brief plus two approved numerical criteria: revenue above 1 (mandatory), gross profit below 1 (preferred). */
export function numericalBrief(): Brief {
  const base = briefFixture();
  const criteria: Criterion[] = [
    ...base.criteria,
    { criterion_id: REVENUE_ID, importance: "must", statement: "Annual revenue is above the approved floor.", falsifier: "Annual revenue is at or below the approved floor.", metric: metric("revenue", "gt", "1") },
    { criterion_id: MARGIN_ID, importance: "prefer", statement: "Annual gross profit is below the approved cap.", falsifier: "Annual gross profit is at or above the approved cap.", metric: metric("gross_profit", "lt", "1") },
  ];
  return { ...base, criteria };
}

export async function financialCampaign(t: TestContext, prefix: string) {
  const db = await engineDatabase(t, prefix);
  return setupFinancialCampaign(db, await connectedPool(t, databaseUrl(db), { max: 8 }));
}

/** The campaign, lease, and candidate on an existing engine database (shared with other surfaces in parity tests). */
/** Only queries are run on it; structural, so any pg client type fits. */
type Queryable = { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> };

export async function setupFinancialCampaign<P>(db: Queryable, pool: P) {
  const repo = createDiscoveryRepository(pool as never, { clock: () => new Date() });
  const instrumentId = randomUUID();
  await db.query(`insert into instruments (instrument_id, issuer_id, asset_type) values ($1, $2, 'common_stock')`, [instrumentId, IDS.issuerA]);
  await db.query(`insert into listings (listing_id, instrument_id, mic, ticker, trading_currency, timezone) values ($1, $2, 'XNAS', 'ALPH', 'USD', 'America/New_York')`, [ALPHA.listing_id, instrumentId]);

  const campaign = await repo.createCampaign(IDS.owner, { name: "Revenue screen", question: "Which US-listed companies benefit from grid modernization spending?" });
  const draft = await repo.saveBrief(IDS.owner, campaign.campaign_id, 0, numericalBrief());
  await repo.startRun(IDS.owner, campaign.campaign_id, { brief_version: draft.version, brief_hash: draft.hash, request_key: randomUUID() } as Parameters<typeof repo.startRun>[2]);
  const brief = await repo.getBrief(IDS.owner, draft.brief_id);
  const lease = (await repo.claimNextRun("worker-1"))!;
  const candidateId = randomUUID();
  await repo.admitCandidate(lease, {
    candidate_id: candidateId, lead_key: "alpha", name: ALPHA.legal_name, identity: ALPHA, origins: ["web"],
    mechanism_ids: [numericalBrief().mechanisms[0]!.mechanism_id], seed: false, primary_domain_lead: true,
    first_seen: [0, 0], lead_hit_ids: [], reason_codes: [],
  });
  await repo.commitCohort(lease, [candidateId], {} as never);
  const evaluate = (asLease: Lease = lease) =>
    createFinancialCriteriaEvaluator({ pool: pool as never, evidence: createEvidenceFinancialPort })(asLease, { brief, candidate_id: candidateId, identity: ALPHA, as_of: CUTOFF });
  const certificates = async () =>
    Number((await db.query(`select count(*)::int as n from snapshot_financial_runs c join financial_runs r on r.run_id = c.run_id where r.parent_id = $1`, [lease.run_id])).rows[0].n);
  return { db, pool, repo, campaign, brief, lease, candidateId, evaluate, certificates };
}

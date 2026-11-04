import type { QueryExecutor } from '../../agents/src/agent-repo.ts';
import { generateFinding } from '../../agents/src/finding-generator.ts';
import type { SeverityScoringInput, ScoringTrustTier } from '../../agents/src/severity-scorer.ts';
import type { ConditionAssessment, ThesisVersion } from '../../agents/src/thesis-types.ts';
import type { ThesisPacket } from './thesis-evidence.ts';

export async function generateThesisFinding(db: QueryExecutor, input: {
  thesis: ThesisVersion;
  result: ConditionAssessment;
  packet: ThesisPacket;
  agentName: string;
  snapshot: {snapshot_id:string;source_ids:string[];as_of:string};
}) {
  const {thesis, result, packet, snapshot} = input;
  const condition = thesis.conditions.find(item => item.condition_id === result.condition_id);
  const cited = [
    ...packet.claims.filter(claim => result.claim_refs.includes(claim.claim_id)),
    ...packet.facts.filter(fact => result.fact_refs.includes(fact.fact_id)),
  ];
  // Relevance is earned by an explicitly matched saved condition and its
  // validated citations; no unrelated market item receives a default score.
  const relevance = condition && cited.length > 0 && result.status !== 'unresolved' ? 1 : 0;
  if (!relevance) throw new Error('A thesis finding requires a matched condition with evidence.');
  const sourceIds = [...new Set(cited.map(item => item.source_id))];
  const trustOrder: ScoringTrustTier[] = ['primary', 'secondary', 'user', 'tertiary'];
  const trustTier = trustOrder.find(tier => cited.some(item => item.trust_tier === tier)) ?? 'tertiary';
  const {rows: impacts} = await db.query<SeverityScoringInput['impact']>(
    `select direction,channel,horizon,confidence::float8
       from entity_impacts where claim_id=any($1::uuid[])
        and subject_kind='issuer' and subject_id=$2::uuid
       order by confidence desc,created_at desc,entity_impact_id limit 1`,
    [result.claim_refs,thesis.subject_ref.id]);
  // Missing impact evidence uses the scorer's conservative lowest-weight
  // categories with zero confidence, never an invented business forecast.
  const impact = impacts[0] ?? {direction:'unknown',channel:'sentiment',horizon:'long_term',confidence:0};
  return generateFinding(db, {
    agent_id: thesis.agent_id,
    snapshot_id: snapshot.snapshot_id,
    snapshot_manifest: snapshot,
    subject_refs: [thesis.subject_ref],
    claim_cluster_ids: [],
    headline: `${input.agentName}: ${condition!.statement} — ${result.status}. ${result.reason}`,
    source_refs: sourceIds,
    severity_input: {
      evidence: {
        trust_tier: trustTier,
        corroborating_source_count: sourceIds.length,
        confidence: Math.max(...cited.map(item => item.confidence)),
      },
      impact,
      thesis_relevance: relevance,
    },
  });
}

import { randomUUID } from 'node:crypto';
import type { QueryExecutor } from '../../agents/src/agent-repo.ts';
import type { ThesisVersion, ConditionAssessment } from '../../agents/src/thesis-types.ts';
import type { ThesisFact } from '../../agents/src/thesis-evaluator.ts';
import { loadLocalRuntimeEvidence, type LocalRuntimeClaimEvidence } from '../../evidence/src/local-runtime-evidence.ts';
import { buildClaimBackedSealInput, buildFactBackedSealInput, toSealFactRow } from '../../snapshot/src/seal-input.ts';
import { sealSnapshotInTransaction, snapshotTransactionClient } from '../../snapshot/src/snapshot-sealer.ts';
import { mergeSealInputs } from '../../analyze/src/seal-input-merge.ts';
import { writeToolCallLog } from '../../observability/src/tool-call.ts';
type PacketFact = ThesisFact & {
  confidence: number;
  trust_tier: string;
  fiscal_year: number | null;
  fiscal_period: string | null;
  period_start: string | null;
};
export type ThesisPacket = {
  claims: LocalRuntimeClaimEvidence[];
  facts: PacketFact[];
};
export async function loadThesisPacket(db: QueryExecutor, input: {
  thesis: ThesisVersion;
  userId: string;
  asOf: string;
}): Promise<ThesisPacket> {
  const evidence = await loadLocalRuntimeEvidence(db, {
    subject_refs: [input.thesis.subject_ref], user_id: input.userId,
    source_categories: ['filings', 'transcripts', 'news', 'issuer_ir'],
    limit: 100, as_of: input.asOf,
  });
  const claims = [...evidence.claims];
  const metrics = [...new Map(input.thesis.conditions.flatMap(condition => condition.metric
      ? [[JSON.stringify([condition.metric.metric_key, condition.metric.unit, condition.metric.period_kind]), condition.metric] as const]
      : [])).values()];
  if (!metrics.length)
    return { claims, facts: [] };
  // Bound each requested metric separately. Another unit or a dense history for
  // one condition must not displace the current evidence for another condition.
  const { rows } = await db.query<PacketFact>(`select packet.*
  from jsonb_to_recordset($2::jsonb) requested(metric_key text,unit text,period_kind text)
  cross join lateral (
   select f.fact_id::text,m.metric_key,f.value_num::float8,f.scale::float8,f.unit,f.period_kind,
    f.period_end::text,f.period_start::text,f.fiscal_year,f.fiscal_period,f.as_of::text,f.source_id::text,f.confidence::float8,s.trust_tier
   from facts f join metrics m on m.metric_id=f.metric_id join sources s on s.source_id=f.source_id
   where f.subject_kind='issuer' and f.subject_id=$1::uuid and m.metric_key=requested.metric_key
    and f.unit=requested.unit and f.period_kind=requested.period_kind
    and f.invalidated_at is null and f.superseded_by is null and f.value_num is not null
    and f.value_num not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
    and f.verification_status='authoritative' and f.entitlement_channels ? 'app'
    and f.period_end is not null and f.period_end <= $3::timestamptz::date
    and (f.period_kind not in ('fiscal_q','fiscal_y') or f.fiscal_year is not null)
    and (f.period_kind <> 'fiscal_q' or f.fiscal_period is not null)
    and (f.period_kind <> 'ttm' or f.period_start is not null)
    and f.as_of <= $3::timestamptz and f.observed_at <= $3::timestamptz
    and (f.reported_at is null or f.reported_at <= $3::timestamptz)
    and (s.user_id is null or s.user_id=$4::uuid)
   order by case when f.period_kind='point' then f.as_of else f.period_end::timestamptz end desc,
    f.as_of desc,f.fact_id limit 50
  ) packet
  order by packet.metric_key,packet.unit,packet.period_kind,packet.period_end desc,packet.as_of desc,packet.fact_id`, [input.thesis.subject_ref.id, JSON.stringify(metrics), input.asOf, input.userId]);
  return { claims, facts: rows };
}
export async function sealThesisPacket(db: QueryExecutor, input: {
  thesis: ThesisVersion;
  packet: ThesisPacket;
  results: ConditionAssessment[];
  asOf: string;
  modelVersion: string | null;
  inputHash: string;
}) {
  const snapshotId = randomUUID();
  const log = await writeToolCallLog(db, {
    agent_id: input.thesis.agent_id, tool_name: 'thesis_assessment', status: 'ok',
    args: { version_id: input.thesis.thesis_version_id, input_hash: input.inputHash },
    result: { results: input.results, model_version: input.modelVersion },
  });
  const claims = input.packet.claims;
  const sources = [...new Set(claims.map(c => c.source_id))];
  const base = buildClaimBackedSealInput({
    block: { id: randomUUID(), kind: 'rich_text', snapshot_id: snapshotId, as_of: input.asOf,
      data_ref: { kind: 'rich_text', id: input.thesis.thesis_version_id }, source_refs: sources,
      segments: [{ type: 'text', text: 'Evidence considered for the saved thesis conditions.' }] },
    claims: claims.map(c => ({ claim_id: c.claim_id, source_id: c.source_id })),
    documents: [...new Map(claims.map(c => [c.document_id, { document_id: c.document_id, source_id: c.source_id }])).values()],
    subjectRefs: [input.thesis.subject_ref], toolCalls: [{ tool_call_id: log.tool_call_id, result_hash: log.result_hash! }],
    modelVersion: input.modelVersion,
  });
  const facts = input.packet.facts;
  const factSeals = facts.length ? [buildFactBackedSealInput({
      block: { id: randomUUID(), snapshot_id: snapshotId, as_of: input.asOf,
        data_ref: { kind: 'metric_row', id: input.thesis.thesis_version_id },
        ...{ kind: 'metric_row', source_refs: [...new Set(facts.map(f => f.source_id))], items: facts.map(f => ({ value_ref: f.fact_id })) } },
      factRefs: facts.map(f => f.fact_id), subjectRefs: [input.thesis.subject_ref], facts: facts.map(toSealFactRow),
    })] : [];
  const seal = await sealSnapshotInTransaction(snapshotTransactionClient(db), mergeSealInputs(base, factSeals));
  if (!seal.ok)
    throw new Error(`Thesis evidence snapshot failed verification: ${JSON.stringify(seal.verification.failures)}`);
  return { snapshot_id: snapshotId, source_ids: [...new Set([...sources, ...facts.map(f => f.source_id)])], as_of: input.asOf };
}

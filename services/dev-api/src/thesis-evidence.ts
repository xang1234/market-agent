import { randomUUID } from 'node:crypto';
import type { QueryExecutor } from '../../agents/src/agent-repo.ts';
import type { ThesisEvidence, ThesisRef } from '../../agents/src/thesis-evaluator.ts';
import type { JsonObject } from '../../observability/src/types.ts';
import type { ThesisVersion, ConditionAssessment } from '../../agents/src/thesis-types.ts';
import { runRegisteredAnalystTool } from '../../chat/src/analyst-tools.ts';
import { ANALYST_AGENT_BUNDLE_ID } from '../../chat/src/bundle-routing.ts';
import type { ChatTurnRunContext } from '../../chat/src/coordinator.ts';
import { buildEvidencePacket, mergePackets, packetForModel, type EvidencePacket } from '../../chat/src/evidence-packet.ts';
import { certifiedFinancials } from '../../chat/src/financial-runtime.ts';
import { LATEST } from '../../chat/src/scope-figures.ts';
import { createRuntimeAuthority } from '../../financial-core/src/index.ts';
import type { SavedRuleDeps } from '../../financial-engine/src/saved-rule.ts';
import { loadLocalRuntimeEvidence, type LocalRuntimeClaimEvidence } from '../../evidence/src/local-runtime-evidence.ts';
import { buildClaimBackedSealInput, buildFactBackedSealInput, toSealFactRow, type ClaimSealDocument } from '../../snapshot/src/seal-input.ts';
import { sealSnapshotInTransaction, snapshotTransactionClient } from '../../snapshot/src/snapshot-sealer.ts';
import { mergeSealInputs } from '../../analyze/src/seal-input-merge.ts';
import { writeToolCallLog } from '../../observability/src/tool-call.ts';
type PacketFact = {
  fact_id: string;
  metric_key: string;
  value_num: string;
  scale: string;
  unit: string;
  period_kind: string;
  period_end: string | null;
  as_of: string;
  source_id: string;
  confidence: number;
  trust_tier: string;
  fiscal_year: number | null;
  fiscal_period: string | null;
  period_start: string | null;
};
export type ThesisPacket = {
  claims: LocalRuntimeClaimEvidence[];
  documents: ClaimSealDocument[];
  facts: PacketFact[];
  /** What the narrative conditions are assessed over: the analyst agent's packet of certified figures and claims. */
  evidence: ThesisEvidence;
};
const NO_EVIDENCE: ThesisEvidence = { packet: {}, refs: {} };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QUIET = (() => undefined) as unknown as ChatTurnRunContext['emit'];
const FIGURES_ASK = "The company's latest fiscal year income statement, as certified figures.";
const NO_FIGURES = 'No certified figures were computed for this run.';

export async function loadThesisPacket(db: QueryExecutor, input: {
  thesis: ThesisVersion;
  userId: string;
  asOf: string;
  runId: string;
  financial: SavedRuleDeps;
}): Promise<ThesisPacket> {
  const subject = input.thesis.subject_ref;
  const narrative = input.thesis.conditions.some(condition => !condition.metric);
  // The analyst agent's claims read picks the latest 10-K's business and risk claims; the stored-claims read then returns them first.
  const filings = narrative ? await runRegisteredAnalystTool(db, 'get_claims', { subject_refs: [subject] }, { as_of: input.asOf, user_id: input.userId }) : null;
  const evidence = await loadLocalRuntimeEvidence(db, {
    subject_refs: [subject], user_id: input.userId,
    source_categories: ['filings', 'transcripts', 'news', 'issuer_ir'],
    limit: 100, as_of: input.asOf,
    first_claim_ids: filings?.status === 'ok' && 'claims' in filings ? filings.claims.map(claim => claim.claim_id) : [],
  });
  const claims = [...evidence.claims];
  const documents = [...evidence.verifier_documents];
  const analyst = filings ? await analystEvidence(db, input, claims, filings) : NO_EVIDENCE;
  const metrics = [...new Map(input.thesis.conditions.flatMap(condition => condition.metric
      ? [[JSON.stringify([condition.metric.metric_key, condition.metric.unit, condition.metric.period_kind]), condition.metric] as const]
      : [])).values()];
  if (!metrics.length)
    return { claims, documents, facts: [], evidence: analyst };
  // Bound each requested metric separately. Another unit or a dense history for
  // one condition must not displace the current evidence for another condition.
  const { rows } = await db.query<PacketFact>(`select packet.*
  from jsonb_to_recordset($2::jsonb) requested(metric_key text,unit text,period_kind text)
  cross join lateral (
   select f.fact_id::text,m.metric_key,f.value_num::text as value_num,f.scale::text as scale,f.unit,f.period_kind,
    f.period_end::text,f.period_start::text,f.fiscal_year,f.fiscal_period,f.as_of::text,f.source_id::text,f.confidence::float8,s.trust_tier
   from facts f join metrics m on m.metric_id=f.metric_id join sources s on s.source_id=f.source_id
   where f.subject_kind='issuer' and f.subject_id=$1::uuid and m.metric_key=requested.metric_key
    and f.unit=requested.unit and f.period_kind=requested.period_kind
    and f.invalidated_at is null and f.superseded_by is null and f.method<>'restated' and f.value_num is not null
    and f.value_num not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
    and f.verification_status='authoritative' and f.entitlement_channels ? 'app'
    and (f.period_kind='point' or (f.period_end is not null and f.period_end <= $3::timestamptz::date))
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
  return { claims, documents, facts: rows, evidence: analyst };
}

/**
 * The packet chat's analyst agent answers from, for the thesis company: its
 * certified figures (F ids) and its claims (C ids). The model reads only the
 * ids; each stands for its claim, or for the facts its figure was bound to.
 */
async function analystEvidence(
  db: QueryExecutor,
  input: { thesis: ThesisVersion; userId: string; asOf: string; runId: string; financial: SavedRuleDeps },
  claims: ReadonlyArray<LocalRuntimeClaimEvidence>,
  filings: Awaited<ReturnType<typeof runRegisteredAnalystTool>>,
): Promise<ThesisEvidence> {
  const issuer = input.thesis.subject_ref.id.toLowerCase();
  const label = await issuerLabel(db, issuer);
  const figures = await certifiedFigures(input, issuer, label);
  const factsOf = await figureFacts(db, figures?.figures.flatMap(figure => figure.result_id ? [figure.result_id] : []) ?? []);
  const cited = figures && { ...figures, figures: figures.figures.filter(figure => figure.gap === undefined && factsOf.has(figure.result_id ?? '')) };
  const packet = mergePackets({
    engine: cited ? [cited] : [],
    route: buildEvidencePacket({ factBlocks: [], cutoff: input.asOf, claims: { claims } }),
    // Its claims come through the route, the read the snapshot seals; it adds what the 10-K left unread.
    analyst: ['claims' in filings ? { ...filings, claims: [] } : filings],
    figuresAskedFor: [label],
    notes: cited?.figures.length ? [] : [NO_FIGURES],
    labels: new Map([[issuer, label]]),
    cutoff: input.asOf,
  });
  const refs: Record<string, ThesisRef> = Object.fromEntries([
    ...packet.figures.map(figure => [figure.id, { claim_refs: [], fact_refs: factsOf.get(figure.result_id!)! }] as const),
    ...packet.claims.flatMap(claim => UUID.test(claim.claim_id) ? [[claim.id, { claim_refs: [claim.claim_id], fact_refs: [] }] as const] : []),
  ]);
  // The run's cutoff is passed to the model beside the packet, so the packet, and the reuse key hashed over it, stays the same from run to run.
  const { cutoff: _cutoff, ...shown } = packetForModel(packet);
  return { packet: shown as JsonObject, refs };
}

async function certifiedFigures(
  input: { thesis: ThesisVersion; userId: string; asOf: string; runId: string; financial: SavedRuleDeps },
  issuer: string,
  label: string,
): Promise<EvidencePacket | null> {
  const outcome = await certifiedFinancials({ ...input.financial, planningModel: null, clock: () => new Date(input.asOf) }, {
    context: { threadId: input.runId, runId: input.runId, turnId: 'thesis', userId: input.userId, userIntent: FIGURES_ASK, bundleId: ANALYST_AGENT_BUNDLE_ID, emit: QUIET },
    subjects: [{ mention: label, resolution: { status: 'resolved', subject_ref: { kind: 'issuer', id: issuer }, label } }],
    choice: { kind: 'kept_figures', metrics: ['income_statement'], period: LATEST },
    labels: new Map([[issuer, label]]),
    authority: createRuntimeAuthority({
      owner_user_id: input.userId,
      egress_channel: 'thesis',
      parent: { kind: 'thesis_version', id: input.thesis.thesis_version_id, version: `v${input.thesis.version}` },
      allowed_source_classes: ['sec_filing'],
      feature: { surface: 'thesis', capability: 'thesis-evidence', mode: 'enforce' },
      approval_state: 'not_required',
      lease: null,
    }),
    requestKey: `thesis:${input.runId}:figures`,
    persistParent: async () => {},
  });
  return outcome.status === 'published' ? outcome.packet() : null;
}

// ponytail: one dependency level, which every income statement figure has (a margin reads two reported lines); deeper computations add a walk.
async function figureFacts(db: QueryExecutor, resultIds: ReadonlyArray<string>): Promise<Map<string, string[]>> {
  if (!resultIds.length) return new Map();
  const { rows } = await db.query<{ result_id: string; fact_ids: string[] }>(
    `select r.result_id::text as result_id, array_agg(distinct i.fact_id::text order by i.fact_id::text) as fact_ids
       from financial_results r
       join financial_run_inputs i on i.run_id = r.run_id and i.binding_status = 'bound' and i.fact_id is not null
        and (i.input_slot = r.node_id or r.dependencies ? i.input_slot)
      where r.result_id = any($1::uuid[])
      group by r.result_id`,
    [resultIds],
  );
  return new Map(rows.map(row => [row.result_id, row.fact_ids]));
}

// The label chat's agent gives a company: its active ticker, else its legal name.
async function issuerLabel(db: QueryExecutor, issuer: string): Promise<string> {
  const { rows } = await db.query<{ label: string }>(
    `select coalesce((select l.ticker from listings l join instruments n on n.instrument_id = l.instrument_id
                       where n.issuer_id = i.issuer_id order by (l.active_to is null) desc, l.ticker limit 1), i.legal_name) as label
       from issuers i where i.issuer_id = $1::uuid`,
    [issuer],
  );
  return rows[0]?.label ?? `issuer:${issuer.slice(0, 8)}`;
}
/**
 * Loads facts a verified condition cited that the packet's own bounded query
 * did not include: current (not superseded or invalidated) and visible to the
 * user, since only those can be sealed into the thesis evidence snapshot.
 */
export async function loadThesisFactsById(db: QueryExecutor, input: { factIds: ReadonlyArray<string>; userId: string }): Promise<ThesisPacket['facts']> {
  if (!input.factIds.length) return [];
  const { rows } = await db.query<ThesisPacket['facts'][number]>(`select f.fact_id::text,m.metric_key,f.value_num::text as value_num,f.scale::text as scale,f.unit,f.period_kind,
    f.period_end::text,f.period_start::text,f.fiscal_year,f.fiscal_period,f.as_of::text,f.source_id::text,f.confidence::float8,s.trust_tier
   from facts f join metrics m on m.metric_id=f.metric_id join sources s on s.source_id=f.source_id
   where f.fact_id=any($1::uuid[]) and (s.user_id is null or s.user_id=$2::uuid)
     and f.superseded_by is null and f.invalidated_at is null
   order by f.fact_id`, [input.factIds, input.userId]);
  return rows;
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
  const documents = input.packet.documents;
  const sources = [...new Set([...claims.map(c => c.source_id), ...documents.map(d => d.source_id)])];
  const base = buildClaimBackedSealInput({
    block: { id: randomUUID(), kind: 'rich_text', snapshot_id: snapshotId, as_of: input.asOf,
      data_ref: { kind: 'rich_text', id: input.thesis.thesis_version_id }, source_refs: sources,
      segments: [{ type: 'text', text: 'Evidence considered for the saved thesis conditions.' }] },
    claims: claims.map(c => ({ claim_id: c.claim_id, source_id: c.source_id })),
    documents,
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

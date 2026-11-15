import type { AgentRow, QueryExecutor } from '../../agents/src/agent-repo.ts';
import type { AgentLoopStages } from '../../agents/src/agent-loop.ts';
import { getCurrentThesis, getLastCheckedResults, recordThesisAssessment, type LastCheckedResult } from '../../agents/src/thesis-repo.ts';
import { evaluateThesis, THESIS_PROMPT_VERSION, type ThesisLlm } from '../../agents/src/thesis-evaluator.ts';
import { ThesisConflictError, type ThesisAssessment, type ThesisVersion, type ConditionAssessment } from '../../agents/src/thesis-types.ts';
import { generateThesisFinding } from './thesis-finding.ts';
import type { FindingRow } from '../../agents/src/finding-generator.ts';
import { writeRunActivity } from '../../observability/src/run-activity.ts';
import { hashJsonValue } from '../../observability/src/tool-call.ts';
import { createLlmRouterFromEnv, loadLlmSettingsFromEnv, buildLlmDeploymentOrder } from '../../llm/src/settings-loader.ts';
import { loadThesisFactsById, loadThesisPacket, sealThesisPacket, type ThesisPacket } from './thesis-evidence.ts';
import { evaluateFinancialThesisConditions, thesisReuseProjection } from '../../agents/src/financial-thesis-adapter.ts';
import type { SavedRuleDeps } from '../../financial-engine/src/saved-rule.ts';
type Model = {
  llm: ThesisLlm | null;
  identity: string;
};
export type ThesisRuntimeInput = {
  db: QueryExecutor;
  userId: string;
  runId: string;
  agent: AgentRow;
  thesis: ThesisVersion;
  getModel?: () => Promise<Model>;
  financial: SavedRuleDeps;
  /** The run's cutoff clock. Defaults to the database's now(), the clock that stamps facts and assessments. */
  now?: () => string | Promise<string>;
};
type ThesisRunStart = { thesis_version_id: string; as_of: string };
type PreparedAssessment = {
  results: ConditionAssessment[];
  model_version: string | null;
  packet_hash: string;
  input_hash: string;
  /** The snapshot that already seals every result, when each condition kept its last checked result from one earlier run. */
  reused_snapshot_id: string | null;
  /** Facts the verified conditions cited beyond the packet's own; sealed and cited with it. */
  cited_facts: ThesisPacket['facts'];
};

// Each stage passes its typed output to the next through the existing loop.
// The evidence packet is complete, so amendments and removals are reassessed.
export function createThesisAgentLoopStages(input: ThesisRuntimeInput): AgentLoopStages<ThesisRunStart, ThesisPacket, null, PreparedAssessment> {
  // Alert delivery follows persistence in the same transaction. This is the
  // only state shared between hooks; evidence and analysis use stage outputs.
  let findings: FindingRow[] = [];
  return {
    async readDeltas() {
      // By default the cutoff comes from the database clock, the one that stamps
      // facts (now()) and assessments (assessed_at). Taking it from the app clock
      // let skew hide a just-ingested fact or fake a newer-assessment conflict (#143).
      const asOf = input.now ? new Date(await input.now()).toISOString() : await databaseNow(input.db);
      return { thesis_version_id: input.thesis.thesis_version_id, as_of: asOf };
    },
    async extractEvidence({ deltas }) {
      return loadThesisPacket(input.db, { thesis: input.thesis, userId: input.userId, asOf: deltas.as_of, runId: input.runId, financial: input.financial });
    },
    async clusterEvidence() { return null; },
    async analyze({ deltas, evidence }) {
      const needsModel = Object.keys(evidence.evidence.refs).length > 0 && input.thesis.conditions.some(c => !c.metric);
      const model = needsModel ? await (input.getModel ?? configuredModel)() : { llm: null, identity: 'deterministic' };
      const metricResults = await evaluateFinancialThesisConditions(input.financial, { user_id: input.userId, thesis: input.thesis, run_key: input.runId, as_of: deltas.as_of });
      // The reuse key compares definitions, inputs, and outcomes — never run or snapshot identities.
      const packetHash = hashJsonValue({ metricResults: thesisReuseProjection(metricResults), version: input.thesis.thesis_version_id, packet: withoutResultIds(evidence), day: deltas.as_of.slice(0, 10), model: model.identity, prompt: THESIS_PROMPT_VERSION });
      const kept = keptOn(await getLastCheckedResults(input.db, input.thesis.thesis_version_id), packetHash);
      const keptIds = new Set(kept.map(last => last.result.condition_id));
      const evaluation = await evaluateThesis({
        thesis: input.thesis, evidence: evidence.evidence, as_of: deltas.as_of, llm: model.llm,
        known_results: [...metricResults.filter(result => !keptIds.has(result.condition_id)), ...kept.map(last => last.result)],
      });
      const packetFacts = new Set(evidence.facts.map(fact => fact.fact_id));
      const citedFacts = await loadThesisFactsById(input.db, {
        factIds: [...new Set(evaluation.results.flatMap(result => result.fact_refs))].filter(id => !packetFacts.has(id)),
        userId: input.userId,
      });
      const keptSnapshots = new Set(kept.map(last => last.snapshot_id));
      return {
        results: evaluation.results,
        model_version: evaluation.model_version ?? kept.find(last => last.model_version !== null)?.model_version ?? null,
        packet_hash: packetHash,
        input_hash: `${packetHash}/${input.runId}`,
        reused_snapshot_id: kept.length === evaluation.results.length && keptSnapshots.size === 1 ? kept[0].snapshot_id : null,
        cited_facts: citedFacts,
      };
    },
    async nextWatermarks({ current_watermarks, deltas, analysis }) {
      const current = current_watermarks !== null && typeof current_watermarks === 'object' && !Array.isArray(current_watermarks) ? current_watermarks : {};
      return { ...current, thesis_monitor: { thesis_version_id: input.thesis.thesis_version_id, last_checked_at: deltas.as_of, input_hash: analysis.input_hash } };
    },
    async applySideEffects({ tx, deltas, evidence: packet, analysis }) {
      findings = [];
      const evidence: ThesisPacket = { ...packet, facts: [...packet.facts, ...analysis.cited_facts] };
      const lock = await tx.query('select agent_id from agents where agent_id=$1::uuid and user_id=$2::uuid for update', [input.agent.agent_id, input.userId]);
      if (!lock.rows.length)
        throw new Error('Thesis agent no longer exists');
      const latest = await getCurrentThesis(tx, input.agent.agent_id);
      if (latest?.thesis_version_id !== input.thesis.thesis_version_id)
        throw new ThesisConflictError('Thesis changed during assessment; run again to assess the new version.');
      const lastChecked = await getLastCheckedResults(tx, input.thesis.thesis_version_id);
      // Compared in the database, at its microsecond precision: through JS Dates
      // an assessment finished later in the cutoff's millisecond looked equal.
      const finishedDuringThisRun = await tx.query<Pick<ThesisAssessment, 'input_hash'>>(
        'select input_hash from agent_thesis_assessments where thesis_version_id = $1::uuid and assessed_at > $2::timestamptz order by assessed_at desc limit 1',
        [input.thesis.thesis_version_id, deltas.as_of],
      );
      const finished = finishedDuringThisRun.rows[0];
      if (finished !== undefined && packetHashOf(finished.input_hash) !== analysis.packet_hash)
        throw new ThesisConflictError('A newer assessment finished during this run; run again.');
      if (finished !== undefined && keptOn(lastChecked, analysis.packet_hash).length === analysis.results.length) {
        await activity(tx, input, 'dismissed', 'No new thesis changes: a run that finished during this one assessed the same evidence.');
        return { findings: 0, assessments: 0, reused: true };
      }
      if (analysis.reused_snapshot_id !== null) {
        await recordThesisAssessment(tx, {
          thesis_version_id: input.thesis.thesis_version_id, run_id: input.runId, snapshot_id: analysis.reused_snapshot_id,
          input_hash: analysis.input_hash, results: analysis.results, model_version: analysis.model_version, prompt_version: THESIS_PROMPT_VERSION,
        });
        await activity(tx, input, 'dismissed', 'Recorded the assessment; the evidence is unchanged since the last one.');
        return { findings: 0, assessments: 1, reused: true };
      }
      const snapshot = await sealThesisPacket(tx, {
        thesis: input.thesis, packet: evidence, results: analysis.results, asOf: deltas.as_of,
        modelVersion: analysis.model_version, inputHash: analysis.input_hash,
      });
      await recordThesisAssessment(tx, {
        thesis_version_id: input.thesis.thesis_version_id, run_id: input.runId, snapshot_id: snapshot.snapshot_id,
        input_hash: analysis.input_hash, results: analysis.results, model_version: analysis.model_version, prompt_version: THESIS_PROMPT_VERSION,
      });
      const sealed = new Set([...evidence.facts.map(fact => fact.fact_id), ...evidence.claims.map(claim => claim.claim_id)]);
      for (const result of analysis.results) {
        if (result.status === 'unresolved' || lastChecked.get(result.condition_id)?.result.status === result.status)
          continue;
        if (![...result.fact_refs, ...result.claim_refs].some(id => sealed.has(id)))
          continue;
        findings.push(await generateThesisFinding(tx, {
          thesis: input.thesis, result, packet: evidence, agentName: input.agent.name, snapshot,
        }));
      }
      await activity(tx, input, 'reading', `Considered ${evidence.claims.length} current claims and sealed ${evidence.facts.length} stored facts for the configured metrics.`);
      await activity(tx, input, 'investigating', `Assessed ${analysis.results.length} saved conditions using ${analysis.model_version ?? 'the financial engine and missing-evidence handling'}.`);
      const unchecked = analysis.results.filter(result => result.method === 'unchecked_reply').length;
      const narrative = input.thesis.conditions.filter(condition => !condition.metric).length;
      if (unchecked > 0)
        await activity(tx, input, 'investigating', `Could not check the model's reply against the stored sources for ${unchecked} of ${narrative} narrative ${narrative === 1 ? 'condition' : 'conditions'}. Each reads as not enough evidence, and the next run asks again.`);
      await activity(tx, input, findings.length ? 'found' : 'dismissed', findings.length ? `Recorded ${findings.length} thesis condition changes.` : 'Recorded the assessment; no new supported or challenged states.');
      return { findings: findings.length, assessments: 1, reused: false };
    },
    async alertFindings() { return findings; },
  };
}
// An input hash is the packet hash, then the run that recorded it.
function packetHashOf(inputHash: string): string {
  return inputHash.split('/')[0];
}
// A condition keeps its last checked result while the evidence it was assessed on is unchanged.
function keptOn(lastChecked: ReadonlyMap<string, LastCheckedResult>, packetHash: string): LastCheckedResult[] {
  return [...lastChecked.values()].filter(last => packetHashOf(last.input_hash) === packetHash);
}
// The engine numbers each run's results anew, so a cited figure's result id stays out of the reuse key. Its measure, period and value are in the packet.
function withoutResultIds(packet: ThesisPacket) {
  const refs = Object.fromEntries(Object.entries(packet.evidence.refs).map(([id, ref]) => [id, { ...ref, figure_refs: ref.figure_refs.map(({ result_id: _resultId, ...figure }) => figure) }]));
  return { ...packet, evidence: { ...packet.evidence, refs } };
}
async function configuredModel(): Promise<Model> {
  const settings = await loadLlmSettingsFromEnv();
  const identity = JSON.stringify(buildLlmDeploymentOrder(settings).map(d => ({ channel: d.channel, model: d.model })));
  return { llm: await createLlmRouterFromEnv(), identity };
}
async function activity(db: QueryExecutor, input: ThesisRuntimeInput, stage: 'reading' | 'investigating' | 'found' | 'dismissed', summary: string) {
  return writeRunActivity(db, { user_id: input.userId, agent_id: input.agent.agent_id, stage, subject_refs: [input.thesis.subject_ref], summary, ts: new Date() });
}

// As ISO text with microseconds: through a JS Date the cutoff would round down
// to the millisecond and fall before a fact stamped earlier in that millisecond.
async function databaseNow(db: QueryExecutor): Promise<string> {
  const { rows } = await db.query<{ now: string }>(
    `select to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as now`,
  );
  return rows[0].now;
}

import type { AgentRow, QueryExecutor } from '../../agents/src/agent-repo.ts';
import type { AgentLoopStages } from '../../agents/src/agent-loop.ts';
import { getCurrentThesis, getLatestThesisAssessment, recordThesisAssessment } from '../../agents/src/thesis-repo.ts';
import { evaluateThesis, evaluateThesisMetrics, THESIS_PROMPT_VERSION, type ThesisLlm } from '../../agents/src/thesis-evaluator.ts';
import { ThesisConflictError, type ThesisVersion, type ConditionAssessment } from '../../agents/src/thesis-types.ts';
import { generateThesisFinding } from './thesis-finding.ts';
import type { FindingRow } from '../../agents/src/finding-generator.ts';
import { writeRunActivity } from '../../observability/src/run-activity.ts';
import { hashJsonValue } from '../../observability/src/tool-call.ts';
import { createLlmRouterFromEnv, loadLlmSettingsFromEnv, buildLlmDeploymentOrder } from '../../llm/src/settings-loader.ts';
import { loadThesisPacket, sealThesisPacket, type ThesisPacket } from './thesis-evidence.ts';
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
};
type ThesisRunStart = { thesis_version_id: string; as_of: string };
type PreparedAssessment = {
  results: ConditionAssessment[];
  model_version: string | null;
  packet_hash: string;
  input_hash: string;
  reused: boolean;
};

// Each stage passes its typed output to the next through the existing loop.
// The evidence packet is complete, so amendments and removals are reassessed.
export function createThesisAgentLoopStages(input: ThesisRuntimeInput): AgentLoopStages<ThesisRunStart, ThesisPacket, null, PreparedAssessment> {
  // Alert delivery follows persistence in the same transaction. This is the
  // only state shared between hooks; evidence and analysis use stage outputs.
  let findings: FindingRow[] = [];
  return {
    async readDeltas() {
      return { thesis_version_id: input.thesis.thesis_version_id, as_of: new Date().toISOString() };
    },
    async extractEvidence({ deltas }) {
      return loadThesisPacket(input.db, { thesis: input.thesis, userId: input.userId, asOf: deltas.as_of });
    },
    async clusterEvidence() { return null; },
    async analyze({ deltas, evidence }) {
      const needsModel = evidence.claims.length > 0 && input.thesis.conditions.some(c => !c.metric);
      const model = needsModel ? await (input.getModel ?? configuredModel)() : { llm: null, identity: 'deterministic' };
      const metricResults = evaluateThesisMetrics(input.thesis.conditions, evidence.facts, deltas.as_of);
      const packetHash = hashJsonValue({ metricResults, version: input.thesis.thesis_version_id, packet: evidence, day: deltas.as_of.slice(0, 10), model: model.identity, prompt: THESIS_PROMPT_VERSION });
      const previous = await getLatestThesisAssessment(input.db, input.thesis.thesis_version_id);
      const reused = previous?.input_hash.split('/')[0] === packetHash;
      const evaluation = reused && previous ? previous : await evaluateThesis({
        thesis: input.thesis, claims: evidence.claims, facts: evidence.facts, as_of: deltas.as_of, llm: model.llm,
      });
      return {
        results: evaluation.results,
        model_version: evaluation.model_version,
        packet_hash: packetHash,
        input_hash: reused && previous ? previous.input_hash : `${packetHash}/${previous?.assessment_id ?? 'initial'}`,
        reused,
      };
    },
    async nextWatermarks({ current_watermarks, deltas, analysis }) {
      const current = current_watermarks !== null && typeof current_watermarks === 'object' && !Array.isArray(current_watermarks) ? current_watermarks : {};
      return { ...current, thesis_monitor: { thesis_version_id: input.thesis.thesis_version_id, last_checked_at: deltas.as_of, input_hash: analysis.input_hash } };
    },
    async applySideEffects({ tx, deltas, evidence, analysis }) {
      findings = [];
      const lock = await tx.query('select agent_id from agents where agent_id=$1::uuid and user_id=$2::uuid for update', [input.agent.agent_id, input.userId]);
      if (!lock.rows.length)
        throw new Error('Thesis agent no longer exists');
      const latest = await getCurrentThesis(tx, input.agent.agent_id);
      if (latest?.thesis_version_id !== input.thesis.thesis_version_id)
        throw new ThesisConflictError('Thesis changed during assessment; run again to assess the new version.');
      // Recheck under the agent lock: another delivery may have finished while
      // the model was evaluating. A-to-B-to-A recurrence is still a new event.
      const previous = await getLatestThesisAssessment(tx, input.thesis.thesis_version_id);
      if (previous?.input_hash.split('/')[0] === analysis.packet_hash) {
        await activity(tx, input, 'dismissed', 'No new thesis changes: this evidence packet was already assessed.');
        return { findings: 0, assessments: 0, reused: true };
      }
      if (previous && Date.parse(previous.assessed_at) > Date.parse(deltas.as_of))
        throw new ThesisConflictError('A newer assessment finished during this run; run again.');
      const snapshot = await sealThesisPacket(tx, {
        thesis: input.thesis, packet: evidence, results: analysis.results, asOf: deltas.as_of,
        modelVersion: analysis.model_version, inputHash: analysis.input_hash,
      });
      await recordThesisAssessment(tx, {
        thesis_version_id: input.thesis.thesis_version_id, run_id: input.runId, snapshot_id: snapshot.snapshot_id,
        input_hash: analysis.input_hash, results: analysis.results, model_version: analysis.model_version, prompt_version: THESIS_PROMPT_VERSION,
      });
      for (const result of analysis.results) {
        if (result.status === 'unresolved' || previous?.results.find(r => r.condition_id === result.condition_id)?.status === result.status)
          continue;
        findings.push(await generateThesisFinding(tx, {
          thesis: input.thesis, result, packet: evidence, agentName: input.agent.name, snapshot,
        }));
      }
      await activity(tx, input, 'reading', `Considered ${evidence.claims.length} current claims and ${evidence.facts.length} stored facts for the configured metrics.`);
      await activity(tx, input, 'investigating', `Assessed ${analysis.results.length} saved conditions using ${analysis.model_version ?? 'deterministic checks / missing-evidence handling'}.`);
      await activity(tx, input, findings.length ? 'found' : 'dismissed', findings.length ? `Recorded ${findings.length} thesis condition changes.` : 'Recorded the assessment; no new supported or challenged states.');
      return { findings: findings.length, assessments: 1, reused: false };
    },
    async alertFindings() { return findings; },
  };
}
async function configuredModel(): Promise<Model> {
  const settings = await loadLlmSettingsFromEnv();
  const identity = JSON.stringify(buildLlmDeploymentOrder(settings).map(d => ({ channel: d.channel, model: d.model })));
  return { llm: await createLlmRouterFromEnv(), identity };
}
async function activity(db: QueryExecutor, input: ThesisRuntimeInput, stage: 'reading' | 'investigating' | 'found' | 'dismissed', summary: string) {
  return writeRunActivity(db, { user_id: input.userId, agent_id: input.agent.agent_id, stage, subject_refs: [input.thesis.subject_ref], summary, ts: new Date() });
}

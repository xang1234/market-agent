import type { AgentRow, QueryExecutor } from '../../agents/src/agent-repo.ts';
import type { AgentLoopStages } from '../../agents/src/agent-loop.ts';
import { getCurrentThesis, loadThesisHistory, recordThesisAssessment } from '../../agents/src/thesis-repo.ts';
import { evaluateThesis, THESIS_PROMPT_VERSION, type ThesisLlm } from '../../agents/src/thesis-evaluator.ts';
import { ThesisConflictError, type ThesisVersion, type ConditionAssessment, type ThesisAssessment } from '../../agents/src/thesis-types.ts';
import { generateThesisFinding } from './thesis-finding.ts';
import type { FindingRow } from '../../agents/src/finding-generator.ts';
import { writeRunActivity } from '../../observability/src/run-activity.ts';
import { hashJsonValue } from '../../observability/src/tool-call.ts';
import type { JsonValue } from '../../observability/src/types.ts';
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
// Every run uses a complete current packet, so amendments and removed evidence
// can change a condition even if the previous claim was already processed.
export function createThesisAgentLoopStages(input: ThesisRuntimeInput): AgentLoopStages {
  const asOf = new Date().toISOString();
  let packet: ThesisPacket = { claims: [], facts: [] };
  let inputHash = '';
  let packetHash = '';
  let evaluation: {
    results: ConditionAssessment[];
    model_version: string | null;
  };
  let cached: ThesisAssessment | null = null;
  const findings: FindingRow[] = [];
  return {
    async readDeltas() { return { thesis_version_id: input.thesis.thesis_version_id, as_of: asOf }; },
    async extractEvidence() {
      packet = await loadThesisPacket(input.db, { thesis: input.thesis, userId: input.userId, asOf });
      return { claims: packet.claims.length, facts: packet.facts.length };
    },
    async clusterEvidence() { return { conditions: input.thesis.conditions.length }; },
    async analyze() {
      const needsModel = packet.claims.length > 0 && input.thesis.conditions.some(c => !c.metric);
      const model = needsModel ? await (input.getModel ?? configuredModel)() : { llm: null, identity: 'deterministic' };
      packetHash = hashJsonValue({ version: input.thesis.thesis_version_id, packet, day: asOf.slice(0, 10), model: model.identity, prompt: THESIS_PROMPT_VERSION } as unknown as JsonValue);
      const history = await loadThesisHistory(input.db, { agent_id: input.agent.agent_id, user_id: input.userId });
      const previous = history.assessments.find(a => a.thesis_version_id === input.thesis.thesis_version_id);
      cached = previous?.input_hash.split('/')[0] === packetHash ? previous : null;
      inputHash = cached?.input_hash ?? `${packetHash}/${previous?.assessment_id ?? 'initial'}`;
      evaluation = cached ? { results: cached.results, model_version: cached.model_version } : await evaluateThesis({
        thesis: input.thesis, claims: packet.claims.map(c => ({ ...c })), facts: packet.facts, as_of: asOf, llm: model.llm,
      });
      return { results: evaluation.results, reused: cached !== null } as unknown as JsonValue;
    },
    async nextWatermarks({ current_watermarks }) {
      return { ...(current_watermarks as Record<string, JsonValue>), thesis_monitor: { thesis_version_id: input.thesis.thesis_version_id, last_checked_at: asOf, input_hash: inputHash } };
    },
    async applySideEffects({ tx }) {
      const lock = await tx.query('select agent_id from agents where agent_id=$1::uuid and user_id=$2::uuid for update', [input.agent.agent_id, input.userId]);
      if (!lock.rows.length)
        throw new Error('Thesis agent no longer exists');
      const latest = await getCurrentThesis(tx, input.agent.agent_id);
      if (latest?.thesis_version_id !== input.thesis.thesis_version_id)
        throw new ThesisConflictError('Thesis changed during assessment; run again to assess the new version.');
      // Repeat the uniqueness lookup under the agent lock to handle concurrent
      // scheduled/manual deliveries that evaluated the same packet.
      const history = await loadThesisHistory(tx, { agent_id: input.agent.agent_id, user_id: input.userId });
      const previous = history.assessments.find(a => a.thesis_version_id === input.thesis.thesis_version_id);
      cached = previous?.input_hash.split('/')[0] === packetHash ? previous : null;
      if (cached) {
        await activity(tx, input, 'dismissed', 'No new thesis changes: this evidence packet was already assessed.');
        return { findings: 0, assessments: 0, reused: true };
      }
      if (previous && Date.parse(previous.assessed_at) > Date.parse(asOf))
        throw new ThesisConflictError('A newer assessment finished during this run; run again.');
      const snapshot = await sealThesisPacket(tx, { thesis: input.thesis, packet, results: evaluation.results, asOf, modelVersion: evaluation.model_version, inputHash });
      await recordThesisAssessment(tx, {
        thesis_version_id: input.thesis.thesis_version_id, run_id: input.runId, snapshot_id: snapshot.snapshot_id,
        input_hash: inputHash, results: evaluation.results, model_version: evaluation.model_version, prompt_version: THESIS_PROMPT_VERSION,
      });
      for (const result of evaluation.results) {
        if (result.status === 'unresolved' || previous?.results.find(r => r.condition_id === result.condition_id)?.status === result.status)
          continue;
        findings.push(await generateThesisFinding(tx, {
          thesis: input.thesis, result, packet, agentName: input.agent.name, snapshot,
        }));
      }
      await activity(tx, input, 'reading', `Considered ${packet.claims.length} current claims and ${packet.facts.length} stored facts for the configured metrics.`);
      await activity(tx, input, 'investigating', `Assessed ${evaluation.results.length} saved conditions using ${evaluation.model_version ?? 'deterministic checks / missing-evidence handling'}.`);
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

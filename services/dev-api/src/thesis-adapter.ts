import { isDeepStrictEqual } from 'node:util';
import { getAgent, type QueryExecutor } from '../../agents/src/agent-repo.ts';
import { normalizeUniverseToIssuers } from '../../analyst-grids/src/subject-normalization.ts';
import { getCurrentThesis, loadThesisHistory, saveThesis } from '../../agents/src/thesis-repo.ts';
import { draftThesisConditions, type ThesisLlm } from '../../agents/src/thesis-evaluator.ts';
import { parseThesisConditions, parseThesisText, parseThesisExpectedVersion, type ThesisHistoryResponse, type ThesisMetricOption, ThesisConflictError, ThesisNotFoundError, ThesisValidationError } from '../../agents/src/thesis-types.ts';
import { createLlmRouterFromEnv } from '../../llm/src/settings-loader.ts';
import { DevApiHttpError } from './dev-api-shared.ts';
export type ThesisAdapter = {
  get(input: {
    userId: string;
    agentId: string;
  }): Promise<ThesisHistoryResponse>;
  save(input: {
    userId: string;
    agentId: string;
    body: Record<string, unknown>;
  }): Promise<{
    thesis: Awaited<ReturnType<typeof saveThesis>>;
  }>;
  draft(input: {
    userId: string;
    agentId: string;
    body: Record<string, unknown>;
  }): Promise<{
    conditions: ReturnType<typeof parseThesisConditions>;
  }>;
};
export function createThesisAdapter(db: QueryExecutor, getModel: () => Promise<ThesisLlm | null> = createLlmRouterFromEnv): ThesisAdapter {
  async function ownedAgent(userId: string, agentId: string) {
    const agent = await getAgent(db, agentId);
    if (!agent || agent.user_id !== userId)
      throw new DevApiHttpError(404, 'agent not found');
    return agent;
  }
  return {
    async get({ userId, agentId }) {
      const agent = await ownedAgent(userId, agentId);
      const history = await translateErrors(() => loadThesisHistory(db, { user_id: userId, agent_id: agentId }));
      let metrics: ThesisMetricOption[] = [];
      if (agent.universe.mode === 'static' && agent.universe.subject_refs.length === 1) {
        const [subject] = await normalizeUniverseToIssuers(db, agent.universe.subject_refs);
        if (subject?.kind === 'issuer') {
          const result = await db.query<ThesisMetricOption>(`select distinct m.metric_key,m.display_name as label,f.unit,f.period_kind
      from facts f join metrics m on m.metric_id=f.metric_id join sources s on s.source_id=f.source_id
      where f.subject_kind='issuer' and f.subject_id=$1::uuid and f.value_num is not null
       and f.invalidated_at is null and f.superseded_by is null and f.verification_status='authoritative'
       and f.entitlement_channels ? 'app' and (s.user_id is null or s.user_id=$2::uuid)
       and f.period_kind in ('point','fiscal_q','fiscal_y','ttm')
      order by m.display_name,f.unit,f.period_kind limit 200`, [subject.id, userId]);
          metrics = result.rows;
        }
      }
      return { ...history, metrics };
    },
    async save({ userId, agentId, body }) {
      const agent = await ownedAgent(userId, agentId);
      if (agent.universe.mode !== 'static' || agent.universe.subject_refs.length !== 1) {
        throw new DevApiHttpError(409, 'Thesis monitoring needs an agent with one company.');
      }
      const [subject] = await normalizeUniverseToIssuers(db, agent.universe.subject_refs);
      if (subject?.kind !== 'issuer')
        throw new DevApiHttpError(409, 'Choose a company before saving thesis conditions.');
      return translateErrors(async () => ({ thesis: await saveThesis(db, {
          agent_id: agentId, user_id: userId, expected_version: parseThesisExpectedVersion(body.expected_version),
          thesis: parseThesisText(body.thesis), subject_ref: { kind: 'issuer', id: subject.id },
          conditions: parseThesisConditions(body.conditions),
        }) }));
    },
    async draft({ userId, agentId, body }) {
      await ownedAgent(userId, agentId);
      const text = await translateErrors(async () => parseThesisText(body.thesis));
      try {
        const model = await getModel();
        if (!model)
          throw new DevApiHttpError(503, 'Configure a model in Settings to suggest conditions, or write your own.');
        return { conditions: await draftThesisConditions(model, text) };
      }
      catch (error) {
        if (error instanceof DevApiHttpError)
          throw error;
        throw new DevApiHttpError(503, 'Condition suggestions are unavailable. Try again or write your own conditions.');
      }
    },
  };
}
export async function assertLegacyThesisEditAllowed(db: QueryExecutor, agentId: string, body: Record<string, unknown>) {
  if (body.thesis === undefined && body.universe === undefined)
    return;
  const thesis = await getCurrentThesis(db, agentId);
  if (!thesis)
    return;
  const agent = await getAgent(db, agentId);
  if ((body.thesis !== undefined && body.thesis !== thesis.thesis)
    || (body.universe !== undefined && !isDeepStrictEqual(body.universe, agent?.universe))) {
    throw new DevApiHttpError(409, 'Edit this thesis in Thesis conditions. Create another agent to monitor a different company.');
  }
}
async function translateErrors<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  }
  catch (error) {
    if (error instanceof ThesisValidationError)
      throw new DevApiHttpError(400, error.message);
    if (error instanceof ThesisConflictError)
      throw new DevApiHttpError(409, error.message);
    if (error instanceof ThesisNotFoundError)
      throw new DevApiHttpError(404, 'agent not found');
    throw error;
  }
}

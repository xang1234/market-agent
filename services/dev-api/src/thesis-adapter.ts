import { isDeepStrictEqual } from 'node:util';
import { getAgent, type QueryExecutor } from '../../agents/src/agent-repo.ts';
import { normalizeUniverseToIssuers } from '../../analyst-grids/src/subject-normalization.ts';
import { getCurrentThesis, loadThesisHistory, saveThesis } from '../../agents/src/thesis-repo.ts';
import { draftThesisConditions, type ThesisLlm } from '../../agents/src/thesis-evaluator.ts';
import { statesStance } from '../../chat/src/analyst-agent.ts';
import { parseThesisConditions, parseThesisText, parseThesisExpectedVersion, type ThesisAssessment, type ThesisHistoryResponse, type ThesisMetricOption, ThesisConflictError, ThesisNotFoundError, ThesisValidationError } from '../../agents/src/thesis-types.ts';
import { LlmRouterError } from '../../llm/src/router.ts';
import { createLlmRouterFromEnv } from '../../llm/src/settings-loader.ts';
import { DevApiHttpError } from './dev-api-shared.ts';
export type ThesisAdapter = {
  get(input: {
    userId: string;
    agentId: string;
  }): Promise<ThesisHistoryResponse & { ref_labels: Record<string, string> }>;
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
       and f.invalidated_at is null and f.superseded_by is null and f.method<>'restated' and f.verification_status='authoritative'
       and f.entitlement_channels ? 'app' and (s.user_id is null or s.user_id=$2::uuid)
       and f.period_kind in ('point','fiscal_q','fiscal_y','ttm')
      order by m.display_name,f.unit,f.period_kind limit 200`, [subject.id, userId]);
          metrics = result.rows;
        }
      }
      const cited = (key: 'fact_refs' | 'claim_refs') => [...new Set(history.assessments.flatMap(assessment => assessment.results.flatMap(result => result[key])))];
      const { rows: labels } = await db.query<{ id: string; label: string }>(`select f.fact_id::text as id,
          concat_ws(' ', m.display_name, case when f.fiscal_year is null then coalesce(f.period_end, f.as_of::date)::text
            when f.fiscal_period = 'FY' then 'FY' || f.fiscal_year
            else concat_ws(' ', f.fiscal_period, 'FY' || f.fiscal_year) end) as label
        from facts f join metrics m on m.metric_id = f.metric_id where f.fact_id = any($1::uuid[])
       union all
       select claim_id::text, predicate || ' · ' || case when length(text_canonical) > 48 then left(text_canonical, 47) || '…' else text_canonical end
         from claims where claim_id = any($2::uuid[])`, [cited('fact_refs'), cited('claim_refs')]);
      return { ...history, assessments: history.assessments.map(withoutModelReasons), metrics, ref_labels: Object.fromEntries(labels.map(row => [row.id, row.label])) };
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
        // Drafted conditions are the model's words saved as the thesis, so none may state a stance (ADR 0005).
        const conditions = (await draftThesisConditions(model, text)).filter(condition => ![condition.statement, condition.falsifier, condition.horizon].some(statesStance));
        if (conditions.length === 0)
          throw new DevApiHttpError(503, 'Every suggested condition stated a rating or recommendation, so none is shown. Try again or write your own conditions.');
        return { conditions };
      }
      catch (error) {
        if (error instanceof DevApiHttpError)
          throw error;
        console.error(`thesis draft failed for agent ${agentId}:`, draftFailureDetail(error));
        throw new DevApiHttpError(503, 'Condition suggestions are unavailable. Try again or write your own conditions.');
      }
    },
  };
}
const MODEL_WRITTEN_REASON_PROMPT_VERSION = 'living-thesis-v1';
const OLDER_MODEL_REASON = 'An older assessment. Its model-written reason is not shown.';
function withoutModelReasons(assessment: ThesisAssessment): ThesisAssessment {
  if (assessment.prompt_version !== MODEL_WRITTEN_REASON_PROMPT_VERSION)
    return assessment;
  return { ...assessment, results: assessment.results.map(result => (result.method === 'model' ? { ...result, reason: OLDER_MODEL_REASON } : result)) };
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
function draftFailureDetail(error: unknown): unknown {
  if (!(error instanceof LlmRouterError))
    return error;
  const attempts = error.attempts.map(({ deployment, code, message }) => `${deployment.channel}/${deployment.model} ${code}: ${message}`);
  return `${error.message} (${attempts.join('; ')})`;
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

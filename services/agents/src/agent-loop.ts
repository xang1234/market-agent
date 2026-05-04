import type { JsonObject, JsonValue } from "../../observability/src/types.ts";
import type { QueryExecutor } from "./agent-repo.ts";
import {
  evaluateAgentAlerts,
  type EvaluateAgentAlertsResult,
} from "./alert-evaluator.ts";
import type { FindingRow } from "./finding-generator.ts";
import {
  advanceWatermarksWithSideEffectsWithPool,
  type AgentWatermarkClientPool,
} from "./watermarks.ts";

export type AgentLoopStageContext<
  Deltas = JsonValue,
  Evidence = JsonValue,
  Clusters = JsonValue,
  Analysis = JsonValue,
> = {
  agent_id: string;
  current_watermarks: JsonValue;
  deltas: Deltas;
  evidence: Evidence;
  clusters: Clusters;
  analysis: Analysis;
};

export type AgentLoopStages<
  Deltas = JsonValue,
  Evidence = JsonValue,
  Clusters = JsonValue,
  Analysis = JsonValue,
> = {
  readDeltas(context: Pick<AgentLoopStageContext<Deltas, Evidence, Clusters, Analysis>, "agent_id" | "current_watermarks">): Promise<Deltas>;
  extractEvidence(context: Pick<AgentLoopStageContext<Deltas, Evidence, Clusters, Analysis>, "agent_id" | "current_watermarks" | "deltas">): Promise<Evidence>;
  clusterEvidence(context: Pick<AgentLoopStageContext<Deltas, Evidence, Clusters, Analysis>, "agent_id" | "current_watermarks" | "deltas" | "evidence">): Promise<Clusters>;
  analyze(context: Pick<AgentLoopStageContext<Deltas, Evidence, Clusters, Analysis>, "agent_id" | "current_watermarks" | "deltas" | "evidence" | "clusters">): Promise<Analysis>;
  nextWatermarks(context: AgentLoopStageContext<Deltas, Evidence, Clusters, Analysis>): Promise<JsonValue>;
  applySideEffects(context: AgentLoopStageContext<Deltas, Evidence, Clusters, Analysis> & { tx: QueryExecutor }): Promise<JsonValue>;
  alertFindings?(
    context: AgentLoopStageContext<Deltas, Evidence, Clusters, Analysis> & {
      tx: QueryExecutor;
      outputs_summary: JsonValue;
    },
  ): Promise<ReadonlyArray<FindingRow>>;
};

export type RunAgentLoopInput<
  Deltas = JsonValue,
  Evidence = JsonValue,
  Clusters = JsonValue,
  Analysis = JsonValue,
> = {
  pool: AgentWatermarkClientPool;
  agent_id: string;
  run_id?: string;
  alert_rules?: ReadonlyArray<unknown>;
  current_watermarks: JsonValue;
  stages: AgentLoopStages<Deltas, Evidence, Clusters, Analysis>;
};

export type AgentLoopResult = {
  outputs_summary: JsonValue;
  next_watermarks: JsonValue;
};

export async function runAgentLoop<
  Deltas = JsonValue,
  Evidence = JsonValue,
  Clusters = JsonValue,
  Analysis = JsonValue,
>(
  input: RunAgentLoopInput<Deltas, Evidence, Clusters, Analysis>,
): Promise<AgentLoopResult> {
  const deltas = await input.stages.readDeltas({
    agent_id: input.agent_id,
    current_watermarks: input.current_watermarks,
  });
  const evidence = await input.stages.extractEvidence({
    agent_id: input.agent_id,
    current_watermarks: input.current_watermarks,
    deltas,
  });
  const clusters = await input.stages.clusterEvidence({
    agent_id: input.agent_id,
    current_watermarks: input.current_watermarks,
    deltas,
    evidence,
  });
  const analysis = await input.stages.analyze({
    agent_id: input.agent_id,
    current_watermarks: input.current_watermarks,
    deltas,
    evidence,
    clusters,
  });
  const context = {
    agent_id: input.agent_id,
    current_watermarks: input.current_watermarks,
    deltas,
    evidence,
    clusters,
    analysis,
  };
  const nextWatermarks = await input.stages.nextWatermarks(context);
  let outputsSummary: JsonValue = {};

  await advanceWatermarksWithSideEffectsWithPool(input.pool, {
    agent_id: input.agent_id,
    next_watermarks: nextWatermarks,
    applySideEffects: async (tx) => {
      outputsSummary = await input.stages.applySideEffects({ ...context, tx });
      if (input.run_id && input.alert_rules && input.alert_rules.length > 0 && input.stages.alertFindings) {
        const alertResult = await evaluateAgentAlerts(tx, {
          agent_id: input.agent_id,
          run_id: input.run_id,
          alert_rules: input.alert_rules,
          findings: await input.stages.alertFindings({
            ...context,
            tx,
            outputs_summary: outputsSummary,
          }),
        });
        outputsSummary = withAlertSummary(outputsSummary, alertResult);
      }
    },
  });

  return Object.freeze({
    outputs_summary: outputsSummary,
    next_watermarks: nextWatermarks,
  });
}

function withAlertSummary(
  outputsSummary: JsonValue,
  alertResult: EvaluateAgentAlertsResult,
): JsonValue {
  const alerts = {
    evaluated_rules: alertResult.evaluated_rules,
    evaluated_findings: alertResult.evaluated_findings,
    fired: alertResult.fired.length,
  } satisfies JsonObject;

  if (outputsSummary !== null && typeof outputsSummary === "object" && !Array.isArray(outputsSummary)) {
    return Object.freeze({
      ...outputsSummary,
      alerts,
    });
  }

  return Object.freeze({
    outputs_summary: outputsSummary,
    alerts,
  });
}

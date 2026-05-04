import type { JsonValue } from "../../observability/src/types.ts";
import type { QueryExecutor } from "./agent-repo.ts";
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
};

export type RunAgentLoopInput<
  Deltas = JsonValue,
  Evidence = JsonValue,
  Clusters = JsonValue,
  Analysis = JsonValue,
> = {
  pool: AgentWatermarkClientPool;
  agent_id: string;
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
    },
  });

  return Object.freeze({
    outputs_summary: outputsSummary,
    next_watermarks: nextWatermarks,
  });
}

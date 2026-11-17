import assert from "node:assert/strict";
import type { Pool } from "pg";

import { runAgentLoop, type RunAgentLoopInput } from "../../agents/src/agent-loop.ts";
import { claimAgentRun, completeAgentRun, failAgentRun } from "../../agents/src/agent-run-repo.ts";

export async function runClaimedAgentLoop<Deltas, Evidence, Clusters, Analysis>(
  input: RunAgentLoopInput<Deltas, Evidence, Clusters, Analysis> & { pool: Pool },
) {
  const claim = await claimAgentRun(input.pool, { run_id: input.run_id, agent_id: input.agent_id });
  assert.ok(claim.claimed, `run ${input.run_id} could not claim agent ${input.agent_id}`);
  try {
    const result = await runAgentLoop(input);
    await completeAgentRun(input.pool, { run_id: input.run_id, outputs_summary: result.outputs_summary });
    return result;
  } catch (error) {
    await failAgentRun(input.pool, { run_id: input.run_id, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

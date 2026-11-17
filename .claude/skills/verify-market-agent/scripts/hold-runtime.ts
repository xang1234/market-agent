// dev-api's runtime module for `verify lease-race`: local-runtime.ts, except that the first
// run of the agent named in .dev/lease-hold/hold to finish analyze renames that file to
// held-<run id> and waits until .dev/lease-hold/release appears, for at most five minutes.
import { existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import type { DevApiAgentLoopStageFactory } from "../../../../services/dev-api/src/http.ts";
import { createAgentLoopStages as localAgentLoopStages } from "../../../../services/dev-api/src/local-runtime.ts";

export * from "../../../../services/dev-api/src/local-runtime.ts";

const HOLD_DIR = join(import.meta.dirname, "../../../../.dev/lease-hold");
const HOLD_LIMIT_MS = 5 * 60_000;

export const createAgentLoopStages: DevApiAgentLoopStageFactory = async (input) => {
  const stages = await localAgentLoopStages(input);
  const analyze = stages.analyze;
  return {
    ...stages,
    async analyze(context) {
      const analysis = await analyze(context);
      if (takeHold(input.agent.agent_id, input.runId)) {
        for (const deadline = Date.now() + HOLD_LIMIT_MS; Date.now() < deadline && !existsSync(join(HOLD_DIR, "release"));) await sleep(100);
      }
      return analysis;
    },
  };
};

function takeHold(agentId: string, runId: string): boolean {
  try {
    if (readFileSync(join(HOLD_DIR, "hold"), "utf8") !== agentId) return false;
    renameSync(join(HOLD_DIR, "hold"), join(HOLD_DIR, `held-${runId}`));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

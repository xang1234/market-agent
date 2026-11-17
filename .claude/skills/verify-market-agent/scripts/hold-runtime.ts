// dev-api's runtime module for `verify lease-race`: local-runtime.ts, except that the
// first agent run to finish analyze while .dev/lease-hold/hold exists renames it to
// held-<run id> and waits there until .dev/lease-hold/release appears.
import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import type { DevApiAgentLoopStageFactory } from "../../../../services/dev-api/src/http.ts";
import { createAgentLoopStages as localAgentLoopStages } from "../../../../services/dev-api/src/local-runtime.ts";

export * from "../../../../services/dev-api/src/local-runtime.ts";

const HOLD_DIR = join(import.meta.dirname, "../../../../.dev/lease-hold");

export const createAgentLoopStages: DevApiAgentLoopStageFactory = async (input) => {
  const stages = await localAgentLoopStages(input);
  const analyze = stages.analyze;
  return {
    ...stages,
    async analyze(context) {
      const analysis = await analyze(context);
      if (takeHold(input.runId)) {
        while (!existsSync(join(HOLD_DIR, "release"))) await sleep(100);
      }
      return analysis;
    },
  };
};

function takeHold(runId: string): boolean {
  try {
    renameSync(join(HOLD_DIR, "hold"), join(HOLD_DIR, `held-${runId}`));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

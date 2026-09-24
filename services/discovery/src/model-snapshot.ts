import type { CampaignModel } from "./ports.ts";
import { DiscoveryError, type ModelConfigSnapshot } from "./types.ts";

/** Refuses to accept output from a deployment outside the run's immutable model snapshot. */
export function bindModelSnapshot(model: CampaignModel, modelConfig: readonly ModelConfigSnapshot[]): CampaignModel {
  return Object.freeze({
    async complete(request) {
      const allowed = modelConfig.filter((entry) => entry.role === request.role);
      if (allowed.length === 0) throw new DiscoveryError("unavailable", `run model snapshot has no ${request.role} deployment`);
      const result = await model.complete(request);
      if (!allowed.some((entry) => entry.provider === result.deployment.channel && entry.model === result.deployment.model)) {
        throw new DiscoveryError("unavailable", `${request.role} deployment does not match the run model snapshot`);
      }
      return result;
    },
  });
}

import type { ControlledRouter } from "../../llm/src/router.ts";
import type { CampaignModel, OperationRunner } from "./ports.ts";
import { DiscoveryError, type ModelConfigSnapshot } from "./types.ts";
import { validateModelRequest } from "./validation.ts";

const MODEL_OUTPUT_TOKENS = 10_000;

export function createCampaignModel(router: ControlledRouter, operations: OperationRunner, modelConfig?: readonly ModelConfigSnapshot[]): CampaignModel {
  return Object.freeze({
    async complete(input) {
      const roleConfig = modelConfig?.filter((entry) => entry.role === input.role);
      if (roleConfig !== undefined && roleConfig.length === 0) throw new DiscoveryError("unavailable", `run model snapshot has no ${input.role} deployment`);
      const outputTokens = roleConfig === undefined ? MODEL_OUTPUT_TOKENS : Math.min(...roleConfig.map((entry) => entry.max_output_tokens));
      validateModelRequest(input.messages, outputTokens);
      requireInitialRoleReservation(input);
      const firstIndex = input.attempt_number === 2 ? 1 : 0;
      return router.complete(
        { messages: input.messages, maxTokens: outputTokens },
        {
          maxAttempts: 2 - firstIndex,
          deploymentOrder: roleConfig?.map((entry) => ({ channel: entry.provider, model: entry.model })),
          executeAttempt: async (attempt, dispatch) => {
            const index = (firstIndex + attempt.index) as 0 | 1;
            return operations.providerAttempt({
              key: input.operation_key,
              request_hash: input.request_hash,
              index,
              resource: "model",
              phase: input.phase,
              candidate_id: input.candidate_id,
              model_initial: input.model_initial === true && index === 0,
              model_role: input.model_initial === true && index === 0 && (input.role === "analyst" || input.role === "skeptic") ? input.role : undefined,
              execute: async (signal) => dispatch(signal),
            });
          },
        },
      );
    },
  });
}

function requireInitialRoleReservation(input: Parameters<CampaignModel["complete"]>[0]): void {
  const initialRole = input.attempt_number !== 2 && (input.role === "analyst" || input.role === "skeptic");
  if (initialRole && (input.model_initial !== true || input.phase !== "research" || input.candidate_id === undefined)) {
    throw new DiscoveryError("validation", "initial analyst and skeptic calls require a selected candidate reservation");
  }
  if (!initialRole && input.model_initial === true) {
    throw new DiscoveryError("validation", "only first analyst and skeptic calls may reserve an initial model slot");
  }
}

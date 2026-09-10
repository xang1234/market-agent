import type { ControlledRouter } from "../../llm/src/router.ts";
import type { CampaignModel, OperationRunner } from "./ports.ts";
import { DiscoveryError } from "./types.ts";
import { validateModelRequest } from "./validation.ts";

const MODEL_OUTPUT_TOKENS = 10_000;

export function createCampaignModel(router: ControlledRouter, operations: OperationRunner): CampaignModel {
  return Object.freeze({
    async complete(input) {
      validateModelRequest(input.messages, MODEL_OUTPUT_TOKENS);
      requireInitialRoleReservation(input);
      const firstIndex = input.attempt_number === 2 ? 1 : 0;
      return router.complete(
        { messages: input.messages, maxTokens: MODEL_OUTPUT_TOKENS },
        {
          maxAttempts: 2 - firstIndex,
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

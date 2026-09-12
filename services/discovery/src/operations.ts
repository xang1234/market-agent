import { abortError, attemptSignal, storedError } from "./budget.ts";
import type { DiscoveryRepository, Lease, OperationContext, OperationRunner } from "./ports.ts";
import { DiscoveryError } from "./types.ts";

type RunInput<T> = {
  key: string;
  request_hash: string;
  resource: "search" | "document" | "identity" | "financial" | "model";
  phase: "discovery" | "research" | "verification";
  candidate_id?: string;
  model_initial?: boolean;
  model_role?: "analyst" | "skeptic";
  execute: (context: OperationContext) => Promise<T>;
};

type ProviderAttemptInput<T> = {
  key: string;
  request_hash: string;
  index: 0 | 1;
  resource: "model";
  phase: "discovery" | "research" | "verification";
  candidate_id?: string;
  model_initial?: boolean;
  model_role?: "analyst" | "skeptic";
  execute: (signal: AbortSignal) => Promise<T>;
};

export function createOperationRunner(repo: DiscoveryRepository, lease: Lease, signal: AbortSignal): OperationRunner {
  async function signalForAttempt(): Promise<AbortSignal> {
    const run = await repo.readRun(lease.user_id, lease.run_id);
    return attemptSignal(signal, run.limits.request_timeout_ms);
  }

  return Object.freeze({
    async run<T>(input: RunInput<T>): Promise<T> {
      for (const attempt_number of [1, 2] as const) {
        throwIfAborted(signal);
        const reservation = await repo.reserveAttempt(lease, {
          operation_key: input.key,
          request_hash: input.request_hash,
          resource: input.resource,
          phase: input.phase,
          candidate_id: input.candidate_id,
          attempt_number,
          model_initial: input.model_initial === true && attempt_number === 1,
          model_role: input.model_initial === true && attempt_number === 1 ? input.model_role : undefined,
        });
        if (reservation.state === "cached") return reservation.result as T;
        if (reservation.state === "in_progress") throw inProgress(input.key);
        if (reservation.state === "exhausted") {
          if (attempt_number === 2) throw exhausted(input.key);
          continue;
        }

        const attemptSignal = await signalForAttempt();
        try {
          const result = await input.execute({ signal: attemptSignal, attempt_number });
          throwIfAborted(attemptSignal);
          await repo.finishAttempt(lease, {
            attempt_id: reservation.attempt_id,
            outcome: "success",
            result,
            tool_call_id: null,
          });
          return result;
        } catch (error) {
          await repo.finishAttempt(lease, {
            attempt_id: reservation.attempt_id,
            outcome: "error",
            result: storedError(error),
            tool_call_id: null,
          });
          if (signal.aborted || attempt_number === 2) throw error;
        }
      }
      throw exhausted(input.key);
    },
    async providerAttempt<T>(input: ProviderAttemptInput<T>): Promise<T> {
      throwIfAborted(signal);
      let reservation = await repo.reserveAttempt(lease, {
        operation_key: input.key,
        request_hash: input.request_hash,
        resource: input.resource,
        phase: input.phase,
        candidate_id: input.candidate_id,
        attempt_number: (input.index + 1) as 1 | 2,
        model_initial: input.model_initial,
        model_role: input.model_initial === true ? input.model_role : undefined,
      });
      if (reservation.state === "exhausted" && input.index === 0) {
        reservation = await repo.reserveAttempt(lease, {
          operation_key: input.key,
          request_hash: input.request_hash,
          resource: input.resource,
          phase: input.phase,
          candidate_id: input.candidate_id,
          attempt_number: 2,
        });
      }
      if (reservation.state === "cached") return reservation.result as T;
      if (reservation.state === "in_progress") throw inProgress(input.key);
      if (reservation.state === "exhausted") throw exhausted(input.key);

      const attemptSignal = await signalForAttempt();
      try {
        const result = await input.execute(attemptSignal);
        throwIfAborted(attemptSignal);
        await repo.finishAttempt(lease, {
          attempt_id: reservation.attempt_id,
          outcome: "success",
          result,
          tool_call_id: modelToolCallId(result),
        });
        return result;
      } catch (error) {
        await repo.finishAttempt(lease, {
          attempt_id: reservation.attempt_id,
          outcome: "error",
          result: storedError(error),
          tool_call_id: null,
        });
        throw error;
      }
    },
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal);
}

function exhausted(key: string): DiscoveryError {
  return new DiscoveryError("budget_exhausted", `operation attempts are exhausted for ${key}`);
}

function inProgress(key: string): DiscoveryError {
  return new DiscoveryError("operation_in_progress", `operation is already in progress for ${key}`);
}

/** Provider transports may return the already-audited tool-call id with a model response. */
function modelToolCallId(result: unknown): string | null {
  if (typeof result !== "object" || result === null || !("tool_call_id" in result)) return null;
  const value = (result as { tool_call_id?: unknown }).tool_call_id;
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
    ? value
    : null;
}

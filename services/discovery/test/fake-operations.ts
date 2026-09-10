import type { OperationRunner } from "../src/ports.ts";

type Entry = { request_hash: string; state: "success" | "error"; result: unknown; at: Date };
type Options = { signal?: AbortSignal; now?: () => Date };

export function fakeOperations(options: Options = {}) {
  const signal = options.signal ?? new AbortController().signal;
  const now = options.now ?? (() => new Date());
  const ledger = new Map<string, Entry>();
  const providerAttempts: Array<{ key: string; index: 0 | 1; request_hash: string; at: Date }> = [];

  function prior(key: string, request_hash: string): Entry | undefined {
    const entry = ledger.get(key);
    if (entry !== undefined && entry.request_hash !== request_hash) {
      throw new Error("operation key was used with a different request");
    }
    return entry;
  }

  const operations: OperationRunner = {
    async run(input) {
      for (const attempt_number of [1, 2] as const) {
        const key = `${input.key}/${attempt_number}`;
        const entry = prior(key, input.request_hash);
        if (entry?.state === "success") return entry.result as typeof input extends { execute: (...args: never[]) => Promise<infer T> } ? T : never;
        try {
          const result = await input.execute({ signal, attempt_number });
          ledger.set(key, { request_hash: input.request_hash, state: "success", result, at: now() });
          return result;
        } catch (error) {
          ledger.set(key, { request_hash: input.request_hash, state: "error", result: error, at: now() });
          if (attempt_number === 2) throw error;
        }
      }
      throw new Error("operation attempts are exhausted");
    },
    async providerAttempt(input) {
      const key = `${input.key}/${input.index + 1}`;
      const entry = prior(key, input.request_hash);
      if (entry?.state === "success") return entry.result as typeof input extends { execute: (...args: never[]) => Promise<infer T> } ? T : never;
      providerAttempts.push({ key: input.key, index: input.index, request_hash: input.request_hash, at: now() });
      try {
        const result = await input.execute(signal);
        ledger.set(key, { request_hash: input.request_hash, state: "success", result, at: now() });
        return result;
      } catch (error) {
        ledger.set(key, { request_hash: input.request_hash, state: "error", result: error, at: now() });
        throw error;
      }
    },
  };

  return { operations, providerAttempts, ledger };
}

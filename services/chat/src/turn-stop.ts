import { AsyncLocalStorage } from "node:async_hooks";

import { withLlmAbortSignal } from "../../llm/src/router.ts";

// Where a turn stands against a stop. Its answer's save is the line: a stop
// before it ends the turn stopped with nothing saved, and once a save has begun
// a stop is refused and the turn ends as the save does.
export type TurnStopState = "running" | "saving" | "stopped";

export class ChatTurnStoppedError extends Error {
  constructor() {
    super("the turn was stopped");
    this.name = "ChatTurnStoppedError";
  }
}

const current = new AsyncLocalStorage<TurnStop>();

export class TurnStop {
  #state: TurnStopState = "running";
  readonly #controller = new AbortController();

  get state(): TurnStopState {
    return this.#state;
  }

  /** Stops the turn unless its answer is being saved, and aborts the model calls it made; returns the state after. */
  stop(): TurnStopState {
    if (this.#state === "running") {
      this.#state = "stopped";
      this.#controller.abort(new ChatTurnStoppedError());
    }
    return this.#state;
  }

  /** Runs `fn` as the turn: the saves and routed model calls it makes, and the work it starts, answer to this stop. */
  run<T>(fn: () => T): T {
    return current.run(this, () => withLlmAbortSignal(this.#controller.signal, fn));
  }

  claimSave(): boolean {
    if (this.#state === "stopped") return false;
    this.#state = "saving";
    return true;
  }
}

/**
 * Call right before a turn writes its assistant message, and write only on true:
 * false means the turn was stopped. Outside a turn it is always true.
 */
export function claimAnswerSave(): boolean {
  return current.getStore()?.claimSave() ?? true;
}

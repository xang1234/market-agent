import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as delay } from "node:timers/promises";

import { withRequestStop, type RequestStop } from "../../financial-engine/src/request.ts";
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

// ponytail: a release that has not settled by then stops holding the thread's
// next turn back, which may then find the calculation still leased.
const RELEASE_WAIT_MS = 10_000;

export class TurnStop implements RequestStop {
  #state: TurnStopState = "running";
  readonly #controller = new AbortController();
  readonly #releases = new Set<() => Promise<void>>();
  #released: Promise<void> = Promise.resolve();

  get state(): TurnStopState {
    return this.#state;
  }

  get stopped(): boolean {
    return this.#state === "stopped";
  }

  /** Settles once what the stop released is free for the next turn (at most RELEASE_WAIT_MS after it). */
  get released(): Promise<void> {
    return this.#released;
  }

  onStop(release: () => Promise<void>): () => void {
    this.#releases.add(release);
    return () => this.#releases.delete(release);
  }

  /** Stops the turn unless its answer is being saved, aborts the model calls it made, and releases its calculations; returns the state after. */
  stop(): TurnStopState {
    if (this.#state === "running") {
      this.#state = "stopped";
      this.#controller.abort(new ChatTurnStoppedError());
      this.#released = Promise.race([
        Promise.allSettled([...this.#releases].map((release) => release())).then(() => undefined),
        delay(RELEASE_WAIT_MS, undefined, { ref: false }),
      ]);
    }
    return this.#state;
  }

  /** Runs `fn` as the turn: the saves, routed model calls and financial requests it makes, and the work it starts, answer to this stop. */
  run<T>(fn: () => T): T {
    return current.run(this, () => withRequestStop(this, () => withLlmAbortSignal(this.#controller.signal, fn)));
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

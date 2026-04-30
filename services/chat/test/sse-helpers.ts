import type { TestContext } from "node:test";
import type { AddressInfo } from "node:net";

import { createChatServer } from "../src/http.ts";

export type ParsedSseEvent = {
  id: string | null;
  event: string | null;
  data: Record<string, unknown>;
};

export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

export function parseSseEvents(transcript: string): ParsedSseEvent[] {
  // SSE frames terminate with a blank line ("\n\n"). When the transcript
  // ends mid-frame (chunked reads in resume tests), the trailing block has
  // no terminator and may contain a partial `data:` line that fails JSON
  // parsing. Drop it instead of throwing.
  const blocks = transcript.split("\n\n");
  const completeBlocks = transcript.endsWith("\n\n") ? blocks : blocks.slice(0, -1);

  return completeBlocks
    .filter((block) => block.trim() !== "")
    .map((block) => {
      const event: ParsedSseEvent = { id: null, event: null, data: {} };
      for (const line of block.split("\n")) {
        if (line.startsWith("id: ")) event.id = line.slice("id: ".length);
        else if (line.startsWith("event: ")) event.event = line.slice("event: ".length);
        else if (line.startsWith("data: ")) {
          event.data = JSON.parse(line.slice("data: ".length)) as Record<string, unknown>;
        }
      }
      return event;
    });
}

export async function startChatTestServer(
  t: TestContext,
  options: Parameters<typeof createChatServer>[0] = {},
): Promise<string> {
  const server = createChatServer(options);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

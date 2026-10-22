import { readFile } from "node:fs/promises";

import type { LlmChatClient } from "./router.ts";

// Recorded model replies for offline tests and no-keys development. Opt-in only,
// via LLM_REPLAY_FILE: a JSON file `{ "replies": [{ "match": "...", "text": "..." }] }`.
// The first reply whose `match` appears in the request's messages answers it;
// a list of substrings matches only a request holding every one.
// ponytail: substring matching, no request hashing; add exact keys if replies collide.
export type LlmReplayFixture = {
  replies: ReadonlyArray<{ match: string | ReadonlyArray<string>; text: string }>;
};

export async function createReplayLlmChatClient(path: string): Promise<LlmChatClient> {
  const fixture = JSON.parse(await readFile(path, "utf8")) as Partial<LlmReplayFixture>;
  if (!Array.isArray(fixture.replies)) {
    throw new Error(`LLM_REPLAY_FILE ${path} must contain a "replies" array`);
  }
  const replies = fixture.replies;
  return (_deployment, request) => {
    const transcript = request.messages.map((message) => message.content).join("\n");
    const reply = replies.find(({ match }) => {
      const parts = [match].flat();
      // An empty list holds no substring to match, so it answers nothing.
      return parts.length > 0 && parts.every((part) => transcript.includes(part));
    });
    if (!reply) {
      throw new Error(`LLM replay: no recorded reply matches this request (${path})`);
    }
    return { text: reply.text };
  };
}

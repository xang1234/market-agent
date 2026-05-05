import test from "node:test";
import assert from "node:assert/strict";
import { createThreadTitleGenerationJob } from "../src/thread-title.ts";
import type { ChatThreadsDb } from "../src/threads-repo.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const THREAD_ID = "22222222-2222-4222-8222-222222222222";

test("thread title generation job writes the generated title to chat_threads", async () => {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const db: ChatThreadsDb = {
    async query(text, values) {
      queries.push({ text, values });
      if (/select title/i.test(text)) {
        return { rows: [{ title: null }] };
      }
      return {
        rows: [
          {
            thread_id: THREAD_ID,
            user_id: USER_ID,
            primary_subject_kind: null,
            primary_subject_id: null,
            title: values?.[2],
            latest_snapshot_id: null,
            archived_at: null,
            created_at: "2026-04-22T20:00:00.000Z",
            updated_at: "2026-04-22T20:00:01.000Z",
          },
        ],
      };
    },
  };
  const job = createThreadTitleGenerationJob({
    db,
    model: async () => "Apple Earnings Rally",
  });

  await job({
    threadId: THREAD_ID,
    runId: "run-1",
    turnId: "turn-1",
    userId: USER_ID,
    userIntent: "what happened after earnings?",
    assistantText: "Apple shares rallied after earnings.",
  });

  assert.match(queries[0].text, /select title/);
  assert.deepEqual(queries[0].values, [USER_ID, THREAD_ID]);
  assert.match(queries[1].text, /update chat_threads/);
  assert.match(queries[1].text, /title is null/);
  assert.deepEqual(queries[1].values, [USER_ID, THREAD_ID, "Apple Earnings Rally"]);
});

test("thread title generation job does not call the model when a title already exists", async () => {
  let modelCalls = 0;
  const db: ChatThreadsDb = {
    async query() {
      return { rows: [{ title: "User edited title" }] };
    },
  };
  const job = createThreadTitleGenerationJob({
    db,
    model: async () => {
      modelCalls++;
      return "Generated title";
    },
  });

  await job({
    threadId: THREAD_ID,
    runId: "run-1",
    turnId: "turn-1",
    userId: USER_ID,
    assistantText: "Apple shares rallied after earnings.",
  });

  assert.equal(modelCalls, 0);
});

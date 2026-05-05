import {
  generateThreadTitle,
  type ThreadTitleModel,
} from "../../summary/src/title-generator.ts";
import type { ChatThreadTitleGenerator } from "./coordinator.ts";
import {
  type ChatThreadsDb,
} from "./threads-repo.ts";

export type CreateThreadTitleGenerationJobInput = {
  db: ChatThreadsDb;
  model: ThreadTitleModel;
};

export function createThreadTitleGenerationJob(
  input: CreateThreadTitleGenerationJobInput,
): ChatThreadTitleGenerator {
  return async (job) => {
    if (!job.userId) return;
    const existing = await input.db.query<{ title: string | null }>(
      `select title
         from chat_threads
        where user_id = $1::uuid
          and thread_id = $2::uuid`,
      [job.userId, job.threadId],
    );
    if (!existing.rows[0] || existing.rows[0].title != null) return;

    const title = await generateThreadTitle({
      userIntent: job.userIntent,
      assistantText: job.assistantText,
      model: input.model,
    });
    await input.db.query(
      `update chat_threads
          set title = $3,
              updated_at = now()
        where user_id = $1::uuid
          and thread_id = $2::uuid
          and title is null`,
      [job.userId, job.threadId, title],
    );
  };
}

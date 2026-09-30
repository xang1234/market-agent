import type { Server } from "node:http";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { createChatServer } from "./http.ts";
import { loadChatServerOptionsFromEnv } from "./runtime.ts";
import { createThreadTitleGenerationJob } from "./thread-title.ts";
import {
  createLiveRunActivity,
  createRunActivityHub,
  writeAndPublishRunActivity,
} from "../../observability/src/run-activity.ts";

const SERVICE_DIR = fileURLToPath(new URL("..", import.meta.url));

// The chat dev server, unlistened, so it can run alone (dev.ts) or inside the
// one-process dev app (services/app, #122).
export async function buildChatDevServer(
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ server: Server; close: () => Promise<void>; describe: () => string }> {
  const databaseUrl = env.CHAT_DATABASE_URL ?? env.DATABASE_URL;
  const runActivityAgentId = env.CHAT_RUN_ACTIVITY_AGENT_ID;
  const threadTitleModelModule = env.CHAT_THREAD_TITLE_MODEL_MODULE;

  // Relative *_MODULE settings resolve from services/chat, as they do standalone, even
  // when the one-process app (cwd services/app) builds this server.
  const baseOptions = await loadChatServerOptionsFromEnv(env, SERVICE_DIR);
  const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
  if (pool && !baseOptions.generateThreadTitle && threadTitleModelModule) {
    const module = await import(threadTitleModelModule);
    if (typeof module.model !== "function") {
      throw new Error("CHAT_THREAD_TITLE_MODEL_MODULE must export model");
    }
    baseOptions.generateThreadTitle = createThreadTitleGenerationJob({
      db: pool,
      model: module.model,
    });
  }
  const runActivityHub = createRunActivityHub();
  const server = createChatServer({
    ...baseOptions,
    runActivityHub,
    ...(runActivityAgentId
      ? {
          runActivity: {
            agentId: runActivityAgentId,
            report: async (input, scope) => {
              if (pool) {
                await writeAndPublishRunActivity(pool, runActivityHub, input, scope);
                return;
              }
              runActivityHub.publish(createLiveRunActivity(input, scope), scope);
            },
            onError: (error) => {
              console.error("failed to publish run activity", error);
            },
          },
        }
      : {}),
    ...(pool ? { threadsDb: pool } : {}),
  });

  return {
    server,
    close: async () => {
      await pool?.end();
    },
    describe: () => {
      const threadsHint = pool ? "with /v1/chat/threads CRUD" : "without /v1/chat/threads CRUD (set CHAT_DATABASE_URL or DATABASE_URL to enable)";
      const activityHint = pool && runActivityAgentId
        ? "with /v1/run-activities/stream persistence"
        : runActivityAgentId
          ? "with /v1/run-activities/stream live endpoint"
          : "with /v1/run-activities/stream live endpoint (set CHAT_RUN_ACTIVITY_AGENT_ID and DATABASE_URL to emit and persist)";
      return `${threadsHint}; ${activityHint}`;
    },
  };
}

import { Pool } from "pg";
import { createChatServer } from "./http.ts";
import { loadChatServerOptionsFromEnv } from "./runtime.ts";
import {
  createRunActivityHub,
  writeAndPublishRunActivity,
} from "../../observability/src/run-activity.ts";

const host = process.env.CHAT_HOST ?? "127.0.0.1";
const port = Number(process.env.CHAT_PORT ?? "4310");
const databaseUrl = process.env.CHAT_DATABASE_URL ?? process.env.DATABASE_URL;
const runActivityAgentId = process.env.CHAT_RUN_ACTIVITY_AGENT_ID;

const baseOptions = await loadChatServerOptionsFromEnv();
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
const runActivityHub = createRunActivityHub();
const server = createChatServer({
  ...baseOptions,
  runActivityHub,
  ...(pool && runActivityAgentId
    ? {
        runActivity: {
          agentId: runActivityAgentId,
          report: async (input) => {
            await writeAndPublishRunActivity(pool, runActivityHub, input);
          },
        },
      }
    : {}),
  ...(pool ? { threadsDb: pool } : {}),
});

server.listen(port, host, () => {
  const threadsHint = pool ? "with /v1/chat/threads CRUD" : "without /v1/chat/threads CRUD (set CHAT_DATABASE_URL or DATABASE_URL to enable)";
  const activityHint = pool && runActivityAgentId
    ? "with /v1/run-activities/stream persistence"
    : "with /v1/run-activities/stream live endpoint (set CHAT_RUN_ACTIVITY_AGENT_ID and DATABASE_URL to persist)";
  console.log(`chat listening on http://${host}:${port} (${threadsHint}; ${activityHint})`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      if (pool) {
        pool.end().finally(() => process.exit(0));
      } else {
        process.exit(0);
      }
    });
  });
}

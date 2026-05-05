import { Pool } from "pg";

import { createEvidenceReviewServer } from "./review-http.ts";

const host = process.env.EVIDENCE_HOST ?? "127.0.0.1";
const port = Number(process.env.EVIDENCE_PORT ?? "4335");
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for evidence dev server");
}

const pool = new Pool({ connectionString: databaseUrl });
const server = createEvidenceReviewServer(pool);

server.listen(port, host, () => {
  console.log(`evidence review listening on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
  });
}

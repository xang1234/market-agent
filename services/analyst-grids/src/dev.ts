import { Pool } from "pg";
import { createAnalystGridsServer } from "./http.ts";
import { createUniverseResolverDeps } from "./universe-wiring.ts";
import { createReaderColumnDepsFromEnv } from "./reader-wiring.ts";
import { createEvidenceFinancialPort } from "../../financial-engine/src/evidence-adapter.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const rawPort = process.env.ANALYST_GRIDS_PORT ?? "8093";
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`ANALYST_GRIDS_PORT must be an integer in [1, 65535], got: ${rawPort}`);
}
const host = process.env.HOST ?? "127.0.0.1";
const pool = new Pool({ connectionString: databaseUrl });
const reader = await createReaderColumnDepsFromEnv();
if (!reader) console.log("analyst-grids: reader columns disabled (LLM or S3 env not configured)");
// Verified numerical columns: GRID_FINANCIAL_MODE = off (default) | shadow | enforce.
const financialMode = process.env.GRID_FINANCIAL_MODE === "shadow" || process.env.GRID_FINANCIAL_MODE === "enforce"
  ? process.env.GRID_FINANCIAL_MODE
  : "off";
const server = createAnalystGridsServer({
  db: pool,
  pool,
  universe: createUniverseResolverDeps(pool),
  reader,
  ...(financialMode === "off" ? {} : { financial: { mode: financialMode, pool, evidence: createEvidenceFinancialPort } }),
});
server.listen(port, host, () => {
  console.log(`analyst-grids listening on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
  });
}

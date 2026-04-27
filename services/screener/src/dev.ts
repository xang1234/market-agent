import { createInMemoryCandidateRepository } from "./candidate.ts";
import { DEV_SCREENER_CANDIDATES } from "./dev-candidates.ts";
import { createScreenerServer } from "./http.ts";
import { createInMemoryScreenRepository } from "./screen-repository.ts";

const host = process.env.SCREENER_HOST ?? "127.0.0.1";
const port = Number(process.env.SCREENER_PORT ?? "4323");

const candidates = createInMemoryCandidateRepository(DEV_SCREENER_CANDIDATES);
const screens = createInMemoryScreenRepository();
const server = createScreenerServer({ candidates, screens });

server.listen(port, host, () => {
  console.log(`screener listening on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}

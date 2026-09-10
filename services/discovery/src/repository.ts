import type { QueryExecutor } from "../../agents/src/agent-repo.ts";
import { createAttemptStore } from "./attempt-repo.ts";
import { createCampaignStore } from "./campaign-repo.ts";
import { createCandidateStore } from "./candidate-repo.ts";
import { createEventStore } from "./event-repo.ts";
import type { DiscoveryRepository } from "./ports.ts";
import { createRunStore } from "./run-repo.ts";

export function createDiscoveryRepository(db: QueryExecutor, options: { clock: () => Date }): DiscoveryRepository {
  const campaign = createCampaignStore(db);
  const run = createRunStore(db, options.clock);
  const candidate = createCandidateStore(db, options.clock);
  const attempt = createAttemptStore(db, options.clock);
  const event = createEventStore(db, options.clock);
  return Object.freeze({ ...campaign, ...run, ...candidate, ...attempt, ...event });
}

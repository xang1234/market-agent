import type { QueryExecutor } from "../../agents/src/agent-repo.ts";
import { createAttemptStore } from "./attempt-repo.ts";
import { createCampaignStore } from "./campaign-repo.ts";
import { createCandidateStore } from "./candidate-repo.ts";
import { createEventStore } from "./event-repo.ts";
import { loadValidatedRoleProgress, saveValidatedRoleCheckpoint } from "./assessment-repo.ts";
import { createPacketStore } from "./packet-repo.ts";
import type { DiscoveryRepository, Lease, ValidatedRoleCheckpoint } from "./ports.ts";
import { createRunStore } from "./run-repo.ts";

export function createDiscoveryRepository(db: QueryExecutor, options: { clock: () => Date }): DiscoveryRepository {
  const campaign = createCampaignStore(db);
  const run = createRunStore(db, options.clock);
  const candidate = createCandidateStore(db, options.clock);
  const attempt = createAttemptStore(db, options.clock);
  const event = createEventStore(db, options.clock);
  const packet = createPacketStore(db, options.clock);
  return Object.freeze({
    ...campaign, ...run, ...candidate, ...attempt, ...event, ...packet,
    saveValidatedRole: (lease: Lease, candidateId: string, checkpoint: ValidatedRoleCheckpoint) => saveValidatedRoleCheckpoint(db, lease, candidateId, checkpoint, options.clock),
    loadValidatedRoles: (lease: Lease, candidateId: string) => loadValidatedRoleProgress(db, lease, candidateId, options.clock),
  });
}

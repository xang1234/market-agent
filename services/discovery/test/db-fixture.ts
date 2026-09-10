import type { TestContext } from "node:test";

import { hashJsonValue } from "../../observability/src/tool-call.ts";
import { bootstrapDatabase, connectedPool, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { createDiscoveryRepository } from "../src/repository.ts";
import { briefFixture } from "./fixtures.ts";

export { dockerAvailable } from "../../../db/test/docker-pg.ts";
export const dbOptions = { skip: !dockerAvailable(), timeout: 120_000 };

export function testClock() {
  let current = new Date("2026-09-10T12:00:00.000Z");
  return {
    now: () => new Date(current),
    advance: (milliseconds: number) => { current = new Date(current.getTime() + milliseconds); },
  };
}

export async function withCampaignDb(t: TestContext) {
  const { databaseUrl } = await bootstrapDatabase(t, "discovery-campaigns");
  const pool = await connectedPool(t, databaseUrl, { max: 8 });
  const userId = "10000000-0000-4000-8000-000000000001";
  const otherUserId = "10000000-0000-4000-8000-000000000002";
  await pool.query(
    `insert into users (user_id, email, display_name)
     values ($1::uuid, 'discovery-owner@example.test', 'Discovery Owner'),
            ($2::uuid, 'discovery-other@example.test', 'Discovery Other')`,
    [userId, otherUserId],
  );
  const clock = testClock();
  const repo = createDiscoveryRepository(pool, { clock: clock.now });

  async function createApprovedRun(brief = briefFixture()) {
    const campaign = await repo.createCampaign(userId, {
      name: "Grid modernization",
      question: "Which US-listed companies benefit from grid modernization spending?",
    });
    const saved = await repo.saveBrief(userId, campaign.campaign_id, 0, brief);
    const run = await repo.startRun(userId, campaign.campaign_id, {
      brief_version: saved.version,
      brief_hash: saved.hash,
      request_key: crypto.randomUUID(),
    });
    return { campaign, brief: saved, run };
  }

  return { db: pool, pool, repo, userId, otherUserId, clock, createApprovedRun };
}

export const briefHash = (brief: unknown) => hashJsonValue(brief as never);

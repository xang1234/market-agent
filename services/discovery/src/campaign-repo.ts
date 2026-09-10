import { hashJsonValue } from "../../observability/src/tool-call.ts";
import type { QueryExecutor } from "../../agents/src/agent-repo.ts";
import { parseBrief } from "./validation.ts";
import { DiscoveryError, type Brief, type Campaign, type Page, type SavedBrief } from "./types.ts";
import { decodeCursor, encodeCursor, isoDate, json, jsonValue, requireLimit, requireText, requireUuid, transaction } from "./repository-support.ts";

type CampaignRow = Omit<Campaign, "created_at" | "updated_at" | "archived_at"> & { created_at: Date | string; updated_at: Date | string; archived_at: Date | string | null };
type BriefRow = { brief_id: string; campaign_id: string; version: number; brief: unknown; content_hash: string; approved_at: Date | string | null; created_at: Date | string };
const CAMPAIGN_COLUMNS = "campaign_id::text as campaign_id, user_id::text as user_id, name, question, current_brief_version, created_at, updated_at, archived_at";
const BRIEF_COLUMNS = "brief_id::text as brief_id, campaign_id::text as campaign_id, version, brief, content_hash, approved_at, created_at";
const BRIEF_JOIN_COLUMNS = "b.brief_id::text as brief_id, b.campaign_id::text as campaign_id, b.version, b.brief, b.content_hash, b.approved_at, b.created_at";

export function createCampaignStore(db: QueryExecutor) {
  return {
    async createCampaign(userId: string, input: { name: string; question: string }): Promise<Campaign> {
      requireUuid(userId, "user_id");
      const name = requireText(input.name, "name", 1, 120);
      const question = requireText(input.question, "question", 20, 4_000);
      const { rows } = await db.query<CampaignRow>(
        `insert into discovery_campaigns (user_id, name, question) values ($1::uuid, $2, $3) returning ${CAMPAIGN_COLUMNS}`,
        [userId, name, question],
      );
      return campaignFromRow(rows[0]);
    },
    async getCampaign(userId: string, campaignId: string): Promise<Campaign> {
      requireUuid(userId, "user_id"); requireUuid(campaignId, "campaign_id");
      const { rows } = await db.query<CampaignRow>(`select ${CAMPAIGN_COLUMNS} from discovery_campaigns where campaign_id=$1::uuid and user_id=$2::uuid`, [campaignId, userId]);
      if (!rows[0]) throw new DiscoveryError("not_found", "campaign not found");
      return campaignFromRow(rows[0]);
    },
    async listCampaigns(userId: string, cursor: string | null, requestedLimit: number): Promise<Page<Campaign>> {
      requireUuid(userId, "user_id");
      const limit = requireLimit(requestedLimit, 20); const decoded = decodeCursor(cursor);
      const { rows } = await db.query<CampaignRow>(
        `select ${CAMPAIGN_COLUMNS} from discovery_campaigns
          where user_id=$1::uuid and archived_at is null
            and ($2::timestamptz is null or (created_at, campaign_id) < ($2::timestamptz, $3::uuid))
          order by created_at desc, campaign_id desc limit $4`,
        [userId, decoded?.created_at ?? null, decoded?.id ?? null, limit + 1],
      );
      const items = rows.slice(0, limit).map(campaignFromRow);
      const next = rows.length > limit ? items.at(-1) : undefined;
      return { items, next_cursor: next ? encodeCursor({ created_at: next.created_at, id: next.campaign_id }) : null };
    },
    async getBrief(userId: string, briefId: string): Promise<SavedBrief> {
      requireUuid(userId, "user_id"); requireUuid(briefId, "brief_id");
      const { rows } = await db.query<BriefRow>(
        `select ${BRIEF_JOIN_COLUMNS} from discovery_briefs b join discovery_campaigns c using(campaign_id)
          where b.brief_id=$1::uuid and c.user_id=$2::uuid`, [briefId, userId],
      );
      if (!rows[0]) throw new DiscoveryError("not_found", "brief not found");
      return briefFromRow(rows[0]);
    },
    async currentBrief(userId: string, campaignId: string): Promise<SavedBrief | null> {
      requireUuid(userId, "user_id"); requireUuid(campaignId, "campaign_id");
      const { rows } = await db.query<BriefRow>(
        `select ${BRIEF_JOIN_COLUMNS} from discovery_briefs b join discovery_campaigns c using(campaign_id)
          where b.campaign_id=$1::uuid and c.user_id=$2::uuid order by b.version desc limit 1`, [campaignId, userId],
      );
      return rows[0] ? briefFromRow(rows[0]) : null;
    },
    async saveBrief(userId: string, campaignId: string, expectedVersion: number, value: Brief): Promise<SavedBrief> {
      requireUuid(userId, "user_id"); requireUuid(campaignId, "campaign_id");
      if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw new DiscoveryError("validation", "expected_version must be a non-negative integer");
      const brief = parseBrief(value); const hash = hashJsonValue(brief as never);
      return transaction(db, async (tx) => {
        const locked = await tx.query<{ current_brief_version: number }>(
          "select current_brief_version from discovery_campaigns where campaign_id=$1::uuid and user_id=$2::uuid for update", [campaignId, userId],
        );
        const campaign = locked.rows[0];
        if (!campaign) throw new DiscoveryError("not_found", "campaign not found");
        if (campaign.current_brief_version !== expectedVersion) throw new DiscoveryError("stale_brief", "brief version is stale");
        const metricKeys = [...new Set(brief.criteria.flatMap((criterion) => criterion.metric === undefined ? [] : [criterion.metric.metric_key]))];
        if (metricKeys.length > 0) {
          const supported = await tx.query<{ metric_key: string }>("select metric_key from metrics where metric_key = any($1::text[])", [metricKeys]);
          if (supported.rows.length !== metricKeys.length) throw new DiscoveryError("validation", "brief contains an unregistered metric_key");
        }
        const { rows } = await tx.query<BriefRow>(
          `insert into discovery_briefs (campaign_id, version, brief, content_hash) values ($1::uuid, $2, $3::jsonb, $4) returning ${BRIEF_COLUMNS}`,
          [campaignId, expectedVersion + 1, json(brief), hash],
        );
        await tx.query("update discovery_campaigns set current_brief_version=$2, updated_at=now() where campaign_id=$1::uuid", [campaignId, expectedVersion + 1]);
        return briefFromRow(rows[0]);
      });
    },
  };
}

function campaignFromRow(row: CampaignRow | undefined): Campaign {
  if (!row) throw new Error("campaign query returned no row");
  return { ...row, created_at: isoDate(row.created_at, "created_at")!, updated_at: isoDate(row.updated_at, "updated_at")!, archived_at: isoDate(row.archived_at, "archived_at") };
}

function briefFromRow(row: BriefRow | undefined): SavedBrief {
  if (!row) throw new Error("brief query returned no row");
  return { brief_id: row.brief_id, campaign_id: row.campaign_id, version: row.version, brief: parseBrief(jsonValue(row.brief, "brief")), hash: row.content_hash, approved_at: isoDate(row.approved_at, "approved_at"), created_at: isoDate(row.created_at, "created_at")! };
}

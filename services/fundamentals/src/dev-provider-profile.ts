import {
  freezeIssuerProfileRecord,
  type IssuerProfileExchange,
  type IssuerProfileRecord,
  type IssuerProfileRecordInput,
} from "./profile.ts";
import type {
  IssuerProfileQueryExecutor,
  IssuerProfileRepository,
} from "./issuer-repository.ts";
import { FundamentalsDataUnavailableError } from "./availability.ts";
import {
  DEFAULT_DEV_PROVIDER_TIMEOUT_MS,
  postSidecar,
  type DevProviderSidecarOptions,
} from "./dev-provider-sidecar.ts";
import { FINVIZ_DEV_REFERENCE_SOURCE_ID } from "./provider-sources.ts";
import type { UUID } from "./subject-ref.ts";

export type DevProvidersIssuerProfileRepositoryOptions = DevProviderSidecarOptions & {
  primary: IssuerProfileRepository;
  db: IssuerProfileTransactionalQueryExecutor;
};

export type IssuerProfileTransactionClient = IssuerProfileQueryExecutor & {
  release(): void;
};

export type IssuerProfileTransactionalQueryExecutor = IssuerProfileQueryExecutor & {
  connect(): Promise<IssuerProfileTransactionClient>;
};

type SidecarProfile = {
  domicile?: unknown;
  sector?: unknown;
  industry?: unknown;
};

export function createDevProvidersIssuerProfileRepository(
  options: DevProvidersIssuerProfileRepositoryOptions,
): IssuerProfileRepository {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_DEV_PROVIDER_TIMEOUT_MS;

  return {
    async find(issuer_id: UUID): Promise<IssuerProfileRecord | null> {
      const primary = await options.primary.find(issuer_id);
      if (!primary || !needsProfileEnrichment(primary)) return primary;
      const exchange = primary.exchanges[0];
      if (!exchange) return primary;

      let enrichment: Partial<IssuerProfileRecordInput> | null;
      try {
        enrichment = await fetchProfileEnrichment({
          baseUrl: options.baseUrl,
          exchange,
          fetchImpl,
          timeoutMs,
        });
      } catch (error) {
        if (!(error instanceof FundamentalsDataUnavailableError)) throw error;
        return primary;
      }
      if (!enrichment) return primary;
      const merged = mergeProfileNulls(primary, enrichment);
      const changed = changedProfileFields(primary, merged);
      if (!changed) return primary;
      await persistProfileEnrichment(options.db, primary.subject.id, changed);
      return merged;
    },
  };
}

async function fetchProfileEnrichment(input: {
  baseUrl: string;
  exchange: IssuerProfileExchange;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}): Promise<Partial<IssuerProfileRecordInput> | null> {
  const envelope = await postSidecar({
    baseUrl: input.baseUrl,
    path: "/reference/profile",
    body: {
      listing: input.exchange.listing,
      ticker: input.exchange.ticker,
      mic: input.exchange.mic,
      currency: input.exchange.trading_currency,
      timezone: input.exchange.timezone,
    },
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
  });
  if (envelope.status !== "available") return null;
  return sidecarProfile(envelope.data);
}

function needsProfileEnrichment(record: IssuerProfileRecord): boolean {
  return record.domicile === undefined || record.sector === undefined || record.industry === undefined;
}

function sidecarProfile(value: unknown): Partial<IssuerProfileRecordInput> | null {
  if (typeof value !== "object" || value === null) return null;
  const data = value as SidecarProfile;
  const profile: Partial<IssuerProfileRecordInput> = {};
  const domicile = stringValue(data.domicile);
  const sector = stringValue(data.sector);
  const industry = stringValue(data.industry);
  if (domicile) profile.domicile = domicile;
  if (sector) profile.sector = sector;
  if (industry) profile.industry = industry;
  return Object.keys(profile).length > 0 ? profile : null;
}

function mergeProfileNulls(
  primary: IssuerProfileRecord,
  enrichment: Partial<IssuerProfileRecordInput>,
): IssuerProfileRecord {
  return freezeIssuerProfileRecord({
    ...primary,
    domicile: primary.domicile ?? enrichment.domicile,
    sector: primary.sector ?? enrichment.sector,
    industry: primary.industry ?? enrichment.industry,
  });
}

function changedProfileFields(
  before: IssuerProfileRecord,
  after: IssuerProfileRecord,
): Partial<Pick<IssuerProfileRecord, "domicile" | "sector" | "industry">> | null {
  const changed: Partial<Pick<IssuerProfileRecord, "domicile" | "sector" | "industry">> = {};
  for (const field of ["domicile", "sector", "industry"] as const) {
    if (before[field] === undefined && after[field] !== undefined) changed[field] = after[field];
  }
  return Object.keys(changed).length > 0 ? changed : null;
}

async function persistProfileEnrichment(
  db: IssuerProfileTransactionalQueryExecutor,
  issuerId: UUID,
  fields: Pick<Partial<IssuerProfileRecord>, "domicile" | "sector" | "industry">,
): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("begin");
    await persistProfileEnrichmentProvenance(client, issuerId, fields);
    await persistProfileEnrichmentFields(client, issuerId, fields);
    await client.query("commit");
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // Preserve the original persistence error.
    }
    throw error;
  } finally {
    client.release();
  }
}

async function persistProfileEnrichmentFields(
  db: IssuerProfileQueryExecutor,
  issuerId: UUID,
  fields: Pick<Partial<IssuerProfileRecord>, "domicile" | "sector" | "industry">,
): Promise<void> {
  await db.query(
    `update issuers
        set domicile = coalesce(domicile, $2),
            sector = coalesce(sector, $3),
            industry = coalesce(industry, $4),
            updated_at = now()
      where issuer_id = $1`,
    [issuerId, fields.domicile ?? null, fields.sector ?? null, fields.industry ?? null],
  );
}

async function persistProfileEnrichmentProvenance(
  db: IssuerProfileQueryExecutor,
  issuerId: UUID,
  fields: Pick<Partial<IssuerProfileRecord>, "domicile" | "sector" | "industry">,
): Promise<void> {
  for (const field of ["domicile", "sector", "industry"] as const) {
    const value = fields[field];
    if (value === undefined) continue;
    await db.query(
      `insert into issuer_profile_enrichments
         (issuer_id, field_name, field_value, source_id, provider, retrieved_at)
       values ($1::uuid, $2, $3, $4::uuid, 'finviz_dev_reference', now())
       on conflict (issuer_id, field_name, source_id)
       do update set field_value = excluded.field_value,
                     provider = excluded.provider,
                     retrieved_at = excluded.retrieved_at,
                     updated_at = now()`,
      [issuerId, field, value, FINVIZ_DEV_REFERENCE_SOURCE_ID],
    );
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

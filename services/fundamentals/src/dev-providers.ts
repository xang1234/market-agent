import {
  freezeIssuerProfileRecord,
  type IssuerProfileRecord,
  type IssuerProfileRecordInput,
} from "./profile.ts";
import type {
  IssuerProfileQueryExecutor,
  IssuerProfileRepository,
} from "./issuer-repository.ts";
import type { IssuerProfileExchange } from "./profile.ts";
import type { UUID } from "./subject-ref.ts";

export type DevProvidersIssuerProfileRepositoryOptions = {
  primary: IssuerProfileRepository;
  db: IssuerProfileQueryExecutor;
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

type SidecarEnvelope =
  | {
      status: "available";
      data?: unknown;
    }
  | {
      status: "unavailable";
      reason?: unknown;
      retryable?: unknown;
      detail?: unknown;
    };

type SidecarProfile = {
  domicile?: unknown;
  sector?: unknown;
  industry?: unknown;
};

const DEFAULT_TIMEOUT_MS = 5_000;

export function createDevProvidersIssuerProfileRepository(
  options: DevProvidersIssuerProfileRepositoryOptions,
): IssuerProfileRepository {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async find(issuer_id: UUID): Promise<IssuerProfileRecord | null> {
      const primary = await options.primary.find(issuer_id);
      if (!primary || !needsProfileEnrichment(primary)) return primary;
      const exchange = primary.exchanges[0];
      if (!exchange) return primary;

      try {
        const enrichment = await fetchProfileEnrichment({
          baseUrl: options.baseUrl,
          exchange,
          fetchImpl,
          timeoutMs,
        });
        if (!enrichment) return primary;
        const merged = mergeProfileNulls(primary, enrichment);
        const changed = changedProfileFields(primary, merged);
        if (!changed) return primary;
        await persistProfileEnrichment(options.db, primary.subject.id, changed);
        return merged;
      } catch {
        return primary;
      }
    },
  };
}

async function fetchProfileEnrichment(input: {
  baseUrl: string;
  exchange: IssuerProfileExchange;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}): Promise<Partial<IssuerProfileRecordInput> | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await input.fetchImpl(new URL("/reference/profile", input.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        listing: input.exchange.listing,
        ticker: input.exchange.ticker,
        mic: input.exchange.mic,
        currency: input.exchange.trading_currency,
        timezone: input.exchange.timezone,
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const envelope = (await response.json()) as SidecarEnvelope;
    if (envelope.status !== "available") return null;
    return sidecarProfile(envelope.data);
  } finally {
    clearTimeout(timeout);
  }
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

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

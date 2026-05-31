import {
  freezeIssuerProfileRecord,
  type IssuerProfileRecord,
  type IssuerProfileRecordInput,
} from "./profile.ts";
import {
  freezeEarningsEventsEnvelope,
  type EarningsEventInput,
  type EarningsEventsEnvelopeInput,
} from "./earnings.ts";
import {
  freezeInsiderHoldersEnvelope,
  freezeInstitutionalHoldersEnvelope,
  type HolderKind,
  type InsiderHoldersEnvelopeInput,
  type InstitutionalHoldersEnvelopeInput,
} from "./holders.ts";
import type { EarningsRepository } from "./earnings-repository.ts";
import type { HoldersRepository } from "./holders-repository.ts";
import type {
  IssuerProfileQueryExecutor,
  IssuerProfileRepository,
} from "./issuer-repository.ts";
import type { IssuerProfileExchange } from "./profile.ts";
import { FINVIZ_DEV_REFERENCE_SOURCE_ID } from "./provider-sources.ts";
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

export type DevProvidersEarningsRepositoryOptions = {
  profiles: IssuerProfileRepository;
  baseUrl: string;
  sourceId: UUID;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export type DevProvidersHoldersRepositoryOptions = DevProvidersEarningsRepositoryOptions;

type SidecarEarnings = {
  currency?: unknown;
  as_of?: unknown;
  events?: unknown;
};

type SidecarEarningsEvent = {
  release_date?: unknown;
  period_end?: unknown;
  fiscal_year?: unknown;
  fiscal_period?: unknown;
  eps_actual?: unknown;
  eps_estimate_at_release?: unknown;
  as_of?: unknown;
};

type SidecarHolders = {
  currency?: unknown;
  as_of?: unknown;
  holders?: unknown;
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
        await persistProfileEnrichmentProvenance(options.db, primary.subject.id, changed);
        await persistProfileEnrichment(options.db, primary.subject.id, changed);
        return merged;
      } catch {
        return primary;
      }
    },
  };
}

export function createDevProvidersEarningsRepository(
  options: DevProvidersEarningsRepositoryOptions,
): EarningsRepository {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async find(issuer_id: UUID) {
      const context = await issuerListingContext(options.profiles, issuer_id);
      if (!context) return null;
      try {
        const envelope = await postSidecar({
          baseUrl: options.baseUrl,
          path: "/fundamentals/earnings",
          body: sidecarListingBody(context),
          fetchImpl,
          timeoutMs,
        });
        if (envelope.status !== "available") return null;
        const input = sidecarEarningsInput(envelope.data, issuer_id, context.currency, options.sourceId);
        return input ? freezeEarningsEventsEnvelope(input) : null;
      } catch {
        return null;
      }
    },
  };
}

export function createDevProvidersHoldersRepository(
  options: DevProvidersHoldersRepositoryOptions,
): HoldersRepository {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async find(issuer_id: UUID, kind: HolderKind) {
      const context = await issuerListingContext(options.profiles, issuer_id);
      if (!context) return null;
      try {
        const envelope = await postSidecar({
          baseUrl: options.baseUrl,
          path: "/fundamentals/holders",
          body: { ...sidecarListingBody(context), kind },
          fetchImpl,
          timeoutMs,
        });
        if (envelope.status !== "available") return null;
        const input = sidecarHoldersInput(envelope.data, issuer_id, kind, context.currency, options.sourceId);
        if (!input) return null;
        return kind === "institutional"
          ? freezeInstitutionalHoldersEnvelope(input as InstitutionalHoldersEnvelopeInput)
          : freezeInsiderHoldersEnvelope(input as InsiderHoldersEnvelopeInput);
      } catch {
        return null;
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

async function postSidecar(input: {
  baseUrl: string;
  path: string;
  body: unknown;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}): Promise<SidecarEnvelope> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await input.fetchImpl(new URL(input.path, input.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input.body),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`dev providers sidecar HTTP ${response.status}`);
    const envelope = (await response.json()) as SidecarEnvelope;
    if (envelope.status !== "available" && envelope.status !== "unavailable") {
      throw new Error("dev providers sidecar returned malformed availability envelope");
    }
    return envelope;
  } finally {
    clearTimeout(timeout);
  }
}

type IssuerListingContext = {
  ticker: string;
  mic: string;
  currency: string;
  timezone: string;
};

async function issuerListingContext(
  profiles: IssuerProfileRepository,
  issuerId: UUID,
): Promise<IssuerListingContext | null> {
  const profile = await profiles.find(issuerId);
  const exchange = profile?.exchanges[0];
  if (!exchange) return null;
  return {
    ticker: exchange.ticker,
    mic: exchange.mic,
    currency: exchange.trading_currency,
    timezone: exchange.timezone,
  };
}

function sidecarListingBody(context: IssuerListingContext): Record<string, unknown> {
  return {
    ticker: context.ticker,
    mic: context.mic,
    currency: context.currency,
    timezone: context.timezone,
  };
}

function sidecarEarningsInput(
  value: unknown,
  issuerId: UUID,
  fallbackCurrency: string,
  sourceId: UUID,
): EarningsEventsEnvelopeInput | null {
  if (!isRecord(value)) return null;
  const data = value as SidecarEarnings;
  const asOf = stringValue(data.as_of);
  const events = Array.isArray(data.events) ? data.events : null;
  if (!asOf || !events) return null;
  const mapped: EarningsEventInput[] = [];
  for (const event of events) {
    const mappedEvent = sidecarEarningsEvent(event, asOf, sourceId);
    if (!mappedEvent) return null;
    mapped.push(mappedEvent);
  }
  return {
    subject: { kind: "issuer", id: issuerId },
    currency: stringValue(data.currency) ?? fallbackCurrency,
    as_of: asOf,
    events: mapped,
  };
}

function sidecarEarningsEvent(
  value: unknown,
  fallbackAsOf: string,
  sourceId: UUID,
): EarningsEventInput | null {
  if (!isRecord(value)) return null;
  const event = value as SidecarEarningsEvent;
  const releaseDate = stringValue(event.release_date);
  const periodEnd = stringValue(event.period_end);
  const fiscalYear = integerValue(event.fiscal_year);
  const fiscalPeriod = stringValue(event.fiscal_period);
  const epsActual = nullableNumber(event.eps_actual);
  const epsEstimate = nullableNumber(event.eps_estimate_at_release);
  if (!releaseDate || !periodEnd || fiscalYear === null || !fiscalPeriod || epsActual === undefined || epsEstimate === undefined) {
    return null;
  }
  return {
    release_date: releaseDate,
    period_end: periodEnd,
    fiscal_year: fiscalYear,
    fiscal_period: fiscalPeriod as EarningsEventInput["fiscal_period"],
    eps_actual: epsActual,
    eps_estimate_at_release: epsEstimate,
    source_id: sourceId,
    as_of: stringValue(event.as_of) ?? fallbackAsOf,
  };
}

function sidecarHoldersInput(
  value: unknown,
  issuerId: UUID,
  kind: HolderKind,
  fallbackCurrency: string,
  sourceId: UUID,
): InstitutionalHoldersEnvelopeInput | InsiderHoldersEnvelopeInput | null {
  if (!isRecord(value)) return null;
  const data = value as SidecarHolders;
  const asOf = stringValue(data.as_of);
  const holders = Array.isArray(data.holders) ? data.holders : null;
  if (!asOf || !holders) return null;
  return {
    subject: { kind: "issuer", id: issuerId },
    currency: stringValue(data.currency) ?? fallbackCurrency,
    as_of: asOf,
    source_id: sourceId,
    holders: holders as InstitutionalHoldersEnvelopeInput["holders"] & InsiderHoldersEnvelopeInput["holders"],
  };
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
                     retrieved_at = excluded.retrieved_at`,
      [issuerId, field, value, FINVIZ_DEV_REFERENCE_SOURCE_ID],
    );
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function integerValue(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function nullableNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

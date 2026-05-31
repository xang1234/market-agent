import {
  freezeEarningsEventsEnvelope,
  type EarningsEventInput,
  type EarningsEventsEnvelopeInput,
} from "./earnings.ts";
import type { EarningsRepository } from "./earnings-repository.ts";
import { FundamentalsDataUnavailableError } from "./availability.ts";
import {
  fiscalCalendarForIssuerProfile,
  fiscalQuarterLabelForPeriodEnd,
  type FiscalCalendar,
} from "./fiscal-calendar.ts";
import {
  freezeInsiderHoldersEnvelope,
  freezeInstitutionalHoldersEnvelope,
  INSIDER_TRANSACTION_TYPES,
  type HolderKind,
  type InsiderHoldersEnvelopeInput,
  type InsiderTransaction,
  type InstitutionalHolder,
  type InstitutionalHoldersEnvelopeInput,
} from "./holders.ts";
import type { HoldersRepository } from "./holders-repository.ts";
import type { IssuerProfileRepository } from "./issuer-repository.ts";
import {
  DEFAULT_DEV_PROVIDER_TIMEOUT_MS,
  postSidecar,
  providerPayloadError,
  sidecarUnavailableError,
  sidecarUnavailableReason,
  type DevProviderSidecarOptions,
} from "./dev-provider-sidecar.ts";
import type { UUID } from "./subject-ref.ts";

export type DevProvidersEarningsRepositoryOptions = DevProviderSidecarOptions & {
  profiles: IssuerProfileRepository;
  sourceId: UUID;
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
  eps_actual?: unknown;
  eps_estimate_at_release?: unknown;
  as_of?: unknown;
};

type SidecarHolders = {
  currency?: unknown;
  as_of?: unknown;
  holders?: unknown;
};

type IssuerListingContext = {
  ticker: string;
  mic: string;
  currency: string;
  timezone: string;
  fiscalCalendar: FiscalCalendar;
};

export function createDevProvidersEarningsRepository(
  options: DevProvidersEarningsRepositoryOptions,
): EarningsRepository {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_DEV_PROVIDER_TIMEOUT_MS;

  return {
    async find(issuer_id: UUID) {
      const context = await issuerListingContext(options.profiles, issuer_id);
      if (!context) return null;
      const envelope = await postSidecar({
        baseUrl: options.baseUrl,
        path: "/fundamentals/earnings",
        body: sidecarListingBody(context),
        fetchImpl,
        timeoutMs,
      });
      if (envelope.status !== "available") {
        if (sidecarUnavailableReason(envelope) === "missing_coverage") return null;
        throw sidecarUnavailableError(envelope, "yfinance earnings");
      }
      const input = sidecarEarningsInput(
        envelope.data,
        issuer_id,
        context.currency,
        context.fiscalCalendar,
        options.sourceId,
      );
      try {
        return freezeEarningsEventsEnvelope(input);
      } catch (error) {
        throw providerPayloadError("yfinance earnings", errorMessage(error));
      }
    },
  };
}

export function createDevProvidersHoldersRepository(
  options: DevProvidersHoldersRepositoryOptions,
): HoldersRepository {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_DEV_PROVIDER_TIMEOUT_MS;

  return {
    async find(issuer_id: UUID, kind: HolderKind) {
      const context = await issuerListingContext(options.profiles, issuer_id);
      if (!context) return null;
      const envelope = await postSidecar({
        baseUrl: options.baseUrl,
        path: "/fundamentals/holders",
        body: { ...sidecarListingBody(context), kind },
        fetchImpl,
        timeoutMs,
      });
      if (envelope.status !== "available") {
        if (sidecarUnavailableReason(envelope) === "missing_coverage") return null;
        throw sidecarUnavailableError(envelope, `yfinance ${kind} holders`);
      }
      try {
        if (kind === "institutional") {
          return freezeInstitutionalHoldersEnvelope(
            sidecarInstitutionalHoldersInput(
              envelope.data,
              issuer_id,
              context.currency,
              options.sourceId,
            ),
          );
        }
        return freezeInsiderHoldersEnvelope(
          sidecarInsiderHoldersInput(
            envelope.data,
            issuer_id,
            context.currency,
            options.sourceId,
          ),
        );
      } catch (error) {
        if (error instanceof FundamentalsDataUnavailableError) throw error;
        throw providerPayloadError(`yfinance ${kind} holders`, errorMessage(error));
      }
    },
  };
}

async function issuerListingContext(
  profiles: IssuerProfileRepository,
  issuerId: UUID,
): Promise<IssuerListingContext | null> {
  const profile = await profiles.find(issuerId);
  const exchange = profile?.exchanges[0];
  if (!profile || !exchange) return null;
  return {
    ticker: exchange.ticker,
    mic: exchange.mic,
    currency: exchange.trading_currency,
    timezone: exchange.timezone,
    fiscalCalendar: fiscalCalendarForIssuerProfile(profile),
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
  fiscalCalendar: FiscalCalendar,
  sourceId: UUID,
): EarningsEventsEnvelopeInput {
  if (!isRecord(value)) throw providerPayloadError("yfinance earnings", "earnings payload");
  const data = value as SidecarEarnings;
  const asOf = stringValue(data.as_of);
  const events = Array.isArray(data.events) ? data.events : null;
  if (!asOf || !events) {
    throw providerPayloadError("yfinance earnings", "earnings payload");
  }
  return {
    subject: { kind: "issuer", id: issuerId },
    currency: stringValue(data.currency) ?? fallbackCurrency,
    as_of: asOf,
    events: events.map((event) => sidecarEarningsEvent(event, asOf, fiscalCalendar, sourceId)),
  };
}

function sidecarEarningsEvent(
  value: unknown,
  fallbackAsOf: string,
  fiscalCalendar: FiscalCalendar,
  sourceId: UUID,
): EarningsEventInput {
  if (!isRecord(value)) throw providerPayloadError("yfinance earnings", "earnings event");
  const event = value as SidecarEarningsEvent;
  const releaseDate = stringValue(event.release_date);
  const periodEnd = stringValue(event.period_end);
  const epsActual = nullableNumber(event.eps_actual);
  const epsEstimate = nullableNumber(event.eps_estimate_at_release);
  if (!releaseDate || !periodEnd || epsActual === undefined || epsEstimate === undefined) {
    throw providerPayloadError("yfinance earnings", "earnings event");
  }
  const fiscal = fiscalQuarterLabelForPeriodEnd(fiscalCalendar, periodEnd);
  if (!fiscal) throw providerPayloadError("yfinance earnings", "earnings event period_end");
  return {
    release_date: releaseDate,
    period_end: periodEnd,
    fiscal_year: fiscal.fiscal_year,
    fiscal_period: fiscal.fiscal_period,
    eps_actual: epsActual,
    eps_estimate_at_release: epsEstimate,
    source_id: sourceId,
    as_of: stringValue(event.as_of) ?? fallbackAsOf,
  };
}

function sidecarInstitutionalHoldersInput(
  value: unknown,
  issuerId: UUID,
  fallbackCurrency: string,
  sourceId: UUID,
): InstitutionalHoldersEnvelopeInput {
  const data = sidecarHolders(value, "institutional");
  return {
    subject: { kind: "issuer", id: issuerId },
    currency: stringValue(data.currency) ?? fallbackCurrency,
    as_of: data.asOf,
    source_id: sourceId,
    holders: data.holders.map(sidecarInstitutionalHolder),
  };
}

function sidecarInsiderHoldersInput(
  value: unknown,
  issuerId: UUID,
  fallbackCurrency: string,
  sourceId: UUID,
): InsiderHoldersEnvelopeInput {
  const data = sidecarHolders(value, "insider");
  return {
    subject: { kind: "issuer", id: issuerId },
    currency: stringValue(data.currency) ?? fallbackCurrency,
    as_of: data.asOf,
    source_id: sourceId,
    holders: data.holders.map(sidecarInsiderTransaction),
  };
}

function sidecarHolders(
  value: unknown,
  kind: HolderKind,
): { currency?: unknown; asOf: string; holders: unknown[] } {
  if (!isRecord(value)) throw providerPayloadError(`yfinance ${kind} holders`, "holders payload");
  const data = value as SidecarHolders;
  const asOf = stringValue(data.as_of);
  const holders = Array.isArray(data.holders) ? data.holders : null;
  if (!asOf || !holders) {
    throw providerPayloadError(`yfinance ${kind} holders`, "holders payload");
  }
  return { currency: data.currency, asOf, holders };
}

function sidecarInstitutionalHolder(value: unknown): InstitutionalHolder {
  if (!isRecord(value)) throw providerPayloadError("yfinance institutional holders", "holder row");
  const holderName = stringValue(value.holder_name);
  const sharesHeld = integerValue(value.shares_held);
  const marketValue = finiteNumber(value.market_value);
  const percentOfSharesOutstanding = finiteNumber(value.percent_of_shares_outstanding);
  const sharesChange = finiteNumber(value.shares_change);
  const filingDate = stringValue(value.filing_date);
  if (
    !holderName ||
    sharesHeld === null ||
    marketValue === null ||
    percentOfSharesOutstanding === null ||
    sharesChange === null ||
    !filingDate
  ) {
    throw providerPayloadError("yfinance institutional holders", "holder row");
  }
  return {
    holder_name: holderName,
    shares_held: sharesHeld,
    market_value: marketValue,
    percent_of_shares_outstanding: percentOfSharesOutstanding,
    shares_change: sharesChange,
    filing_date: filingDate,
  };
}

function sidecarInsiderTransaction(value: unknown): InsiderTransaction {
  if (!isRecord(value)) throw providerPayloadError("yfinance insider holders", "holder row");
  const insiderName = stringValue(value.insider_name);
  const insiderRole = stringValue(value.insider_role);
  const transactionDate = stringValue(value.transaction_date);
  const transactionType = stringValue(value.transaction_type);
  const shares = integerValue(value.shares);
  const price = nullableNumber(value.price);
  const transactionValue = nullableNumber(value.value);
  if (
    !insiderName ||
    !insiderRole ||
    !transactionDate ||
    !transactionType ||
    !isInsiderTransactionType(transactionType) ||
    shares === null ||
    price === undefined ||
    transactionValue === undefined
  ) {
    throw providerPayloadError("yfinance insider holders", "holder row");
  }
  return {
    insider_name: insiderName,
    insider_role: insiderRole,
    transaction_date: transactionDate,
    transaction_type: transactionType,
    shares,
    price,
    value: transactionValue,
  };
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function integerValue(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isInsiderTransactionType(value: string): value is InsiderTransaction["transaction_type"] {
  return (INSIDER_TRANSACTION_TYPES as ReadonlyArray<string>).includes(value);
}

function nullableNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

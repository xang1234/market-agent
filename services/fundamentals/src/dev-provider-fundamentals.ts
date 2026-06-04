import {
  freezeEarningsEventsEnvelope,
  type EarningsEventInput,
  type EarningsEventsEnvelopeInput,
} from "./earnings.ts";
import type { EarningsRepository } from "./earnings-repository.ts";
import { FundamentalsDataUnavailableError } from "./availability.ts";
import {
  fiscalQuarterLabelForPeriodEnd,
  type FiscalCalendar,
} from "./fiscal-calendar.ts";
import { fiscalCalendarForIssuerProfile } from "./issuer-fiscal-calendar.ts";
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
import {
  buildAnalystConsensus,
  type AnalystRatingCounts,
  type BuildAnalystConsensusInput,
  type PriceTarget,
} from "./analyst-consensus.ts";
import type { ConsensusRepository } from "./consensus-repository.ts";
import type { IssuerProfileRepository } from "./issuer-repository.ts";
import {
  DEFAULT_DEV_PROVIDER_TIMEOUT_MS,
  postSidecar,
  providerPayloadError,
  sidecarUnavailableError,
  sidecarUnavailableReason,
  type DevProviderSidecarOptions,
} from "./dev-provider-sidecar.ts";
import type { IssuerProfileRecord } from "./profile.ts";
import type { UUID } from "./subject-ref.ts";

export type DevProvidersEarningsRepositoryOptions = DevProviderSidecarOptions & {
  profiles: IssuerProfileRepository;
  sourceId: UUID;
};

export type DevProvidersHoldersRepositoryOptions = DevProvidersEarningsRepositoryOptions;

export type DevProvidersConsensusRepositoryOptions = DevProvidersEarningsRepositoryOptions;

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

type ListingSidecarContext = {
  ticker: string;
  mic: string;
  currency: string;
  timezone: string;
};

type IssuerSidecarContext = {
  profile: IssuerProfileRecord;
  listing: ListingSidecarContext;
};

export function createDevProvidersEarningsRepository(
  options: DevProvidersEarningsRepositoryOptions,
): EarningsRepository {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_DEV_PROVIDER_TIMEOUT_MS;

  return {
    async find(issuer_id: UUID) {
      const context = await issuerSidecarContext(options.profiles, issuer_id);
      if (!context) return null;
      const envelope = await postSidecar({
        baseUrl: options.baseUrl,
        path: "/fundamentals/earnings",
        body: sidecarListingBody(context.listing),
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
        context.listing.currency,
        fiscalCalendarForIssuerProfile(context.profile),
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
      const context = await issuerSidecarContext(options.profiles, issuer_id);
      if (!context) return null;
      const envelope = await postSidecar({
        baseUrl: options.baseUrl,
        path: "/fundamentals/holders",
        body: { ...sidecarListingBody(context.listing), kind },
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
              context.listing.currency,
              options.sourceId,
            ),
          );
        }
        return freezeInsiderHoldersEnvelope(
          sidecarInsiderHoldersInput(
            envelope.data,
            issuer_id,
            context.listing.currency,
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

export function createDevProvidersConsensusRepository(
  options: DevProvidersConsensusRepositoryOptions,
): ConsensusRepository {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_DEV_PROVIDER_TIMEOUT_MS;

  return {
    async find(issuer_id: UUID) {
      const context = await issuerSidecarContext(options.profiles, issuer_id);
      if (!context) return null;
      const envelope = await postSidecar({
        baseUrl: options.baseUrl,
        path: "/fundamentals/consensus",
        body: sidecarListingBody(context.listing),
        fetchImpl,
        timeoutMs,
      });
      if (envelope.status !== "available") {
        if (sidecarUnavailableReason(envelope) === "missing_coverage") return null;
        throw sidecarUnavailableError(envelope, "yfinance consensus");
      }
      const input = sidecarConsensusInput(
        envelope.data,
        issuer_id,
        context.listing.currency,
        options.sourceId,
      );
      try {
        return buildAnalystConsensus(input);
      } catch (error) {
        throw providerPayloadError("yfinance consensus", errorMessage(error));
      }
    },
  };
}

type SidecarConsensus = {
  as_of?: unknown;
  currency?: unknown;
  analyst_count?: unknown;
  rating_distribution?: unknown;
  price_target?: unknown;
};

function sidecarConsensusInput(
  value: unknown,
  issuerId: UUID,
  fallbackCurrency: string,
  sourceId: UUID,
): BuildAnalystConsensusInput {
  if (!isRecord(value)) throw providerPayloadError("yfinance consensus", "consensus payload");
  const data = value as SidecarConsensus;
  const asOf = stringValue(data.as_of);
  if (!asOf) throw providerPayloadError("yfinance consensus", "consensus payload");
  const currency = stringValue(data.currency) ?? fallbackCurrency;

  const ratingCounts = sidecarRatingCounts(data.rating_distribution);
  const ratingSum = ratingCounts
    ? ratingCounts.strong_buy + ratingCounts.buy + ratingCounts.hold + ratingCounts.sell + ratingCounts.strong_sell
    : 0;
  // The builder warns when contributor_count > analyst_count; take the max so a
  // rating sum that exceeds yfinance's analyst count stays consistent.
  const analystCount = Math.max(integerValue(data.analyst_count) ?? 0, ratingSum);
  const priceTarget = sidecarPriceTarget(data.price_target, currency, analystCount, asOf, sourceId);

  return {
    subject: { kind: "issuer", id: issuerId },
    analyst_count: analystCount,
    as_of: asOf,
    estimates: [],
    ...(ratingCounts
      ? {
          rating_distribution: {
            counts: ratingCounts,
            contributor_count: ratingSum,
            as_of: asOf,
            source_id: sourceId,
          },
        }
      : {}),
    ...(priceTarget ? { price_target: priceTarget } : {}),
  };
}

function sidecarRatingCounts(value: unknown): AnalystRatingCounts | null {
  if (!isRecord(value)) return null;
  const counts = {
    strong_buy: integerValue(value.strong_buy) ?? 0,
    buy: integerValue(value.buy) ?? 0,
    hold: integerValue(value.hold) ?? 0,
    sell: integerValue(value.sell) ?? 0,
    strong_sell: integerValue(value.strong_sell) ?? 0,
  };
  const total = counts.strong_buy + counts.buy + counts.hold + counts.sell + counts.strong_sell;
  return total > 0 ? counts : null;
}

function sidecarPriceTarget(
  value: unknown,
  currency: string,
  analystCount: number,
  asOf: string,
  sourceId: UUID,
): PriceTarget | null {
  if (!isRecord(value)) return null;
  const low = finiteNumber(value.low);
  const mean = finiteNumber(value.mean);
  const median = finiteNumber(value.median);
  const high = finiteNumber(value.high);
  if (low === null || mean === null || median === null || high === null) return null;
  // Omit on ordering violation so we never emit a visibly-inconsistent target.
  if (!(low <= mean && mean <= high && low <= median && median <= high)) return null;
  return {
    currency,
    low,
    mean,
    median,
    high,
    contributor_count: analystCount,
    as_of: asOf,
    source_id: sourceId,
  };
}

async function issuerSidecarContext(
  profiles: IssuerProfileRepository,
  issuerId: UUID,
): Promise<IssuerSidecarContext | null> {
  const profile = await profiles.find(issuerId);
  const exchange = profile?.exchanges[0];
  if (!profile || !exchange) return null;
  return {
    profile,
    listing: {
      ticker: exchange.ticker,
      mic: exchange.mic,
      currency: exchange.trading_currency,
      timezone: exchange.timezone,
    },
  };
}

function sidecarListingBody(context: ListingSidecarContext): Record<string, unknown> {
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

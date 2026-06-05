// Dev-provider earnings repository: fetch the issuer's earnings events from the
// sidecar and map them onto the normalized earnings envelope.

import {
  freezeEarningsEventsEnvelope,
  type EarningsEventInput,
  type EarningsEventsEnvelopeInput,
} from "./earnings.ts";
import type { EarningsRepository } from "./earnings-repository.ts";
import {
  fiscalQuarterLabelForPeriodEnd,
  type FiscalCalendar,
} from "./fiscal-calendar.ts";
import { fiscalCalendarForIssuerProfile } from "./issuer-fiscal-calendar.ts";
import {
  DEFAULT_DEV_PROVIDER_TIMEOUT_MS,
  postSidecar,
  providerPayloadError,
  sidecarUnavailableError,
  sidecarUnavailableReason,
} from "./dev-provider-sidecar.ts";
import {
  errorMessage,
  isRecord,
  issuerSidecarContext,
  nullableNumber,
  sidecarListingBody,
  stringValue,
  type DevProvidersRepositoryOptions,
} from "./dev-provider-shared.ts";
import type { UUID } from "./subject-ref.ts";

export type DevProvidersEarningsRepositoryOptions = DevProvidersRepositoryOptions;

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

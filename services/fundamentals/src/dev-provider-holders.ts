// Dev-provider holders repository: fetch institutional or insider holders from
// the sidecar and map them onto the normalized holders envelope.

import { FundamentalsDataUnavailableError } from "./availability.ts";
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
  DEFAULT_DEV_PROVIDER_TIMEOUT_MS,
  postSidecar,
  providerPayloadError,
  sidecarUnavailableError,
  sidecarUnavailableReason,
} from "./dev-provider-sidecar.ts";
import {
  errorMessage,
  finiteNumber,
  integerValue,
  isRecord,
  issuerSidecarContext,
  nullableNumber,
  sidecarListingBody,
  stringValue,
  type DevProvidersRepositoryOptions,
} from "./dev-provider-shared.ts";
import type { UUID } from "./subject-ref.ts";

export type DevProvidersHoldersRepositoryOptions = DevProvidersRepositoryOptions;

type SidecarHolders = {
  currency?: unknown;
  as_of?: unknown;
  holders?: unknown;
};

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

function isInsiderTransactionType(value: string): value is InsiderTransaction["transaction_type"] {
  return (INSIDER_TRANSACTION_TYPES as ReadonlyArray<string>).includes(value);
}

// Shared building blocks for the dev-provider sidecar repositories (earnings,
// holders, consensus): the common options shape, the issuer→listing sidecar
// context, and the small value coercers each mapper uses to validate the
// untyped JSON the Python sidecar returns.

import type { DevProviderSidecarOptions } from "./dev-provider-sidecar.ts";
import type { IssuerProfileRepository } from "./issuer-repository.ts";
import type { IssuerProfileRecord } from "./profile.ts";
import type { UUID } from "./subject-ref.ts";

export type DevProvidersRepositoryOptions = DevProviderSidecarOptions & {
  profiles: IssuerProfileRepository;
  sourceId: UUID;
};

export type ListingSidecarContext = {
  ticker: string;
  mic: string;
  currency: string;
  timezone: string;
};

export type IssuerSidecarContext = {
  profile: IssuerProfileRecord;
  listing: ListingSidecarContext;
};

// Resolve the issuer's primary listing into the ticker/mic/currency/timezone the
// sidecar keys on. Returns null when the issuer has no profile or no exchange.
export async function issuerSidecarContext(
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

export function sidecarListingBody(context: ListingSidecarContext): Record<string, unknown> {
  return {
    ticker: context.ticker,
    mic: context.mic,
    currency: context.currency,
    timezone: context.timezone,
  };
}

export function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function integerValue(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

export function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function nullableNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Dev-provider consensus repository: fetch analyst consensus from the sidecar and
// map it onto a validated AnalystConsensusEnvelope. The mapper omits any
// internally-inconsistent sub-envelope (and takes the max analyst_count) so
// partial yfinance coverage still yields a useful, warning-free envelope.

import {
  buildAnalystConsensus,
  type AnalystRatingCounts,
  type BuildAnalystConsensusInput,
  type PriceTarget,
} from "./analyst-consensus.ts";
import type { ConsensusRepository } from "./consensus-repository.ts";
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
  sidecarListingBody,
  stringValue,
  type DevProvidersRepositoryOptions,
} from "./dev-provider-shared.ts";
import type { UUID } from "./subject-ref.ts";

export type DevProvidersConsensusRepositoryOptions = DevProvidersRepositoryOptions;

type SidecarConsensus = {
  as_of?: unknown;
  currency?: unknown;
  analyst_count?: unknown;
  rating_distribution?: unknown;
  price_target?: unknown;
};

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

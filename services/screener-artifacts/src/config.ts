// Pure env parsing for the screener-artifacts ETL. No IO — the CLI passes
// process.env in, so this is unit-testable. Defaults target the public
// xang1234/stock-screener GitHub Release, US-first.

export type ArtifactConfig = {
  enabled: boolean;
  repo: string;
  markets: string[];
  releaseBaseUrl: string;
};

const DEFAULTS = {
  repo: "xang1234/stock-screener",
  markets: ["US"],
  releaseBaseUrl: "https://github.com/xang1234/stock-screener/releases/download",
} as const;

export function loadArtifactConfig(env: Record<string, string | undefined>): ArtifactConfig {
  return {
    enabled: parseBool(env.SCREENER_ARTIFACTS_ENABLE),
    repo: nonEmpty(env.SCREENER_ARTIFACTS_REPO) ?? DEFAULTS.repo,
    markets: parseMarkets(env.SCREENER_ARTIFACTS_MARKETS),
    releaseBaseUrl: stripTrailingSlash(
      nonEmpty(env.SCREENER_ARTIFACTS_RELEASE_BASE_URL) ?? DEFAULTS.releaseBaseUrl,
    ),
  };
}

function parseBool(value: string | undefined): boolean {
  if (value === undefined) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parseMarkets(value: string | undefined): string[] {
  const markets = (value ?? "")
    .split(",")
    .map((m) => m.trim().toUpperCase())
    .filter((m) => m.length > 0);
  return markets.length > 0 ? markets : [...DEFAULTS.markets];
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

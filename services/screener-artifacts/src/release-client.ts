import { createHash } from "node:crypto";
import { decodeWeeklyBundle } from "./bundle.ts";
import { parseWeeklyManifest } from "./manifest.ts";
import type { ArtifactConfig } from "./config.ts";
import type { WeeklyReferenceBundle, WeeklyReferenceManifest } from "./types.ts";

const WEEKLY_RELEASE_TAG = "weekly-reference-data";

type FetchImpl = typeof fetch;

export class ReleaseFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReleaseFetchError";
  }
}

// The `latest` pointer asset uses a lowercase market suffix (weekly-reference-latest-us.json).
export function weeklyManifestUrl(config: ArtifactConfig, market: string): string {
  return `${config.releaseBaseUrl}/${WEEKLY_RELEASE_TAG}/weekly-reference-latest-${market.toLowerCase()}.json`;
}

export function weeklyBundleUrl(config: ArtifactConfig, assetName: string): string {
  return `${config.releaseBaseUrl}/${WEEKLY_RELEASE_TAG}/${assetName}`;
}

export async function fetchWeeklyManifest(
  config: ArtifactConfig,
  market: string,
  init: { fetchImpl?: FetchImpl } = {},
): Promise<WeeklyReferenceManifest> {
  const fetchImpl = init.fetchImpl ?? fetch;
  const url = weeklyManifestUrl(config, market);
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new ReleaseFetchError(`manifest fetch failed: HTTP ${response.status} for ${url}`);
  }
  return parseWeeklyManifest(await response.json());
}

export async function fetchWeeklyBundle(
  config: ArtifactConfig,
  manifest: WeeklyReferenceManifest,
  init: { fetchImpl?: FetchImpl } = {},
): Promise<WeeklyReferenceBundle> {
  const fetchImpl = init.fetchImpl ?? fetch;
  const url = weeklyBundleUrl(config, manifest.bundle_asset_name);
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new ReleaseFetchError(`bundle fetch failed: HTTP ${response.status} for ${url}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  verifySha256(bytes, manifest.sha256, url);
  return decodeWeeklyBundle(bytes);
}

// The manifest sha256 hashes the gzipped asset bytes (verified against a real
// release). A mismatch means a corrupted/truncated download — fail before decoding.
function verifySha256(bytes: Uint8Array, expected: string, url: string): void {
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) {
    throw new ReleaseFetchError(`sha256 mismatch for ${url}: expected ${expected}, got ${actual}`);
  }
}

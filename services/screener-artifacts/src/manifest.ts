import {
  WEEKLY_MANIFEST_SCHEMA,
  type WeeklyReferenceManifest,
} from "./types.ts";

// Parses + validates the `weekly-reference-latest-{market}.json` pointer. The
// schema_version gate fails fast on an unrecognized shape so a drifted upstream
// format never gets half-ingested (see the bundle parser for the same guard).
export function parseWeeklyManifest(raw: unknown): WeeklyReferenceManifest {
  if (!isObject(raw)) {
    throw new ManifestParseError("manifest is not a JSON object");
  }
  if (raw.schema_version !== WEEKLY_MANIFEST_SCHEMA) {
    throw new ManifestParseError(
      `unexpected schema_version: expected ${WEEKLY_MANIFEST_SCHEMA}, got ${String(raw.schema_version)}`,
    );
  }
  const market = requireString(raw, "market");
  const as_of_date = requireString(raw, "as_of_date");
  const bundle_asset_name = requireString(raw, "bundle_asset_name");
  const sha256 = requireString(raw, "sha256");
  const generated_at = requireString(raw, "generated_at");

  return {
    schema_version: WEEKLY_MANIFEST_SCHEMA,
    market,
    as_of_date,
    bundle_asset_name,
    sha256,
    generated_at,
    ...(isObject(raw.coverage) ? { coverage: coverageOf(raw.coverage) } : {}),
  };
}

export class ManifestParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestParseError";
  }
}

function coverageOf(raw: Record<string, unknown>): WeeklyReferenceManifest["coverage"] {
  return {
    ...(typeof raw.active_symbols === "number" ? { active_symbols: raw.active_symbols } : {}),
    ...(typeof raw.covered_active_symbols === "number"
      ? { covered_active_symbols: raw.covered_active_symbols }
      : {}),
    ...(typeof raw.missing_active_symbols === "number"
      ? { missing_active_symbols: raw.missing_active_symbols }
      : {}),
  };
}

function requireString(raw: Record<string, unknown>, key: string): string {
  const value = raw[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new ManifestParseError(`manifest field ${key} must be a non-empty string`);
  }
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import { gunzipSync } from "node:zlib";
import {
  WEEKLY_BUNDLE_SCHEMA,
  type BundleRow,
  type UniverseEntry,
  type WeeklyReferenceBundle,
} from "./types.ts";

// Decodes a gzip-compressed weekly-reference bundle asset: gunzip → JSON.parse →
// structural validation. Element-level (per-row) validation is deferred to the
// fact-mapper and universe-seed, which already guard nulls/types; here we only
// assert the envelope so a drifted shape fails fast before any DB write.
export function decodeWeeklyBundle(gz: Uint8Array): WeeklyReferenceBundle {
  let text: string;
  try {
    text = gunzipSync(gz).toString("utf8");
  } catch (error) {
    throw new BundleParseError(`failed to gunzip bundle: ${messageOf(error)}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(sanitizeNonFiniteNumbers(text));
  } catch (error) {
    throw new BundleParseError(`bundle is not valid JSON: ${messageOf(error)}`);
  }
  return parseWeeklyBundle(raw);
}

// The upstream producer is a Python pipeline; json.dumps(allow_nan=True) emits bare
// `NaN`/`Infinity`/`-Infinity` tokens, which are NOT valid JSON and crash JSON.parse.
// Rewrite them to null — but only in value position (preceded by `:` `,` or `[` and
// followed by a value terminator), so a "NaN" substring inside a quoted description
// is left untouched. The fact-mapper already drops null/non-finite stats.
export function sanitizeNonFiniteNumbers(text: string): string {
  return text.replace(/(?<=[:,[]\s*)(?:-?Infinity|NaN)(?=\s*[,}\]])/g, "null");
}

export function parseWeeklyBundle(raw: unknown): WeeklyReferenceBundle {
  if (!isObject(raw)) {
    throw new BundleParseError("bundle is not a JSON object");
  }
  if (raw.schema_version !== WEEKLY_BUNDLE_SCHEMA) {
    throw new BundleParseError(
      `unexpected schema_version: expected ${WEEKLY_BUNDLE_SCHEMA}, got ${String(raw.schema_version)}`,
    );
  }
  const market = requireString(raw, "market");
  const as_of_date = requireString(raw, "as_of_date");
  const snapshot = raw.snapshot;
  if (!isObject(snapshot) || !Array.isArray(snapshot.rows)) {
    throw new BundleParseError("bundle.snapshot.rows must be an array");
  }
  const universe = Array.isArray(raw.universe) ? (raw.universe as UniverseEntry[]) : [];

  return {
    schema_version: WEEKLY_BUNDLE_SCHEMA,
    market,
    as_of_date,
    snapshot: { rows: snapshot.rows as BundleRow[] },
    universe,
  };
}

export class BundleParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BundleParseError";
  }
}

function requireString(raw: Record<string, unknown>, key: string): string {
  const value = raw[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new BundleParseError(`bundle field ${key} must be a non-empty string`);
  }
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

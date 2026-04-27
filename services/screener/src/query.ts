// Screener query envelope (spec §6.7.1).
//
// The envelope is the single shape every screener consumer (UI, dynamic
// watchlists, agents, theme derivation) consumes. Five required dimensions:
//   - universe       — identity / membership filters (enum clauses)
//   - market         — quote/bar derived filters (numeric or enum clauses)
//   - fundamentals   — KeyStat / aggregate filters (numeric clauses)
//   - sort           — ordered list of (field, direction) sort specs
//   - page           — limit (1..LIMIT_MAX) and optional offset (>=0)
//
// Two contract-level invariants the validator enforces:
//   1. No freeform DSL: every clause names a field from `fields.ts`.
//   2. No raw provider columns: the registry is closed; unknown field
//      names are rejected at the envelope boundary.
//
// `normalizedScreenerQuery()` returns a frozen, canonicalized envelope —
// safe to use as a cache key input or to persist as the body of a
// `screen` subject (cw0.7.3).

import {
  getFieldDefinition,
  type FieldDefinition,
} from "./fields.ts";
import {
  assertFiniteNumber,
  assertIntegerInRange,
  assertNonNegativeInteger,
  assertOneOf,
} from "./validators.ts";

export type SortDirection = "asc" | "desc";
export const SORT_DIRECTIONS: ReadonlyArray<SortDirection> = ["asc", "desc"];

export const LIMIT_MIN = 1;
// Mirrors `/v1/screener/search` request schema cap. Hard cap protects the
// service from unbounded result-row assembly costs (cw0.7.2).
export const LIMIT_MAX = 500;

export type EnumClause = {
  field: string;
  values: ReadonlyArray<string>;
};

export type NumericClause = {
  field: string;
  // Inclusive bounds. At least one of `min` or `max` must be present —
  // an empty clause has no semantic meaning and is rejected.
  min?: number;
  max?: number;
};

export type ScreenerClause = EnumClause | NumericClause;

export type SortSpec = {
  field: string;
  direction: SortDirection;
};

export type ScreenerPage = {
  limit: number;
  offset?: number;
};

export type ScreenerQuery = {
  universe: ReadonlyArray<EnumClause>;
  market: ReadonlyArray<ScreenerClause>;
  fundamentals: ReadonlyArray<NumericClause>;
  sort: ReadonlyArray<SortSpec>;
  page: ScreenerPage;
};

export function normalizedScreenerQuery(input: ScreenerQuery): ScreenerQuery {
  if (input === null || typeof input !== "object") {
    throw new Error("normalizedScreenerQuery: must be an object");
  }

  const universe = freezeClauseArray(
    input.universe,
    "normalizedScreenerQuery.universe",
    "universe",
    { allowNumeric: false },
  ) as ReadonlyArray<EnumClause>;

  const market = freezeClauseArray(
    input.market,
    "normalizedScreenerQuery.market",
    "market",
    { allowNumeric: true },
  );

  const fundamentals = freezeClauseArray(
    input.fundamentals,
    "normalizedScreenerQuery.fundamentals",
    "fundamentals",
    { allowEnum: false },
  ) as ReadonlyArray<NumericClause>;

  const sort = freezeSortSpecs(input.sort, "normalizedScreenerQuery.sort");
  const page = freezePage(input.page, "normalizedScreenerQuery.page");

  return Object.freeze({
    universe,
    market,
    fundamentals,
    sort,
    page,
  });
}

export function assertScreenerQueryContract(
  value: unknown,
): asserts value is ScreenerQuery {
  if (value === null || typeof value !== "object") {
    throw new Error("screenerQuery: must be an object");
  }
  // Re-using normalize here would mutate-safely produce a frozen copy and
  // throw on every contract violation; that is exactly the assertion we
  // want at cross-boundary entry points (HTTP handlers, replay).
  normalizedScreenerQuery(value as ScreenerQuery);
}

type ClauseDimension = "universe" | "market" | "fundamentals";

function freezeClauseArray(
  value: unknown,
  label: string,
  dimension: ClauseDimension,
  opts: { allowEnum?: boolean; allowNumeric?: boolean } = {},
): ReadonlyArray<ScreenerClause> {
  const allowEnum = opts.allowEnum ?? true;
  const allowNumeric = opts.allowNumeric ?? true;

  if (!Array.isArray(value)) {
    throw new Error(`${label}: must be an array`);
  }

  const seenFields = new Set<string>();
  const frozen: ScreenerClause[] = [];

  for (let i = 0; i < value.length; i++) {
    const itemLabel = `${label}[${i}]`;
    const clause = value[i];
    if (clause === null || typeof clause !== "object") {
      throw new Error(`${itemLabel}: must be an object`);
    }
    const raw = clause as Record<string, unknown>;
    const field = raw.field;
    if (typeof field !== "string" || field.length === 0) {
      throw new Error(`${itemLabel}.field: must be a non-empty string`);
    }
    const def = getFieldDefinition(field);
    if (!def) {
      throw new Error(
        `${itemLabel}.field: unknown screener field "${field}" — only registered fields are queryable`,
      );
    }
    if (def.dimension !== dimension) {
      throw new Error(
        `${itemLabel}.field: "${field}" belongs to the ${def.dimension} dimension, not ${dimension}`,
      );
    }
    if (seenFields.has(field)) {
      throw new Error(
        `${itemLabel}.field: duplicate clause for "${field}" — combine bounds into a single clause`,
      );
    }
    seenFields.add(field);

    if (def.kind === "enum") {
      if (!allowEnum) {
        throw new Error(
          `${itemLabel}.field: enum field "${field}" is not allowed in the ${dimension} dimension`,
        );
      }
      frozen.push(freezeEnumClause(raw, def, itemLabel));
    } else {
      if (!allowNumeric) {
        throw new Error(
          `${itemLabel}.field: numeric field "${field}" is not allowed in the ${dimension} dimension`,
        );
      }
      frozen.push(freezeNumericClause(raw, def, itemLabel));
    }
  }

  return Object.freeze(frozen);
}

function freezeEnumClause(
  raw: Record<string, unknown>,
  def: FieldDefinition,
  label: string,
): EnumClause {
  if ("min" in raw || "max" in raw) {
    throw new Error(
      `${label}: enum field "${def.field}" must use "values", not numeric bounds`,
    );
  }
  const values = raw.values;
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(
      `${label}.values: enum clauses must contain at least one value`,
    );
  }
  const seen = new Set<string>();
  const frozenValues: string[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (typeof v !== "string" || v.length === 0) {
      throw new Error(
        `${label}.values[${i}]: must be a non-empty string`,
      );
    }
    if (def.enum_values && !def.enum_values.includes(v)) {
      throw new Error(
        `${label}.values[${i}]: "${v}" is not a registered value for field "${def.field}"`,
      );
    }
    if (seen.has(v)) {
      throw new Error(
        `${label}.values[${i}]: duplicate value "${v}"`,
      );
    }
    seen.add(v);
    frozenValues.push(v);
  }
  return Object.freeze({
    field: def.field,
    values: Object.freeze(frozenValues),
  });
}

function freezeNumericClause(
  raw: Record<string, unknown>,
  def: FieldDefinition,
  label: string,
): NumericClause {
  if ("values" in raw) {
    throw new Error(
      `${label}: numeric field "${def.field}" must use "min"/"max", not "values"`,
    );
  }
  const hasMin = raw.min !== undefined;
  const hasMax = raw.max !== undefined;
  if (!hasMin && !hasMax) {
    throw new Error(
      `${label}: numeric clause for "${def.field}" must specify at least one of "min" or "max"`,
    );
  }
  const out: { field: string; min?: number; max?: number } = {
    field: def.field,
  };
  if (hasMin) {
    assertFiniteNumber(raw.min, `${label}.min`);
    out.min = raw.min as number;
  }
  if (hasMax) {
    assertFiniteNumber(raw.max, `${label}.max`);
    out.max = raw.max as number;
  }
  if (
    out.min !== undefined &&
    out.max !== undefined &&
    out.min > out.max
  ) {
    throw new Error(
      `${label}: min (${out.min}) must be <= max (${out.max}) for field "${def.field}"`,
    );
  }
  return Object.freeze(out);
}

function freezeSortSpecs(
  value: unknown,
  label: string,
): ReadonlyArray<SortSpec> {
  if (!Array.isArray(value)) {
    throw new Error(`${label}: must be an array`);
  }
  if (value.length === 0) {
    // Replayable screens (cw0.7.3) need a deterministic ordering. Without
    // a sort spec, "rerun this screen tomorrow" can return identical rows
    // in different positions — a silent regression for downstream
    // dynamic watchlists and theme derivation.
    throw new Error(
      `${label}: at least one sort spec is required for deterministic ordering`,
    );
  }
  const seenFields = new Set<string>();
  const frozen: SortSpec[] = [];
  for (let i = 0; i < value.length; i++) {
    const itemLabel = `${label}[${i}]`;
    const item = value[i];
    if (item === null || typeof item !== "object") {
      throw new Error(`${itemLabel}: must be an object`);
    }
    const raw = item as Record<string, unknown>;
    if (typeof raw.field !== "string" || raw.field.length === 0) {
      throw new Error(`${itemLabel}.field: must be a non-empty string`);
    }
    const def = getFieldDefinition(raw.field);
    if (!def) {
      throw new Error(
        `${itemLabel}.field: unknown screener field "${raw.field}"`,
      );
    }
    if (!def.sortable) {
      throw new Error(
        `${itemLabel}.field: "${raw.field}" is not sortable`,
      );
    }
    if (seenFields.has(raw.field)) {
      throw new Error(
        `${itemLabel}.field: duplicate sort field "${raw.field}"`,
      );
    }
    seenFields.add(raw.field);
    assertOneOf(raw.direction, SORT_DIRECTIONS, `${itemLabel}.direction`);
    frozen.push(
      Object.freeze({
        field: def.field,
        direction: raw.direction as SortDirection,
      }),
    );
  }
  return Object.freeze(frozen);
}

function freezePage(value: unknown, label: string): ScreenerPage {
  if (value === null || typeof value !== "object") {
    throw new Error(`${label}: must be an object`);
  }
  const raw = value as Record<string, unknown>;
  assertIntegerInRange(raw.limit, `${label}.limit`, LIMIT_MIN, LIMIT_MAX);
  const out: { limit: number; offset?: number } = { limit: raw.limit as number };
  if (raw.offset !== undefined) {
    assertNonNegativeInteger(raw.offset, `${label}.offset`);
    out.offset = raw.offset as number;
  }
  return Object.freeze(out);
}

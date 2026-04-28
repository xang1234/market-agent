import type { QueryResult } from "pg";

// Minimal queryable surface — a `pg.Client` or `pg.Pool` both satisfy it,
// and callers can stub it in tests without dragging the full pg type in.
export type QueryExecutor = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
};

export type JsonObject = { [key: string]: JsonValue };

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | JsonObject;

function assertJsonValue(value: unknown, path: string, seen: Set<object>): asserts value is JsonValue {
  if (value === null) return;

  switch (typeof value) {
    case "boolean":
    case "string":
      return;
    case "number":
      if (Number.isFinite(value)) return;
      throw new TypeError(`JSON payload contains a non-finite number at ${path}`);
    case "bigint":
      throw new TypeError(`JSON payload contains a bigint at ${path}`);
    case "undefined":
    case "function":
    case "symbol":
      throw new TypeError(`JSON payload contains an unsupported ${typeof value} at ${path}`);
    case "object":
      break;
    default:
      throw new TypeError(`JSON payload contains an unsupported value at ${path}`);
  }

  if (seen.has(value)) {
    throw new TypeError(`JSON payload contains a circular reference at ${path}`);
  }

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        assertJsonValue(value[index], `${path}[${index}]`, seen);
      }
      return;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`JSON payload contains a non-plain object at ${path}`);
    }

    for (const [key, child] of Object.entries(value)) {
      assertJsonValue(child, `${path}.${key}`, seen);
    }
  } finally {
    seen.delete(value);
  }
}

export function serializeJsonValue(value: JsonValue): string {
  assertJsonValue(value, "$", new Set<object>());
  return JSON.stringify(value);
}

export function serializeNullableJsonValue(value: JsonValue | null | undefined): string | null {
  return value == null ? null : serializeJsonValue(value);
}

// The one JSON value type. Readonly because JSON the services pass around is
// deep-frozen at runtime (snapshots, tool results, run activity).
export type JsonObject = { readonly [key: string]: JsonValue };

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<JsonValue>
  | JsonObject;

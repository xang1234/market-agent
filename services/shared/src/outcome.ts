// What a fetch or hydration leaves on file (#769). "stored" holds at least one
// row and "failed" its cause, so neither "ok with nothing stored" (#665, #688)
// nor a failure without its cause can be written.
export type Outcome<Row> =
  | Readonly<{ status: "stored"; rows: NonEmpty<Row> }>
  | Readonly<{ status: "empty"; reason: string }>
  | Readonly<{ status: "failed"; cause: Error }>;

export type NonEmpty<T> = readonly [T, ...T[]];

export function isNonEmpty<T>(rows: ReadonlyArray<T>): rows is NonEmpty<T> {
  return rows.length > 0;
}

/** A failure with its cause; a thrown value that is not an Error is wrapped in one. */
export function failed(cause: unknown): Outcome<never> {
  return { status: "failed", cause: cause instanceof Error ? cause : new Error(String(cause)) };
}

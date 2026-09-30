// Adapts a hand-written fake to the generic `query<R>()` signature the
// repositories declare. The fake decides which rows come back; asserting them
// as R[] is the test double's contract, kept in this one place.
type FakeResult = { rows: unknown[]; rowCount?: number };

export function fakeQuery(
  handler: (text: string, values?: unknown[]) => FakeResult | Promise<FakeResult>,
) {
  return async <R,>(text: string, values?: unknown[]): Promise<{ rows: R[]; rowCount?: number }> => {
    const result = await handler(text, values);
    return { ...result, rows: result.rows as R[] };
  };
}

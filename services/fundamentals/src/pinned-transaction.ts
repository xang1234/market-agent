// Atomic writes against a pool: check out one client, run the action inside
// begin/commit on it, and always release it. A bare "begin" on a pool would
// not pin a connection, so writers that must commit together take this.

type RowQuery = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
};

export type PinnedTransactionClient<Q extends RowQuery = RowQuery> = Q & { release(): void };
export type TransactionalQueryExecutor<Q extends RowQuery = RowQuery> = Q & { connect(): Promise<PinnedTransactionClient<Q>> };

export async function withPinnedTransaction<Q extends RowQuery, T>(
  db: TransactionalQueryExecutor<Q>,
  action: (client: Q) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("begin");
    const result = await action(client);
    await client.query("commit");
    return result;
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // Preserve the original persistence error.
    }
    throw error;
  } finally {
    client.release();
  }
}

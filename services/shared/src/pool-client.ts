export type PoolClient = {
  release(destroy?: boolean | Error): void;
  on?(event: "error", listener: (error: Error) => void): unknown;
  off?(event: "error", listener: (error: Error) => void): unknown;
};

/**
 * Lends one pool client to `action` and releases it, destroyed when
 * `destroyAfter` says so for the error `action` threw. pg-pool stops
 * listening for a client's "error" event while the client is lent out, and pg
 * emits one when the connection is lost; an unheard one throws out of the
 * process. pg has already failed every query on that client with the same
 * error, so the caller hears it there and the event needs no handling.
 */
export async function withPoolClient<C extends PoolClient, T>(
  pool: { connect(): Promise<C> },
  action: (client: C) => Promise<T>,
  destroyAfter: (error: unknown) => boolean | Error | undefined = () => undefined,
): Promise<T> {
  const client = await pool.connect();
  const heard = () => {};
  client.on?.("error", heard);
  let destroy: boolean | Error | undefined;
  try {
    return await action(client);
  } catch (error) {
    destroy = destroyAfter(error);
    throw error;
  } finally {
    client.off?.("error", heard);
    client.release(destroy);
  }
}

/** A failed rollback leaves the client mid-transaction, so it is destroyed. */
export function destroyAfterFailedRollback(error: unknown): Error | undefined {
  return error instanceof Error && (error as { rollback_error?: unknown }).rollback_error !== undefined ? error : undefined;
}

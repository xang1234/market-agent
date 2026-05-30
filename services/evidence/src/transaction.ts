import type { QueryExecutor } from "./types.ts";

export type TransactionClient = QueryExecutor & {
  release(destroy?: boolean): void;
};

export type ConnectableQueryExecutor = QueryExecutor & {
  connect(): Promise<TransactionClient>;
};

export async function withPinnedClient<T>(
  db: QueryExecutor,
  action: (db: QueryExecutor) => Promise<T>,
): Promise<T> {
  if (!isConnectableQueryExecutor(db)) {
    return action(db);
  }

  const client = await db.connect();
  let destroyClient = false;
  try {
    return await action(client);
  } catch (error) {
    destroyClient = true;
    throw error;
  } finally {
    client.release(destroyClient || undefined);
  }
}

export async function withTransaction<T>(
  db: QueryExecutor,
  action: (tx: QueryExecutor) => Promise<T>,
): Promise<T> {
  if (isConnectableQueryExecutor(db)) {
    const client = await db.connect();
    let destroyClient = false;
    try {
      return await runTransaction(client, action);
    } catch (error) {
      destroyClient = true;
      throw error;
    } finally {
      client.release(destroyClient || undefined);
    }
  }

  return runTransaction(db, action);
}

function isConnectableQueryExecutor(db: QueryExecutor): db is ConnectableQueryExecutor {
  return typeof (db as Partial<ConnectableQueryExecutor>).connect === "function";
}

async function runTransaction<T>(
  db: QueryExecutor,
  action: (tx: QueryExecutor) => Promise<T>,
): Promise<T> {
  let commitAttempted = false;
  await db.query("begin");
  try {
    const result = await action(db);
    commitAttempted = true;
    await db.query("commit");
    return result;
  } catch (error) {
    if (!commitAttempted) {
      await rollbackBestEffort(db, error);
    }
    throw error;
  }
}

async function rollbackBestEffort(db: QueryExecutor, originalError: unknown): Promise<void> {
  try {
    await db.query("rollback");
  } catch (rollbackError) {
    if (originalError instanceof Error) {
      (originalError as { rollback_error?: unknown }).rollback_error = rollbackError;
    }
  }
}

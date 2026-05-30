import type { QueryExecutor } from "./types.ts";

export type TransactionClient = QueryExecutor & {
  release(destroy?: boolean | Error): void;
};

export type ConnectableQueryExecutor = QueryExecutor & {
  connect(): Promise<TransactionClient>;
};

export type TransactionRollbackCleanup = (error: unknown) => Promise<void> | void;

type TransactionScope = {
  rollbackCleanups: TransactionRollbackCleanup[];
};

const ACTIVE_TRANSACTIONS = new WeakMap<object, TransactionScope>();

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
    client.release(destroyClient);
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
      client.release(destroyClient);
    }
  }

  if (isActiveTransaction(db)) {
    return action(db);
  }

  return runTransaction(db, action);
}

export function isConnectableQueryExecutor(db: QueryExecutor): db is ConnectableQueryExecutor {
  return (
    typeof (db as Partial<ConnectableQueryExecutor>).connect === "function" &&
    typeof (db as Partial<TransactionClient>).release !== "function" &&
    !hasPgClientConnectionParameters(db)
  );
}

function hasPgClientConnectionParameters(db: QueryExecutor): boolean {
  return (
    db !== null &&
    typeof db === "object" &&
    Object.prototype.hasOwnProperty.call(db, "connectionParameters")
  );
}

export function assertActiveTransaction(db: QueryExecutor, label: string): void {
  if (!isActiveTransaction(db)) {
    throw new Error(`${label} requires an active transaction; use withTransaction`);
  }
}

export function onTransactionRollback(
  db: QueryExecutor,
  cleanup: TransactionRollbackCleanup,
): () => void {
  const scope = transactionScope(db);
  if (!scope) {
    throw new Error("onTransactionRollback requires an active transaction; use withTransaction");
  }
  scope.rollbackCleanups.push(cleanup);
  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    const index = scope.rollbackCleanups.indexOf(cleanup);
    if (index >= 0) {
      scope.rollbackCleanups.splice(index, 1);
    }
  };
}

function isActiveTransaction(db: QueryExecutor): boolean {
  return transactionScope(db) !== null;
}

function transactionScope(db: QueryExecutor): TransactionScope | null {
  if (db === null || typeof db !== "object") return null;
  return ACTIVE_TRANSACTIONS.get(db) ?? null;
}

async function runTransaction<T>(
  db: QueryExecutor,
  action: (tx: QueryExecutor) => Promise<T>,
): Promise<T> {
  let commitAttempted = false;
  await db.query("begin");
  const scope: TransactionScope = { rollbackCleanups: [] };
  const key = db as object;
  ACTIVE_TRANSACTIONS.set(key, scope);
  try {
    const result = await action(db);
    commitAttempted = true;
    await db.query("commit");
    return result;
  } catch (error) {
    if (!commitAttempted) {
      await rollbackBestEffort(db, error);
      await runRollbackCleanups(scope, error);
    }
    throw error;
  } finally {
    ACTIVE_TRANSACTIONS.delete(key);
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

async function runRollbackCleanups(scope: TransactionScope, originalError: unknown): Promise<void> {
  const errors: unknown[] = [];
  for (const cleanup of [...scope.rollbackCleanups].reverse()) {
    try {
      await cleanup(originalError);
    } catch (cleanupError) {
      errors.push(cleanupError);
    }
  }
  if (errors.length > 0 && originalError instanceof Error) {
    (originalError as { rollback_cleanup_errors?: unknown[] }).rollback_cleanup_errors = errors;
  }
}

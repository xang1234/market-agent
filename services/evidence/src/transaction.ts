import type { QueryExecutor } from "./types.ts";

const TRANSACTION_CONTEXT: unique symbol = Symbol("evidence.transactionContext");
const TRANSACTION_EXECUTOR: unique symbol = Symbol("evidence.transactionExecutor");

export type TransactionClient = QueryExecutor & {
  release(destroy?: boolean | Error): void;
};

type ConnectableQueryExecutor = QueryExecutor & {
  connect(): Promise<TransactionClient>;
};

export type TransactionRollbackCleanup = (error: unknown) => Promise<void> | void;

type TransactionContextBrand = {
  readonly [TRANSACTION_CONTEXT]: true;
};

type TransactionExecutorBrand = {
  readonly [TRANSACTION_EXECUTOR]: true;
};

export type TransactionExecutor = QueryExecutor & TransactionExecutorBrand;

export type TransactionContext = Readonly<{
  db: TransactionExecutor;
  onRollback(cleanup: TransactionRollbackCleanup): () => void;
} & TransactionContextBrand>;

type TransactionScope = {
  rollbackCleanups: TransactionRollbackCleanup[];
};

export async function withTransaction<T>(
  db: QueryExecutor,
  action: (tx: TransactionContext) => Promise<T>,
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

  return runTransaction(db, action);
}

export function assertTransactionContext(
  tx: TransactionContext | undefined,
  label: string,
): asserts tx is TransactionContext {
  if ((tx as Partial<TransactionContextBrand> | undefined)?.[TRANSACTION_CONTEXT] !== true) {
    throw new Error(`${label} requires a TransactionContext from withTransaction`);
  }
}

function isConnectableQueryExecutor(db: QueryExecutor): db is ConnectableQueryExecutor {
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

async function runTransaction<T>(
  db: QueryExecutor,
  action: (tx: TransactionContext) => Promise<T>,
): Promise<T> {
  let commitAttempted = false;
  await db.query("begin");
  const scope: TransactionScope = { rollbackCleanups: [] };
  const tx = createTransactionContext(db, scope);
  try {
    const result = await action(tx);
    commitAttempted = true;
    await db.query("commit");
    return result;
  } catch (error) {
    if (!commitAttempted) {
      await rollbackBestEffort(db, error);
      await runRollbackCleanups(scope, error);
    }
    throw error;
  }
}

function createTransactionContext(db: QueryExecutor, scope: TransactionScope): TransactionContext {
  return Object.freeze({
    db: db as TransactionExecutor,
    onRollback(cleanup: TransactionRollbackCleanup): () => void {
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
    },
    [TRANSACTION_CONTEXT]: true as const,
  });
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

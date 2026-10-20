export type FinancialEnv = {
  FINANCIAL_WORKER_ENABLED?: string;
};

export type FinancialModes = Readonly<{
  /** The supervised recovery worker, which writes certificates too. */
  worker: boolean;
}>;

/** What must be ready before this process starts: analyze and thesis (always on the engine), and the worker. */
export function activeFinancialSurfaces(modes: FinancialModes): string[] {
  return ["analyze", "thesis", ...(modes.worker ? ["worker"] : [])];
}

function financialWorkerEnabled(env: Pick<FinancialEnv, "FINANCIAL_WORKER_ENABLED">): boolean {
  const value = env.FINANCIAL_WORKER_ENABLED?.trim() ?? "";
  if (value === "" || value === "true") return true;
  if (value === "false") return false;
  throw new Error(`FINANCIAL_WORKER_ENABLED must be true or false (got ${JSON.stringify(env.FINANCIAL_WORKER_ENABLED)})`);
}

export function loadFinancialModes(env: FinancialEnv): FinancialModes {
  return Object.freeze({ worker: financialWorkerEnabled(env) });
}

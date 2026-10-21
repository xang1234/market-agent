// No finance setting enables Discovery; DISCOVERY_ENABLED alone does, in its own worker.
export type FinancialEnv = {
  FINANCIAL_WORKER_ENABLED?: string;
};

export type FinancialConfig = Readonly<{
  /** The supervised recovery worker, which writes certificates too. */
  worker: boolean;
}>;

/** What must be ready before this process starts: analyze and thesis (always on the engine), and the worker. */
export function activeFinancialSurfaces(config: FinancialConfig): [string, ...string[]] {
  return ["analyze", "thesis", ...(config.worker ? ["worker"] : [])];
}

function financialWorkerEnabled(env: Pick<FinancialEnv, "FINANCIAL_WORKER_ENABLED">): boolean {
  const value = env.FINANCIAL_WORKER_ENABLED?.trim() ?? "";
  if (value === "" || value === "true") return true;
  if (value === "false") return false;
  throw new Error(`FINANCIAL_WORKER_ENABLED must be true or false (got ${JSON.stringify(env.FINANCIAL_WORKER_ENABLED)})`);
}

export function loadFinancialConfig(env: FinancialEnv): FinancialConfig {
  return Object.freeze({ worker: financialWorkerEnabled(env) });
}

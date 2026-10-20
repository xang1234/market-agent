import { parseFinancialMode, type FinancialMode } from "../../financial-engine/src/request.ts";

export type FinancialEnv = {
  ANALYZE_FINANCIAL_MODE?: string;
  THESIS_FINANCIAL_MODE?: string;
  FINANCIAL_WORKER_ENABLED?: string;
};

export type FinancialModes = Readonly<{
  analyze: FinancialMode;
  thesis: FinancialMode;
  /** The supervised recovery worker, which writes certificates too. */
  worker: boolean;
}>;

/** What must be ready before this process starts: every surface not off, and the worker. */
export function activeFinancialSurfaces(modes: FinancialModes): string[] {
  return [
    ...(["analyze", "thesis"] as const).filter((surface) => modes[surface] !== "off"),
    ...(modes.worker ? ["worker"] : []),
  ];
}

function financialWorkerEnabled(env: Pick<FinancialEnv, "FINANCIAL_WORKER_ENABLED">): boolean {
  const value = env.FINANCIAL_WORKER_ENABLED?.trim() ?? "";
  if (value === "" || value === "true") return true;
  if (value === "false") return false;
  throw new Error(`FINANCIAL_WORKER_ENABLED must be true or false (got ${JSON.stringify(env.FINANCIAL_WORKER_ENABLED)})`);
}

export function loadFinancialModes(env: FinancialEnv): FinancialModes {
  return Object.freeze({
    analyze: parseFinancialMode(env.ANALYZE_FINANCIAL_MODE, "ANALYZE_FINANCIAL_MODE"),
    thesis: parseFinancialMode(env.THESIS_FINANCIAL_MODE, "THESIS_FINANCIAL_MODE"),
    worker: financialWorkerEnabled(env),
  });
}

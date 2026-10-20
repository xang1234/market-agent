// The dev API's verified-finance configuration, read once from the server's
// environment: one off/enforce mode per surface this process serves.
// Modes are server-owned: nothing in a request, a plan, or model output can
// change them. Chat and grids run in their own services and read their own
// flags (CHAT_FINANCIAL_MODE, GRID_FINANCIAL_MODE); Discovery is enabled only
// by DISCOVERY_ENABLED in its own worker, never by a finance flag.

import { parseFinancialMode, type FinancialMode } from "../../financial-engine/src/request.ts";

export type FinancialEnv = {
  ANALYZE_FINANCIAL_MODE?: string;
  GRID_FINANCIAL_MODE?: string;
  THESIS_FINANCIAL_MODE?: string;
  FINANCIAL_WORKER_ENABLED?: string;
};

export type FinancialModes = Readonly<{
  analyze: FinancialMode;
  /** Registers grid recovery with this process's worker; grid runs themselves execute in analyst-grids. */
  grid: FinancialMode;
  thesis: FinancialMode;
  /** The supervised recovery worker, which writes certificates too. */
  worker: boolean;
}>;

/** What must be ready before this process starts: every surface not off, and the worker. */
export function activeFinancialSurfaces(modes: FinancialModes): string[] {
  return [
    ...(["analyze", "grid", "thesis"] as const).filter((surface) => modes[surface] !== "off"),
    ...(modes.worker ? ["worker"] : []),
  ];
}

export function loadFinancialModes(env: FinancialEnv): FinancialModes {
  return Object.freeze({
    analyze: parseFinancialMode(env.ANALYZE_FINANCIAL_MODE, "ANALYZE_FINANCIAL_MODE"),
    grid: parseFinancialMode(env.GRID_FINANCIAL_MODE, "GRID_FINANCIAL_MODE"),
    thesis: parseFinancialMode(env.THESIS_FINANCIAL_MODE, "THESIS_FINANCIAL_MODE"),
    worker: env.FINANCIAL_WORKER_ENABLED === "true",
  });
}

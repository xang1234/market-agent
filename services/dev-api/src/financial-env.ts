// The dev API's verified-finance configuration, read once from the server's
// environment: one off/shadow/enforce mode per surface this process serves.
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
  /** Saved conditions are verified or not: there is no shadow thesis assessment. */
  thesis: "off" | "enforce";
  /** The supervised recovery worker counts as a surface: it writes certificates too. */
  worker: "off" | "enforce";
}>;

export function loadFinancialModes(env: FinancialEnv): FinancialModes {
  const thesis = parseFinancialMode(env.THESIS_FINANCIAL_MODE, "THESIS_FINANCIAL_MODE");
  if (thesis === "shadow") throw new Error("THESIS_FINANCIAL_MODE must be off or enforce");
  return Object.freeze({
    analyze: parseFinancialMode(env.ANALYZE_FINANCIAL_MODE, "ANALYZE_FINANCIAL_MODE"),
    grid: parseFinancialMode(env.GRID_FINANCIAL_MODE, "GRID_FINANCIAL_MODE"),
    thesis,
    worker: env.FINANCIAL_WORKER_ENABLED === "true" ? "enforce" : "off",
  });
}

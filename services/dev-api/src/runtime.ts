import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  createFixtureDevApiAdapters,
  createServiceDevApiAdapters,
  type DevApiAdapters,
  type DevApiServiceAdapterDeps,
} from "./http.ts";
import type { DiscoveryService } from "../../discovery/src/ports.ts";
import { startFinancialWorkerFromEnv, type FinancialWorkerEnv } from "./financial-worker-bootstrap.ts";
import { loadFinancialModes, type FinancialEnv } from "./financial-env.ts";
import { analyzeFinancialRecovery } from "../../analyze/src/financial-section.ts";
import { gridFinancialRecovery } from "../../analyst-grids/src/financial-column.ts";
import { requireFinancialReadiness } from "../../financial-engine/src/readiness.ts";
import type { FinancialWorker } from "../../financial-engine/src/worker.ts";

export type DevApiRuntimeEnv = FinancialWorkerEnv & FinancialEnv & {
  MA_DEV_API_FIXTURE_ADAPTER?: string;
  DEV_API_DATABASE_URL?: string;
  DATABASE_URL?: string;
  DEV_API_RUNTIME_MODULE?: string;
  DEV_API_ANALYZE_SEAL_MODULE?: string;
};

let financialWorker: FinancialWorker | null = null;

/** Stops the financial worker, waiting at most `timeoutMs` for the tick in flight; its lease then expires and recovery resumes it. */
export async function stopDevApiWorkers(timeoutMs = 10_000): Promise<void> {
  const worker = financialWorker;
  financialWorker = null;
  if (!worker) return;
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([worker.stop(), new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); })]);
  clearTimeout(timer);
}

const DEFAULT_DEV_API_RUNTIME_MODULE = new URL("./local-runtime.ts", import.meta.url).href;

export async function createDevApiAdaptersFromEnv(
  env: DevApiRuntimeEnv = process.env,
  cwd = process.cwd(),
): Promise<DevApiAdapters | undefined> {
  if (env.MA_DEV_API_FIXTURE_ADAPTER === "true") {
    return createFixtureDevApiAdapters();
  }
  const databaseUrl = env.DEV_API_DATABASE_URL ?? env.DATABASE_URL;
  const sealModulePath = env.DEV_API_RUNTIME_MODULE?.trim() ||
    env.DEV_API_ANALYZE_SEAL_MODULE?.trim() ||
    DEFAULT_DEV_API_RUNTIME_MODULE;
  if (!databaseUrl) return undefined;
  const financialModes = loadFinancialModes(env);

  const module = await import(moduleSpecifier(sealModulePath, cwd));
  if (typeof module.sealAnalyzeSnapshot !== "function") {
    throw new Error("DEV_API_RUNTIME_MODULE must export sealAnalyzeSnapshot");
  }
  if (module.runAnalyzeWorkflow !== undefined && typeof module.runAnalyzeWorkflow !== "function") {
    throw new Error("DEV_API_RUNTIME_MODULE runAnalyzeWorkflow export must be a function");
  }
  if (module.createAgentLoopStages !== undefined && typeof module.createAgentLoopStages !== "function") {
    throw new Error("DEV_API_RUNTIME_MODULE createAgentLoopStages export must be a function");
  }
  if (module.inspectEvidence !== undefined && typeof module.inspectEvidence !== "function") {
    throw new Error("DEV_API_RUNTIME_MODULE inspectEvidence export must be a function");
  }
  if (module.buildAnalyzeRunSeals !== undefined && typeof module.buildAnalyzeRunSeals !== "function") {
    throw new Error("DEV_API_RUNTIME_MODULE buildAnalyzeRunSeals export must be a function");
  }
  if (module.createDiscoveryService !== undefined && typeof module.createDiscoveryService !== "function") {
    throw new Error("DEV_API_RUNTIME_MODULE createDiscoveryService export must be a function");
  }
  if (module.analyzeFinancial !== undefined && typeof module.analyzeFinancial?.publish !== "function") {
    throw new Error("DEV_API_RUNTIME_MODULE analyzeFinancial export must provide publish()");
  }

  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: databaseUrl });
  // Nothing financial starts, the worker included, until its schema and versions are in place.
  await requireFinancialReadiness(pool, financialModes);
  // Parents whose verified units are resumable after a restart; others register as they adopt the engine.
  financialWorker = startFinancialWorkerFromEnv(pool, env, {
    ...(module.analyzeFinancial ? { analyze_memo_run: analyzeFinancialRecovery(pool) } : {}),
    ...(financialModes.grid === "enforce" ? { analyst_grid_run: gridFinancialRecovery(pool) } : {}),
  });
  const discovery = module.createDiscoveryService === undefined
    ? undefined
    : await module.createDiscoveryService({ db: pool }) as DiscoveryService;
  return createServiceDevApiAdapters({
    db: pool,
    sealAnalyzeSnapshot: module.sealAnalyzeSnapshot as DevApiServiceAdapterDeps["sealAnalyzeSnapshot"],
    buildAnalyzeRunSeals: module.buildAnalyzeRunSeals as DevApiServiceAdapterDeps["buildAnalyzeRunSeals"],
    runAnalyzeWorkflow: module.runAnalyzeWorkflow as DevApiServiceAdapterDeps["runAnalyzeWorkflow"],
    createAgentLoopStages: module.createAgentLoopStages as DevApiServiceAdapterDeps["createAgentLoopStages"],
    inspectEvidence: module.inspectEvidence as DevApiServiceAdapterDeps["inspectEvidence"],
    analyzeFinancial: module.analyzeFinancial as DevApiServiceAdapterDeps["analyzeFinancial"],
    discovery,
  });
}

function moduleSpecifier(specifier: string, cwd: string): string {
  if (specifier.startsWith("file:")) return specifier;
  if (specifier.startsWith(".") || isAbsolute(specifier)) {
    return pathToFileURL(resolve(cwd, specifier)).href;
  }
  return specifier;
}

import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  createFixtureDevApiAdapters,
  createServiceDevApiAdapters,
  type DevApiAdapters,
  type DevApiServiceAdapterDeps,
} from "./http.ts";

export type DevApiRuntimeEnv = {
  MA_DEV_API_FIXTURE_ADAPTER?: string;
  DEV_API_DATABASE_URL?: string;
  DATABASE_URL?: string;
  DEV_API_ANALYZE_SEAL_MODULE?: string;
};

const DEFAULT_DEV_API_RUNTIME_MODULE = "./src/local-runtime.ts";

export async function createDevApiAdaptersFromEnv(
  env: DevApiRuntimeEnv = process.env,
  cwd = process.cwd(),
): Promise<DevApiAdapters | undefined> {
  if (env.MA_DEV_API_FIXTURE_ADAPTER === "true") {
    return createFixtureDevApiAdapters();
  }
  const databaseUrl = env.DEV_API_DATABASE_URL ?? env.DATABASE_URL;
  const sealModulePath = env.DEV_API_ANALYZE_SEAL_MODULE?.trim() || DEFAULT_DEV_API_RUNTIME_MODULE;
  if (!databaseUrl) return undefined;

  const module = await import(moduleSpecifier(sealModulePath, cwd));
  if (typeof module.sealAnalyzeSnapshot !== "function") {
    throw new Error("DEV_API_ANALYZE_SEAL_MODULE must export sealAnalyzeSnapshot");
  }
  if (module.runAnalyzeWorkflow !== undefined && typeof module.runAnalyzeWorkflow !== "function") {
    throw new Error("DEV_API_ANALYZE_SEAL_MODULE runAnalyzeWorkflow export must be a function");
  }
  if (module.createAgentLoopStages !== undefined && typeof module.createAgentLoopStages !== "function") {
    throw new Error("DEV_API_ANALYZE_SEAL_MODULE createAgentLoopStages export must be a function");
  }

  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: databaseUrl });
  return createServiceDevApiAdapters({
    db: pool,
    sealAnalyzeSnapshot: module.sealAnalyzeSnapshot as DevApiServiceAdapterDeps["sealAnalyzeSnapshot"],
    runAnalyzeWorkflow: module.runAnalyzeWorkflow as DevApiServiceAdapterDeps["runAnalyzeWorkflow"],
    createAgentLoopStages: module.createAgentLoopStages as DevApiServiceAdapterDeps["createAgentLoopStages"],
  });
}

function moduleSpecifier(specifier: string, cwd: string): string {
  if (specifier.startsWith("file:")) return specifier;
  if (specifier.startsWith(".") || isAbsolute(specifier)) {
    return pathToFileURL(resolve(cwd, specifier)).href;
  }
  return specifier;
}

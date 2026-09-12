import type { WorkerDeps } from "./ports.ts";
import { runDiscoveryWorker } from "./worker.ts";
import { pathToFileURL } from "node:url";

/** The composition is supplied by the service entrypoint, after feature gating. */
export async function runDiscoveryWorkerCli(deps: WorkerDeps, pollMs = 1_000): Promise<void> {
  const controller = new AbortController();
  const stop = () => controller.abort(new DOMException("Discovery worker received a stop signal", "AbortError"));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try { await runDiscoveryWorker(deps, { signal: controller.signal, pollMs }); }
  finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  throw new Error("Discovery worker requires service-provided per-user adapter composition; invoke runDiscoveryWorkerCli from the runtime entrypoint.");
}

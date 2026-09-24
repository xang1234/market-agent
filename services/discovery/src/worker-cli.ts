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

type WorkerRuntime = { createDiscoveryWorkerDeps: () => WorkerDeps | Promise<WorkerDeps> };

/**
 * The shell entrypoint deliberately loads a deployment-owned composition
 * module. This keeps user-scoped provider adapters out of the library and
 * makes a missing production configuration a visible worker-readiness error.
 */
export async function runDiscoveryWorkerFromEnvironment(env = process.env): Promise<void> {
  if (env.DISCOVERY_ENABLED !== "true") return;
  const modulePath = env.DISCOVERY_WORKER_MODULE;
  if (!modulePath) throw new Error("DISCOVERY_WORKER_MODULE is required when DISCOVERY_ENABLED=true");
  const runtime = await import(pathToFileURL(modulePath).href) as Partial<WorkerRuntime>;
  if (typeof runtime.createDiscoveryWorkerDeps !== "function") throw new Error("DISCOVERY_WORKER_MODULE must export createDiscoveryWorkerDeps()");
  const pollMs = Number(env.DISCOVERY_WORKER_POLL_MS ?? "1000");
  if (!Number.isInteger(pollMs) || pollMs < 1 || pollMs > 60_000) throw new Error("DISCOVERY_WORKER_POLL_MS must be an integer between 1 and 60000");
  await runDiscoveryWorkerCli(await runtime.createDiscoveryWorkerDeps(), pollMs);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runDiscoveryWorkerFromEnvironment().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

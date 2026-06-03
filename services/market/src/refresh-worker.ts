import { fileURLToPath } from "node:url";

import { runQuoteRefreshOnce } from "./quote-refresh.ts";
import { createMarketStackFromEnv } from "./stack.ts";

function integerEnv(name: string): number | undefined {
  const value = process.env[name]?.trim();
  if (!value) return undefined;
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`${name} must be a positive integer`);
  return Number(value);
}

async function main(): Promise<void> {
  const stack = createMarketStackFromEnv(process.env);
  try {
    // No defaults here: runQuoteRefreshOnce owns the fallback values, and
    // integerEnv yields undefined when a var is unset — single source of truth.
    const summary = await runQuoteRefreshOnce({
      cache: stack.cache,
      adapter: stack.adapter,
      activeWindowMs: integerEnv("QUOTE_REFRESH_ACTIVE_WINDOW_MS"),
      limit: integerEnv("QUOTE_REFRESH_LIMIT"),
    });
    console.log(JSON.stringify(summary));
  } finally {
    await stack.pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

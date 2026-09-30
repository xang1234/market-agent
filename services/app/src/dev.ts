// One-process dev app for DEV_PROFILE=chat (#122): the web UI (Vite in middleware
// mode) plus the chat, resolver, dev-api, market and fundamentals request handlers,
// on one port. Each service's own dev.ts still runs it standalone (DEV_PROFILE=full).
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildChatDevServer } from "../../chat/src/dev-server.ts";
import { buildDevApiDevServer } from "../../dev-api/src/dev-server.ts";
import { buildFundamentalsDevServer } from "../../fundamentals/src/dev-server.ts";
import { buildMarketDevServer } from "../../market/src/dev-server.ts";
import { buildResolverDevServer } from "../../resolver/src/dev-server.ts";
import { routeFor, type DevService } from "./routes.ts";

type Handler = (req: IncomingMessage, res: ServerResponse) => void;
type ViteModule = {
  createServer(config: object): Promise<{ middlewares: Handler; close(): Promise<void> }>;
};

const host = process.env.APP_HOST ?? "127.0.0.1";
const port = Number(process.env.APP_PORT ?? process.env.WEB_PORT ?? "5173");
const webRoot = fileURLToPath(new URL("../../../web/", import.meta.url));

const services: Record<DevService, { server: Server; close: () => Promise<void> }> = {
  chat: await buildChatDevServer(process.env),
  resolver: await buildResolverDevServer(process.env),
  "dev-api": await buildDevApiDevServer(process.env),
  market: await buildMarketDevServer(process.env),
  fundamentals: await buildFundamentalsDevServer(process.env),
};

// Each create*Server wraps a single request listener; reuse it without its own socket.
function requestHandlerOf(name: string, server: Server): Handler {
  const [handler] = server.listeners("request");
  if (typeof handler !== "function") {
    throw new Error(`${name} server has no request listener`);
  }
  return handler as Handler;
}
const handlers = Object.fromEntries(
  Object.entries(services).map(([name, { server }]) => [name, requestHandlerOf(name, server)]),
) as Record<DevService, Handler>;

const httpServer = createServer();

// Vite comes from the web package (its version and config), so the UI shares this port.
const viteEntry = createRequire(`${webRoot}package.json`).resolve("vite");
const { createServer: createViteServer } = (await import(pathToFileURL(viteEntry).href)) as ViteModule;
const vite = await createViteServer({
  root: webRoot,
  configFile: `${webRoot}vite.config.ts`,
  appType: "spa",
  server: { middlewareMode: true, hmr: { server: httpServer } },
});

httpServer.on("request", (req: IncomingMessage, res: ServerResponse) => {
  const route = routeFor(new URL(req.url ?? "/", "http://app.local").pathname);
  if (route.kind === "service") {
    handlers[route.service](req, res);
  } else if (route.kind === "parked") {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: `${route.prefix} is parked under DEV_PROFILE=chat; use DEV_PROFILE=full` }));
  } else {
    vite.middlewares(req, res);
  }
});

httpServer.listen(port, host, () => {
  console.log(
    `app listening on http://${host}:${port} (web + ${Object.keys(services).join(", ")}; DEV_PROFILE=chat)`,
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    httpServer.close();
    void Promise.allSettled([vite.close(), ...Object.values(services).map((s) => s.close())]).finally(() =>
      process.exit(0),
    );
  });
}

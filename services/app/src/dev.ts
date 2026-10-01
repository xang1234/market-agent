// One-process dev app for DEV_PROFILE=chat (#122): the web UI (Vite in middleware
// mode) plus the chat, resolver, dev-api, market and fundamentals request handlers,
// on one port. Each service's own dev.ts still runs it standalone (DEV_PROFILE=full).
//
// UI mode (DEV_MODE=ui, #123) builds no services: /v1 is served from a recorded fixture
// (DEV_REPLAY_FILE), so there is no database and no network. DEV_CAPTURE_FILE records
// the /v1 traffic of a normal run into such a fixture.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createCapture, createReplayHandler, loadReplayFixture } from "./replay.ts";
import { isApiPath, routeFor, type DevService } from "./routes.ts";

type Handler = (req: IncomingMessage, res: ServerResponse) => void;
type ViteModule = {
  createServer(config: object): Promise<{ middlewares: Handler; close(): Promise<void> }>;
};

const host = process.env.APP_HOST ?? "127.0.0.1";
const port = Number(process.env.APP_PORT ?? process.env.WEB_PORT ?? "5173");
const webRoot = fileURLToPath(new URL("../../../web/", import.meta.url));
const uiMode = process.env.DEV_MODE === "ui";
const DEFAULT_REPLAY_FILE = fileURLToPath(new URL("../fixtures/golden-conversation.replay.json", import.meta.url));

// Each create*Server wraps a single request listener; reuse it without its own socket.
function requestHandlerOf(name: string, server: Server): Handler {
  const [handler] = server.listeners("request");
  if (typeof handler !== "function") {
    throw new Error(`${name} server has no request listener`);
  }
  return handler as Handler;
}

let services: Partial<Record<DevService, { server: Server; close: () => Promise<void> }>> = {};
let api: Handler;
if (uiMode) {
  const replayFile = process.env.DEV_REPLAY_FILE || DEFAULT_REPLAY_FILE;
  api = createReplayHandler(await loadReplayFixture(replayFile));
  console.log(`UI mode: replaying ${replayFile} (no services, database or network)`);
} else {
  // Imported here, not at the top: UI mode needs none of these (or their packages).
  const { buildChatDevServer } = await import("../../chat/src/dev-server.ts");
  const { buildDevApiDevServer } = await import("../../dev-api/src/dev-server.ts");
  const { buildFundamentalsDevServer } = await import("../../fundamentals/src/dev-server.ts");
  const { buildMarketDevServer } = await import("../../market/src/dev-server.ts");
  const { buildResolverDevServer } = await import("../../resolver/src/dev-server.ts");
  services = {
    chat: await buildChatDevServer(process.env),
    resolver: await buildResolverDevServer(process.env),
    "dev-api": await buildDevApiDevServer(process.env),
    market: await buildMarketDevServer(process.env),
    fundamentals: await buildFundamentalsDevServer(process.env),
  };
  const handlers = Object.fromEntries(
    Object.entries(services).map(([name, built]) => [name, requestHandlerOf(name, built!.server)]),
  ) as Record<DevService, Handler>;
  const serve: Handler = (req, res) => {
    const route = routeFor(new URL(req.url ?? "/", "http://app.local").pathname);
    if (route.kind === "service") {
      handlers[route.service](req, res);
    } else if (route.kind === "parked") {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: `${route.prefix} is parked under DEV_PROFILE=chat; use DEV_PROFILE=full` }));
    } else {
      // A /v1 prefix the route table doesn't know (services/app/src/routes.ts).
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: `unknown API route ${req.url}; add its prefix to services/app/src/routes.ts` }));
    }
  };
  const captureFile = process.env.DEV_CAPTURE_FILE;
  api = captureFile ? createCapture(captureFile)(serve) : serve;
  if (captureFile) console.log(`capturing /v1 traffic to ${captureFile}`);
}

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
  // Every /v1 request goes to the API side (served, parked, replayed or unknown), so it
  // gets a JSON answer; the rest is the web app.
  if (isApiPath(new URL(req.url ?? "/", "http://app.local").pathname)) {
    api(req, res);
  } else {
    vite.middlewares(req, res);
  }
});

httpServer.listen(port, host, () => {
  const backend = uiMode ? "replayed /v1" : Object.keys(services).join(", ");
  console.log(`app listening on http://${host}:${port} (web + ${backend}; DEV_PROFILE=chat)`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    httpServer.close();
    void Promise.allSettled([vite.close(), ...Object.values(services).map((s) => s!.close())]).finally(() =>
      process.exit(0),
    );
  });
}

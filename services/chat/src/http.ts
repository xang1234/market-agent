import { createServer, type Server, type ServerResponse } from "node:http";

const HEARTBEAT_INTERVAL_MS = 250;

type StreamRoute = {
  threadId: string;
  runId: string | null;
};

export function createChatServer(): Server {
  return createServer((req, res) => {
    const route = matchStreamRoute(req.method ?? "GET", req.url ?? "/");

    if (route == null) {
      respondJson(res, 404, { error: "not found" });
      return;
    }

    if (route.runId == null) {
      respondJson(res, 400, { error: "'run_id' is required" });
      return;
    }

    writeSseHeaders(res);
    writeEvent(res, "turn.started", {
      thread_id: route.threadId,
      run_id: route.runId,
      stub: true,
    });

    const heartbeat = setInterval(() => {
      writeEvent(res, "heartbeat", {
        thread_id: route.threadId,
        run_id: route.runId,
        stub: true,
      });
    }, HEARTBEAT_INTERVAL_MS);

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) {
        return;
      }
      cleanedUp = true;
      clearInterval(heartbeat);
    };

    req.on("close", cleanup);
    res.on("close", cleanup);
    res.on("error", cleanup);
  });
}

function matchStreamRoute(method: string, rawUrl: string): StreamRoute | null {
  if (method !== "GET") {
    return null;
  }

  const url = new URL(rawUrl, "http://localhost");
  const match = url.pathname.match(/^\/v1\/chat\/threads\/([^/]+)\/stream$/);
  if (match == null) {
    return null;
  }

  const runId = url.searchParams.get("run_id");
  return {
    threadId: decodeURIComponent(match[1]),
    runId: runId && runId.trim() !== "" ? runId : null,
  };
}

function respondJson(res: ServerResponse, status: number, body: object) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

function writeSseHeaders(res: ServerResponse) {
  res.statusCode = 200;
  res.setHeader("content-type", "text/event-stream");
  res.setHeader("cache-control", "no-cache, no-transform");
  res.setHeader("connection", "keep-alive");
}

function writeEvent(res: ServerResponse, event: string, data: object) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

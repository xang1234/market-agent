import { createServer, type Server, type ServerResponse } from "node:http";
import { createChatSseSequencer, stubSuccessEvents, type ChatSseEvent } from "./sse.ts";

const HEARTBEAT_INTERVAL_MS = 250;

type StreamRoute = {
  threadId: string;
  runId: string | null;
};

const INVALID_STREAM_ROUTE = Symbol("INVALID_STREAM_ROUTE");

export function createChatServer(): Server {
  return createServer((req, res) => {
    const route = matchStreamRoute(req.method ?? "GET", req.url ?? "/");

    if (route === INVALID_STREAM_ROUTE) {
      respondJson(res, 400, { error: "invalid request path" });
      return;
    }

    if (route == null) {
      respondJson(res, 404, { error: "not found" });
      return;
    }

    if (route.runId == null) {
      respondJson(res, 400, { error: "'run_id' is required" });
      return;
    }

    const sequencer = createChatSseSequencer({ threadId: route.threadId, runId: route.runId });

    writeSseHeaders(res);
    for (const event of stubSuccessEvents(sequencer)) {
      writeEvent(res, event);
    }

    const heartbeat = setInterval(() => {
      writeEvent(
        res,
        sequencer.next("heartbeat", {
          stub: true,
        }),
      );
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

function matchStreamRoute(method: string, rawUrl: string): StreamRoute | typeof INVALID_STREAM_ROUTE | null {
  if (method !== "GET") {
    return null;
  }

  const url = new URL(rawUrl, "http://localhost");
  const match = url.pathname.match(/^\/v1\/chat\/threads\/([^/]+)\/stream$/);
  if (match == null) {
    return null;
  }

  const runId = url.searchParams.get("run_id");
  let threadId: string;
  try {
    threadId = decodeURIComponent(match[1]);
  } catch {
    return INVALID_STREAM_ROUTE;
  }
  return {
    threadId,
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

function writeEvent(res: ServerResponse, event: ChatSseEvent) {
  res.write(`id: ${event.seq}\n`);
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

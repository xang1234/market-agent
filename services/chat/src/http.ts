import { createServer, type Server, type ServerResponse } from "node:http";
import { createChatSseSequencer, stubSuccessEvents, type ChatSseEvent } from "./sse.ts";

const HEARTBEAT_INTERVAL_MS = 250;
const INVALID_LAST_EVENT_ID = Symbol("INVALID_LAST_EVENT_ID");
const LAST_EVENT_ID_PATTERN = /^(0|[1-9][0-9]*)$/;

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

    const resumeAfterSeq = parseLastEventId(req.headers["last-event-id"]);
    if (resumeAfterSeq === INVALID_LAST_EVENT_ID) {
      respondJson(res, 400, { error: "'Last-Event-ID' must be a non-negative safe decimal integer" });
      return;
    }

    const sequencer = createChatSseSequencer({ threadId: route.threadId, runId: route.runId });
    const events = stubSuccessEvents(sequencer);
    if (resumeAfterSeq > sequencer.currentSeq()) {
      respondJson(res, 400, { error: "'Last-Event-ID' is not available for this stream" });
      return;
    }

    writeSseHeaders(res);
    for (const event of events.filter((event) => event.seq > resumeAfterSeq)) {
      writeEvent(res, event);
    }

    const heartbeat = setInterval(() => {
      writeHeartbeat(res, route);
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

function parseLastEventId(value: string | string[] | undefined): number | typeof INVALID_LAST_EVENT_ID {
  if (value === undefined) {
    return 0;
  }

  const rawValue = Array.isArray(value) ? value[0] : value;
  const trimmedValue = rawValue.trim();
  if (!LAST_EVENT_ID_PATTERN.test(trimmedValue)) {
    return INVALID_LAST_EVENT_ID;
  }

  const seq = Number(trimmedValue);
  if (!Number.isSafeInteger(seq)) {
    return INVALID_LAST_EVENT_ID;
  }

  return seq;
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

function writeHeartbeat(res: ServerResponse, route: { threadId: string; runId: string }) {
  res.write("event: heartbeat\n");
  res.write(
    `data: ${JSON.stringify({
      thread_id: route.threadId,
      run_id: route.runId,
      turn_id: route.runId,
      stub: true,
    })}\n\n`,
  );
}

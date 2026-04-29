import { createServer, type Server, type ServerResponse } from "node:http";
import {
  ChatTurnUnavailableError,
  createChatCoordinator,
  type ChatCoordinator,
} from "./coordinator.ts";
import type { ChatSseEvent } from "./sse.ts";

const HEARTBEAT_INTERVAL_MS = 250;
const MAX_PENDING_SSE_FRAMES = 100;
const INVALID_LAST_EVENT_ID = Symbol("INVALID_LAST_EVENT_ID");
const LAST_EVENT_ID_PATTERN = /^(0|[1-9][0-9]*)$/;

type StreamRoute = {
  threadId: string;
  runId: string | null;
};

type SseWritable = {
  write(frame: string): boolean;
  once(event: "drain", listener: () => void): unknown;
  off(event: "drain", listener: () => void): unknown;
  destroy(error?: Error): unknown;
};

const INVALID_STREAM_ROUTE = Symbol("INVALID_STREAM_ROUTE");

export type ChatServerOptions = {
  coordinator?: ChatCoordinator;
};

export function createChatServer(options: ChatServerOptions = {}): Server {
  const coordinator = options.coordinator ?? createChatCoordinator();

  return createServer(async (req, res) => {
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

    const turnInput = { threadId: route.threadId, runId: route.runId };
    const turn = resumeAfterSeq > 0
      ? coordinator.getTurn(turnInput)
      : getOrCreateTurn(coordinator, turnInput);
    if (turn == null || resumeAfterSeq > turn.currentSeq()) {
      respondJson(res, 400, { error: "'Last-Event-ID' is not available for this stream" });
      return;
    }

    writeSseHeaders(res);
    res.flushHeaders();
    const writer = createSseFrameWriter(res);

    let lastWrittenSeq = resumeAfterSeq;
    const writeIfNew = (event: ChatSseEvent) => {
      if (event.seq <= lastWrittenSeq) {
        return;
      }
      writer.writeEvent(event);
      lastWrittenSeq = event.seq;
    };
    const unsubscribe = turn.subscribe(writeIfNew);
    for (const event of turn.events) {
      writeIfNew(event);
    }

    const heartbeat = setInterval(() => {
      writer.writeHeartbeat(route);
    }, HEARTBEAT_INTERVAL_MS);

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) {
        return;
      }
      cleanedUp = true;
      clearInterval(heartbeat);
      unsubscribe();
      writer.close();
    };

    req.on("close", cleanup);
    res.on("close", cleanup);
    res.on("error", cleanup);
  });
}

function getOrCreateTurn(
  coordinator: ChatCoordinator,
  input: { threadId: string; runId: string },
) {
  try {
    return coordinator.getOrCreateTurn(input);
  } catch (error) {
    if (error instanceof ChatTurnUnavailableError) {
      return null;
    }
    throw error;
  }
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

export function createSseFrameWriter(
  writable: SseWritable,
  options: { maxPendingFrames?: number } = {},
) {
  const maxPendingFrames = options.maxPendingFrames ?? MAX_PENDING_SSE_FRAMES;
  const pendingFrames: string[] = [];
  let waitingForDrain = false;
  let closed = false;

  const onDrain = () => {
    waitingForDrain = false;
    flush();
  };

  const close = () => {
    closed = true;
    if (waitingForDrain) {
      writable.off("drain", onDrain);
      waitingForDrain = false;
    }
    pendingFrames.length = 0;
  };

  const destroySlowClient = () => {
    close();
    writable.destroy(new Error("SSE client exceeded pending frame limit"));
  };

  const enqueue = (frame: string) => {
    if (pendingFrames.length >= maxPendingFrames) {
      destroySlowClient();
      return;
    }
    pendingFrames.push(frame);
  };

  const writeFrame = (frame: string) => {
    if (closed) {
      return;
    }

    if (waitingForDrain) {
      enqueue(frame);
      return;
    }

    if (!writable.write(frame)) {
      waitingForDrain = true;
      writable.once("drain", onDrain);
    }
  };

  const flush = () => {
    while (!closed && !waitingForDrain && pendingFrames.length > 0) {
      const frame = pendingFrames.shift()!;
      if (!writable.write(frame)) {
        waitingForDrain = true;
        writable.once("drain", onDrain);
      }
    }
  };

  return {
    writeEvent(event: ChatSseEvent) {
      writeFrame(eventFrame(event));
    },
    writeHeartbeat(route: { threadId: string; runId: string }) {
      writeFrame(heartbeatFrame(route));
    },
    close,
  };
}

function eventFrame(event: ChatSseEvent) {
  return `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function heartbeatFrame(route: { threadId: string; runId: string }) {
  return `event: heartbeat\ndata: ${JSON.stringify({
    thread_id: route.threadId,
    run_id: route.runId,
    turn_id: route.runId,
    stub: true,
  })}\n\n`;
}

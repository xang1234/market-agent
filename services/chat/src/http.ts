import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  ChatTurnInputMismatchError,
  ChatTurnUnavailableError,
  createChatCoordinator,
  type ChatAssistantMessagePersistence,
  type ChatCoordinator,
  type ChatRunActivityReporter,
  type ChatSubjectClarificationRenderer,
  type ChatThreadTitleGenerator,
} from "./coordinator.ts";
import type { ChatSubjectPreResolver } from "./subjects.ts";
import { tryHandleThreadsRequest } from "./threads-http.ts";
import type { ChatThreadsDb } from "./threads-repo.ts";
import {
  createRunActivityHub,
  type RunActivitySseEvent,
  type RunActivityHub,
} from "../../observability/src/run-activity.ts";
import {
  authenticatedUserRequiredMessage,
  readAuthenticatedUserId,
  type RequestAuthConfig,
} from "../../shared/src/request-auth.ts";

const HEARTBEAT_INTERVAL_MS = 250;
const MAX_PENDING_SSE_FRAMES = 100;
const INVALID_LAST_EVENT_ID = Symbol("INVALID_LAST_EVENT_ID");
const LAST_EVENT_ID_PATTERN = /^(0|[1-9][0-9]*)$/;

type StreamRoute = {
  threadId: string;
  runId: string | null;
  turnId: string | null;
  subjectText: string | null;
};

type SseWritable = {
  write(frame: string): boolean;
  once(event: "drain", listener: () => void): unknown;
  off(event: "drain", listener: () => void): unknown;
  destroy(error?: Error): unknown;
};

type SseFrameEvent = {
  type: string;
  seq: number;
} & Record<string, unknown>;

const INVALID_STREAM_ROUTE = Symbol("INVALID_STREAM_ROUTE");

export type ChatServerOptions = {
  coordinator?: ChatCoordinator;
  persistAssistantMessage?: ChatAssistantMessagePersistence;
  preResolveSubject?: ChatSubjectPreResolver;
  renderSubjectClarification?: ChatSubjectClarificationRenderer;
  runActivity?: ChatRunActivityReporter;
  generateThreadTitle?: ChatThreadTitleGenerator;
  onThreadTitleGenerationError?: Parameters<typeof createChatCoordinator>[0]["onThreadTitleGenerationError"];
  runActivityHub?: RunActivityHub;
  auth?: RequestAuthConfig;
  threadsDb?: ChatThreadsDb;
};

export function createChatServer(options: ChatServerOptions = {}): Server {
  const runActivityHub = options.runActivityHub ?? createRunActivityHub();
  const coordinator = options.coordinator ?? createChatCoordinator({
    persistAssistantMessage: options.persistAssistantMessage,
    preResolveSubject: options.preResolveSubject,
    renderSubjectClarification: options.renderSubjectClarification,
    runActivity: options.runActivity,
    generateThreadTitle: options.generateThreadTitle,
    onThreadTitleGenerationError: options.onThreadTitleGenerationError,
  });
  const threadsDb = options.threadsDb;

  return createServer(async (req, res) => {
    if (threadsDb && (await tryHandleThreadsRequest(threadsDb, req, res, options.auth))) {
      return;
    }

    if (matchRunActivityStreamRoute(req.method ?? "GET", req.url ?? "/")) {
      handleRunActivityStreamRequest(runActivityHub, req, res, options.auth);
      return;
    }

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
    const runId = route.runId;
    const turnId = route.turnId ?? runId;
    const userId = readAuthenticatedUserId(req, options.auth);
    if (options.runActivity && userId === null) {
      respondJson(res, 401, { error: authenticatedUserRequiredMessage(options.auth) });
      return;
    }

    const resumeAfterSeq = parseLastEventId(req.headers["last-event-id"]);
    if (resumeAfterSeq === INVALID_LAST_EVENT_ID) {
      respondJson(res, 400, { error: "'Last-Event-ID' must be a non-negative safe decimal integer" });
      return;
    }

    const turnInput = {
      threadId: route.threadId,
      runId,
      turnId,
      ...(route.subjectText ? { subjectText: route.subjectText } : {}),
      ...(userId ? { userId } : {}),
    };
    const turn = getTurnForRoute(coordinator, turnInput, resumeAfterSeq > 0);
    if (turn === INPUT_MISMATCH) {
      respondJson(res, 409, { error: "turn input does not match the existing turn" });
      return;
    }
    if (turn == null && resumeAfterSeq === 0) {
      respondJson(res, 400, { error: "turn history is not available" });
      return;
    }
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
      writer.writeHeartbeat({ threadId: route.threadId, runId, turnId });
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

function handleRunActivityStreamRequest(
  hub: RunActivityHub,
  req: IncomingMessage,
  res: ServerResponse,
  auth: RequestAuthConfig = {},
) {
  const userId = readAuthenticatedUserId(req, auth);
  if (userId === null) {
    respondJson(res, 401, { error: authenticatedUserRequiredMessage(auth) });
    return;
  }

  const resumeAfterSeq = parseLastEventId(req.headers["last-event-id"]);
  if (resumeAfterSeq === INVALID_LAST_EVENT_ID) {
    respondJson(res, 400, { error: "'Last-Event-ID' must be a non-negative safe decimal integer" });
    return;
  }
  if (!hub.isSeqAvailableForUser(userId, resumeAfterSeq)) {
    respondJson(res, 400, { error: "'Last-Event-ID' is not available for this stream" });
    return;
  }

  writeSseHeaders(res);
  res.flushHeaders();
  const writer = createSseFrameWriter(res);

  let lastWrittenSeq = resumeAfterSeq;
  const writeIfNew = (event: SseFrameEvent) => {
    if (event.seq <= lastWrittenSeq) {
      return;
    }
    writer.writeEvent(event);
    lastWrittenSeq = event.seq;
  };
  const pendingLiveEvents: RunActivitySseEvent[] = [];
  let replaying = true;
  const unsubscribe = hub.subscribe(userId, (event) => {
    if (replaying) {
      pendingLiveEvents.push(event);
      return;
    }
    writeIfNew(event);
  });
  for (const event of hub.eventsForUser(userId)) {
    writeIfNew(event);
  }
  replaying = false;
  for (const event of pendingLiveEvents.sort((left, right) => left.seq - right.seq)) {
    writeIfNew(event);
  }

  const heartbeat = setInterval(() => {
    writer.writeHeartbeat({ stream: "run-activities" });
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
}

const INPUT_MISMATCH = Symbol("INPUT_MISMATCH");

function getTurnForRoute(
  coordinator: ChatCoordinator,
  input: { threadId: string; runId: string; turnId?: string; subjectText?: string },
  resume: boolean,
): ReturnType<ChatCoordinator["getTurn"]> | typeof INPUT_MISMATCH {
  try {
    return resume ? coordinator.getTurn(input) : coordinator.getOrCreateTurn(input);
  } catch (error) {
    if (error instanceof ChatTurnUnavailableError) {
      return null;
    }
    if (error instanceof ChatTurnInputMismatchError) {
      return INPUT_MISMATCH;
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

  const runId = nonEmptyQueryParam(url.searchParams.get("run_id"));
  const turnId = nonEmptyQueryParam(url.searchParams.get("turn_id"));
  const subjectText = nonEmptyQueryParam(url.searchParams.get("subject"));
  let threadId: string;
  try {
    threadId = decodeURIComponent(match[1]);
  } catch {
    return INVALID_STREAM_ROUTE;
  }
  return {
    threadId,
    runId,
    turnId,
    subjectText,
  };
}

function matchRunActivityStreamRoute(method: string, rawUrl: string): boolean {
  if (method !== "GET") {
    return false;
  }
  const url = new URL(rawUrl, "http://localhost");
  return url.pathname === "/v1/run-activities/stream";
}

function nonEmptyQueryParam(value: string | null): string | null {
  return value && value.trim() !== "" ? value : null;
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
    writeEvent(event: SseFrameEvent) {
      writeFrame(eventFrame(event));
    },
    writeHeartbeat(route: { threadId: string; runId: string; turnId?: string | null } | { stream: string }) {
      writeFrame(heartbeatFrame(route));
    },
    close,
  };
}

function eventFrame(event: SseFrameEvent) {
  return `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function heartbeatFrame(route: { threadId: string; runId: string; turnId?: string | null } | { stream: string }) {
  if ("stream" in route) {
    return `event: heartbeat\ndata: ${JSON.stringify({
      stream: route.stream,
    })}\n\n`;
  }
  return `event: heartbeat\ndata: ${JSON.stringify({
    thread_id: route.threadId,
    run_id: route.runId,
    turn_id: route.turnId ?? route.runId,
    stub: true,
  })}\n\n`;
}

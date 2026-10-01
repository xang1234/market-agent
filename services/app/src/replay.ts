// UI mode (#123): record the web client's /v1 traffic against a real stack (capture), then
// serve it back with no services, database or network (replay), so block rendering and
// layout can be iterated on deterministically.
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

export type RecordedExchange = {
  method: string;
  path: string;
  /** Raw query string, without "?". */
  query: string;
  requestBody: string;
  status: number;
  contentType: string;
  body: string;
};

export type ReplayFixture = { version: 1; exchanges: RecordedExchange[] };

export async function loadReplayFixture(file: string): Promise<ReplayFixture> {
  const fixture = JSON.parse(await readFile(file, "utf8")) as Partial<ReplayFixture>;
  if (fixture.version !== 1 || !Array.isArray(fixture.exchanges)) {
    throw new Error(`${file} is not a UI-mode replay fixture (version 1 with an exchanges array)`);
  }
  return fixture as ReplayFixture;
}

// --- capture -----------------------------------------------------------------------

// Wraps a request handler to append each exchange to `file`. It only observes: the
// request body is copied as the handler reads it (req.read, which `for await` and 'data'
// both go through), and the response as the handler writes it, so the handler sees the
// same request and connection (chat's SSE cleanup listens for req 'close').
export function createCapture(file: string): (handler: Handler) => Handler {
  const fixture: ReplayFixture = { version: 1, exchanges: [] };
  writeFileSync(file, `${JSON.stringify(fixture, null, 2)}\n`);
  return (handler) => (req, res) => {
    const requestChunks: Buffer[] = [];
    const read = req.read.bind(req);
    req.read = (size?: number) => {
      const chunk = read(size);
      if (chunk !== null) requestChunks.push(Buffer.from(chunk));
      return chunk;
    };

    const responseChunks: Buffer[] = [];
    let status = 200;
    let contentType = "";
    const writeHead = res.writeHead.bind(res) as (...args: unknown[]) => ServerResponse;
    res.writeHead = ((code: number, ...rest: unknown[]) => {
      status = code;
      const headers = rest.find((arg) => typeof arg === "object" && arg !== null) as Record<string, unknown> | undefined;
      const type = headers && Object.entries(headers).find(([key]) => key.toLowerCase() === "content-type")?.[1];
      if (typeof type === "string") contentType = type;
      return writeHead(code, ...rest);
    }) as typeof res.writeHead;
    const collect = (chunk: unknown) => {
      if (chunk !== undefined && chunk !== null && typeof chunk !== "function") {
        responseChunks.push(Buffer.from(chunk as string | Uint8Array));
      }
    };
    const write = res.write.bind(res) as (...args: unknown[]) => boolean;
    res.write = ((chunk: unknown, ...rest: unknown[]) => {
      collect(chunk);
      return write(chunk, ...rest);
    }) as typeof res.write;
    const end = res.end.bind(res) as (...args: unknown[]) => ServerResponse;
    res.end = ((chunk?: unknown, ...rest: unknown[]) => {
      collect(chunk);
      return end(chunk, ...rest);
    }) as typeof res.end;

    // 'close' also covers an SSE stream the client closed after turn.completed.
    res.once("close", () => {
      // A request the client aborted before any response (React re-running an effect)
      // isn't a recording: replaying an empty answer would hand the UI broken JSON.
      if (!res.headersSent) return;
      const url = new URL(req.url ?? "/", "http://capture.local");
      fixture.exchanges.push({
        method: req.method ?? "GET",
        path: url.pathname,
        query: url.search.replace(/^\?/, ""),
        requestBody: Buffer.concat(requestChunks).toString("utf8"),
        status: res.statusCode === 200 ? status : res.statusCode,
        contentType: contentType || String(res.getHeader("content-type") ?? ""),
        body: Buffer.concat(responseChunks).toString("utf8"),
      });
      writeFileSync(file, `${JSON.stringify(fixture, null, 2)}\n`);
    });
    handler(req, res);
  };
}

// --- replay ------------------------------------------------------------------------

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const shape = (text: string) => text.replace(UUID, ":id");
const isRead = (e: RecordedExchange) => e.method === "GET" && !e.contentType.startsWith("text/event-stream");
const signature = (path: string, query: string, body: string) => `${path}?${query}\n${body}`;
// ponytail: evidence inspection is the only side-effect-free POST the chat flow makes;
// list others here if the UI grows more.
const isLookup = (e: RecordedExchange) => e.method === "POST" && e.path.startsWith("/v1/evidence/");
// The thread id a recorded "new thread" write issued, if that's what it is.
const issuedThreadId = (e: RecordedExchange) =>
  e.method === "POST" && e.path === "/v1/chat/threads" ? e.body.match(/"thread_id":"([^"]+)"/)?.[1] : undefined;

// Serves the recorded exchanges. A request matches a recording with the same method and
// the same path/query/body once ids are blanked out (so the question text must match).
// Ids the client generates (message, snapshot, run ids) are learned from each request
// and substituted into recorded responses; ids the server generated are replayed as-is,
// so the client sends them back verbatim.
//   - Reads (non-stream GETs) are state snapshots: one recorded after the last matched
//     write and before the next recorded write is "current"; otherwise the latest one
//     before that is re-read. So a duplicate read never jumps ahead of a turn.
//   - Writes and streams prefer an exact recording, else the next unused one in recorded
//     order.
//   - Lookups (evidence inspection) match their recording by its ids and leave the
//     timeline where it is.
export function createReplayHandler(fixture: ReplayFixture): Handler {
  const exchanges = fixture.exchanges;
  const recordedToActual = new Map<string, string>();
  const actualToRecorded = new Map<string, string>();
  const used = new Set<number>();
  let cursor = -1;

  const toRecorded = (text: string) => text.replace(UUID, (id) => actualToRecorded.get(id) ?? id);
  const toActual = (text: string) => text.replace(UUID, (id) => recordedToActual.get(id) ?? id);

  // Only ids the client generated may differ from the recording: those that first appear
  // in a request (message, snapshot, run ids). Ids the server issued first appear in a
  // response (a thread id, a fact id in a block); the client sends them back verbatim, so
  // they must match exactly. Without this, a lookup of a fact that wasn't inspected during
  // capture would get another fact's evidence (and alias that fact's id to it).
  const serverIds = new Set<string>();
  const clientIds = new Set<string>();
  for (const e of exchanges) {
    for (const id of signature(e.path, e.query, e.requestBody).match(UUID) ?? []) if (!serverIds.has(id)) clientIds.add(id);
    for (const id of e.body.match(UUID) ?? []) if (!clientIds.has(id)) serverIds.add(id);
  }
  const idsCompatible = (recorded: string, actual: string) => {
    const recordedIds = recorded.match(UUID) ?? [];
    const actualIds = toRecorded(actual).match(UUID) ?? [];
    return recordedIds.length === actualIds.length &&
      recordedIds.every((id, i) => id === actualIds[i] || (clientIds.has(id) && !serverIds.has(actualIds[i]!)));
  };

  function match(method: string, path: string, query: string, body: string): number | undefined {
    const actual = signature(path, query, body);
    const wanted = shape(actual);
    const exact = toRecorded(actual);
    const candidates = exchanges
      .map((e, index) => ({ e, index }))
      .filter(({ e }) => {
        const recorded = signature(e.path, e.query, e.requestBody);
        return e.method === method && shape(recorded) === wanted && idsCompatible(recorded, actual);
      });
    if (candidates.length === 0) return undefined;

    // Only exact-id recordings are left for a lookup (it sends only server ids).
    if (isLookup(candidates[0]!.e)) return candidates[0]!.index;
    if (isRead(candidates[0]!.e)) {
      // Lookups are off the timeline, so they don't end a read window either.
      const nextWrite = exchanges.findIndex((e, index) => index > cursor && !isRead(e) && !isLookup(e));
      const windowEnd = nextWrite === -1 ? exchanges.length : nextWrite;
      const current = candidates.find(({ index }) => index > cursor && index < windowEnd);
      const earlier = candidates.filter(({ index }) => index <= cursor).at(-1);
      return (current ?? earlier ?? candidates[0]!).index;
    }
    const isExact = ({ e }: { e: RecordedExchange }) => signature(e.path, e.query, e.requestBody) === exact;
    return (
      candidates.find((c) => isExact(c) && !used.has(c.index)) ??
      candidates.find(isExact) ??
      candidates.find((c) => !used.has(c.index) && c.index > cursor) ??
      candidates.find((c) => !used.has(c.index)) ??
      candidates.at(-1)!
    ).index;
  }

  function learnIds(recorded: string, actual: string) {
    const recordedIds = recorded.match(UUID) ?? [];
    const actualIds = actual.match(UUID) ?? [];
    if (recordedIds.length !== actualIds.length) return;
    recordedIds.forEach((id, i) => {
      if (id !== actualIds[i]) {
        recordedToActual.set(id, actualIds[i]!);
        actualToRecorded.set(actualIds[i]!, id);
      }
    });
  }

  return async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const url = new URL(req.url ?? "/", "http://replay.local");
    const method = req.method ?? "GET";
    const query = url.search.replace(/^\?/, "");
    const index = match(method, url.pathname, query, body);
    if (index === undefined) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({
        error: `UI mode: no recorded response for ${method} ${url.pathname}; recapture the fixture (README, Development modes)`,
      }));
      return;
    }
    const e = exchanges[index]!;
    // A lookup is off the conversation's timeline: inspecting a fact early must not jump
    // the replay past turns the user hasn't asked yet.
    if (!isLookup(e)) {
      // A write or stream that only matches at or before the cursor means the client has
      // started the recorded flow again (another new thread): rewind there, so the replay
      // doesn't carry the last run's state into it. Learned ids are kept; a new run's ids
      // override them. ponytail: one replay session per app; concurrent tabs share it (the
      // recorded thread id can't tell them apart).
      if (!isRead(e) && index <= cursor) {
        for (const usedIndex of [...used]) if (usedIndex >= index) used.delete(usedIndex);
        cursor = index - 1;
        // A new thread gets a new id: the client navigates to it, and the URL it is already
        // on would keep the last conversation on screen. Requests using it map back.
        const threadId = issuedThreadId(e);
        if (threadId) {
          const fresh = randomUUID();
          recordedToActual.set(threadId, fresh);
          actualToRecorded.set(fresh, threadId);
        }
      }
      learnIds(signature(e.path, e.query, e.requestBody), signature(url.pathname, query, body));
      used.add(index);
      cursor = Math.max(cursor, index);
    }
    res.writeHead(e.status, e.contentType ? { "content-type": e.contentType } : {});
    res.end(toActual(e.body));
  };
}

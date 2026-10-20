// UI mode (#123): record the web client's /v1 traffic against a real stack (capture), then
// serve it back with no services, database or network (replay), so block rendering and
// layout can be iterated on deterministically.
import { writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createReplay, parseReplayFixture, type ReplayFixture } from "./replayCore.ts";

export type { RecordedExchange, ReplayFixture } from "./replayCore.ts";

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

export async function loadReplayFixture(file: string): Promise<ReplayFixture> {
  return parseReplayFixture(JSON.parse(await readFile(file, "utf8")), file);
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

// Serves the recorded exchanges over HTTP (replayCore.ts matches them), with the
// session in memory.
export function createReplayHandler(fixture: ReplayFixture): Handler {
  const replay = createReplay(fixture);
  return async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const url = new URL(req.url ?? "/", "http://replay.local");
    const method = req.method ?? "GET";
    const reply = replay({ method, path: url.pathname, query: url.search.replace(/^\?/, ""), body });
    if (!reply) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({
        error: `UI mode: no recorded response for ${method} ${url.pathname}; recapture the fixture (README, Development modes)`,
      }));
      return;
    }
    res.writeHead(reply.status, reply.contentType ? { "content-type": reply.contentType } : {});
    res.end(reply.body);
  };
}

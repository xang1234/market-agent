import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { createCapture, createReplayHandler, type ReplayFixture } from "../src/replay.ts";

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

async function serve(t: TestContext, handler: Handler): Promise<string> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

// Recorded ids (server- and client-generated).
const THREAD = "11111111-1111-4111-8111-111111111111";
const USER_MSG = "22222222-2222-4222-8222-222222222222";
const USER_SNAP = "33333333-3333-4333-8333-333333333333";
const RUN = "44444444-4444-4444-8444-444444444444";
const ANSWER = "55555555-5555-4555-8555-555555555555";
const FACT = "66666666-6666-4666-8666-666666666666";
// Shown in the recorded blocks (so the server issued it) but never inspected during capture.
const OTHER_FACT = "88888888-8888-4888-8888-888888888888";
const SOURCE = "77777777-7777-4777-8777-777777777777";
const USER = "00000000-0000-4000-8000-000000000001";

const json = (value: unknown) => JSON.stringify(value);
const intent = "Analyze NVDA";
const streamQuery = new URLSearchParams({ run_id: RUN, turn_id: USER_MSG, user_intent: intent, user_id: USER }).toString();

const FIXTURE: ReplayFixture = {
  version: 1,
  exchanges: [
    { method: "POST", path: "/v1/chat/threads", query: "", requestBody: json({ title: "" }), status: 201, contentType: "application/json", body: json({ thread_id: THREAD }) },
    { method: "GET", path: `/v1/chat/threads/${THREAD}/messages`, query: "", requestBody: "", status: 200, contentType: "application/json", body: json({ messages: [] }) },
    {
      method: "POST", path: `/v1/chat/threads/${THREAD}/messages`, query: "",
      requestBody: json({ message_id: USER_MSG, snapshot_id: USER_SNAP, content: intent }),
      status: 201, contentType: "application/json", body: json({ message_id: USER_MSG, role: "user" }),
    },
    {
      method: "GET", path: `/v1/chat/threads/${THREAD}/stream`, query: streamQuery, requestBody: "", status: 200,
      contentType: "text/event-stream", body: `event: turn.completed\ndata: ${json({ turn_id: USER_MSG, message_id: ANSWER })}\n\n`,
    },
    {
      method: "GET", path: `/v1/chat/threads/${THREAD}/messages`, query: "", requestBody: "", status: 200, contentType: "application/json",
      body: json({ messages: [{ message_id: USER_MSG, role: "user" }, { message_id: ANSWER, role: "assistant", facts: [FACT, OTHER_FACT] }] }),
    },
    { method: "POST", path: "/v1/evidence/inspect", query: "", requestBody: json({ ref: { kind: "fact", id: FACT } }), status: 200, contentType: "application/json", body: json({ title: "revenue", source_id: SOURCE }) },
    { method: "POST", path: "/v1/evidence/inspect", query: "", requestBody: json({ ref: { kind: "source", id: SOURCE } }), status: 200, contentType: "application/json", body: json({ title: "sec_edgar filing" }) },
  ],
};

test("replay serves a recorded turn, with the client's own ids substituted in", async (t) => {
  const base = await serve(t, createReplayHandler(FIXTURE));
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, ...(body ? { body: json(body) } : {}) });
    return { status: response.status, type: response.headers.get("content-type"), text: await response.text() };
  };

  assert.equal(JSON.parse((await call("POST", "/v1/chat/threads", { title: "" })).text).thread_id, THREAD);
  // React may read the thread twice before the turn: both see the pre-turn messages.
  assert.deepEqual(JSON.parse((await call("GET", `/v1/chat/threads/${THREAD}/messages`)).text).messages, []);
  assert.deepEqual(JSON.parse((await call("GET", `/v1/chat/threads/${THREAD}/messages`)).text).messages, []);

  // The client generates fresh ids for its message and run.
  const myMsg = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const mySnap = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const myRun = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const saved = await call("POST", `/v1/chat/threads/${THREAD}/messages`, { message_id: myMsg, snapshot_id: mySnap, content: intent });
  assert.equal(saved.status, 201);
  assert.equal(JSON.parse(saved.text).message_id, myMsg);

  const query = new URLSearchParams({ run_id: myRun, turn_id: myMsg, user_intent: intent, user_id: USER }).toString();
  const stream = await call("GET", `/v1/chat/threads/${THREAD}/stream?${query}`);
  assert.equal(stream.type, "text/event-stream");
  assert.match(stream.text, new RegExp(`"turn_id":"${myMsg}"`));
  assert.match(stream.text, new RegExp(`"message_id":"${ANSWER}"`), "server-generated ids stay as recorded");

  const after = JSON.parse((await call("GET", `/v1/chat/threads/${THREAD}/messages`)).text).messages;
  assert.deepEqual(after.map((m: { message_id: string }) => m.message_id), [myMsg, ANSWER]);
  // A reload re-reads the same state.
  assert.deepEqual(JSON.parse((await call("GET", `/v1/chat/threads/${THREAD}/messages`)).text).messages, after);

  // Evidence lookups match their own recording exactly, in any order, any number of times.
  assert.equal(JSON.parse((await call("POST", "/v1/evidence/inspect", { ref: { kind: "source", id: SOURCE } })).text).title, "sec_edgar filing");
  assert.equal(JSON.parse((await call("POST", "/v1/evidence/inspect", { ref: { kind: "fact", id: FACT } })).text).title, "revenue");
  assert.equal(JSON.parse((await call("POST", "/v1/evidence/inspect", { ref: { kind: "source", id: SOURCE } })).text).title, "sec_edgar filing");
  // ...and a reload after them still shows the client's own message id.
  assert.deepEqual(
    JSON.parse((await call("GET", `/v1/chat/threads/${THREAD}/messages`)).text).messages.map((m: { message_id: string }) => m.message_id),
    [myMsg, ANSWER],
  );
});

test("replay starts over when the client starts the recorded flow again (a second new thread)", async (t) => {
  const base = await serve(t, createReplayHandler(FIXTURE));
  const call = async (method: string, path: string, body?: unknown) =>
    (await fetch(`${base}${path}`, { method, ...(body ? { body: json(body) } : {}) })).text();
  const runConversation = async (msg: string, run: string) => {
    const thread = JSON.parse(await call("POST", "/v1/chat/threads", { title: "" })).thread_id as string;
    const before = JSON.parse(await call("GET", `/v1/chat/threads/${thread}/messages`)).messages;
    await call("POST", `/v1/chat/threads/${thread}/messages`, { message_id: msg, snapshot_id: USER_SNAP, content: intent });
    const query = new URLSearchParams({ run_id: run, turn_id: msg, user_intent: intent, user_id: USER }).toString();
    const stream = await call("GET", `/v1/chat/threads/${thread}/stream?${query}`);
    const after = JSON.parse(await call("GET", `/v1/chat/threads/${thread}/messages`)).messages;
    return { thread, before, stream, after };
  };

  const first = await runConversation("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
  const second = await runConversation("dddddddd-dddd-4ddd-8ddd-dddddddddddd", "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");

  assert.equal(first.thread, THREAD);
  // A new id, so the client navigates to a new URL (the same one would keep the old view).
  assert.notEqual(second.thread, THREAD);
  assert.deepEqual(second.before, [], "the new thread opens empty, not with the last run's messages");
  assert.match(second.stream, /"turn_id":"dddddddd-dddd-4ddd-8ddd-dddddddddddd"/);
  assert.deepEqual(
    second.after.map((m: { message_id: string }) => m.message_id),
    ["dddddddd-dddd-4ddd-8ddd-dddddddddddd", ANSWER],
  );
});

test("replay never answers an evidence lookup with another fact's evidence", async (t) => {
  const base = await serve(t, createReplayHandler(FIXTURE));
  const inspect = (id: string) => fetch(`${base}/v1/evidence/inspect`, { method: "POST", body: json({ ref: { kind: "fact", id } }) });
  // OTHER_FACT is on screen (the server issued it) but wasn't inspected during capture.
  const response = await inspect(OTHER_FACT);
  assert.equal(response.status, 404);
  assert.match((await response.json()).error, /no recorded response/);
  // An id the recording has never seen isn't taken for a fresh client id either...
  assert.equal((await inspect("99999999-9999-4999-8999-999999999999")).status, 404);
  // ...so it isn't aliased to FACT: FACT's own evidence still comes back untouched.
  assert.equal(await (await inspect(FACT)).text(), json({ title: "revenue", source_id: SOURCE }));
});

test("replay keeps an evidence lookup from jumping the conversation ahead", async (t) => {
  const SECOND_MSG = "99999999-9999-4999-8999-999999999990";
  const fixture: ReplayFixture = {
    version: 1,
    exchanges: [
      ...FIXTURE.exchanges.slice(0, 3),
      { method: "GET", path: `/v1/chat/threads/${THREAD}/messages`, query: "", requestBody: "", status: 200, contentType: "application/json", body: json({ turns: 1, facts: [FACT] }) },
      { method: "POST", path: `/v1/chat/threads/${THREAD}/messages`, query: "", requestBody: json({ message_id: SECOND_MSG, content: "Compare AMD" }), status: 201, contentType: "application/json", body: json({ message_id: SECOND_MSG }) },
      { method: "GET", path: `/v1/chat/threads/${THREAD}/messages`, query: "", requestBody: "", status: 200, contentType: "application/json", body: json({ turns: 2 }) },
      FIXTURE.exchanges[5]!,
    ],
  };
  const base = await serve(t, createReplayHandler(fixture));
  const call = async (method: string, path: string, body?: unknown) =>
    (await fetch(`${base}${path}`, { method, ...(body ? { body: json(body) } : {}) })).text();

  await call("POST", "/v1/chat/threads", { title: "" });
  await call("POST", `/v1/chat/threads/${THREAD}/messages`, { message_id: USER_MSG, snapshot_id: USER_SNAP, content: intent });
  assert.equal(JSON.parse(await call("GET", `/v1/chat/threads/${THREAD}/messages`)).turns, 1);
  // Inspecting a fact from the first answer, recorded after the second turn...
  assert.equal(JSON.parse(await call("POST", "/v1/evidence/inspect", { ref: { kind: "fact", id: FACT } })).title, "revenue");
  // ...doesn't show a second turn the user never asked.
  assert.equal(JSON.parse(await call("GET", `/v1/chat/threads/${THREAD}/messages`)).turns, 1);
});

test("replay answers an unrecorded request with a clear 404, not a guess", async (t) => {
  const base = await serve(t, createReplayHandler(FIXTURE));
  const response = await fetch(`${base}/v1/market/quotes`);
  assert.equal(response.status, 404);
  assert.match((await response.json()).error, /UI mode.*no recorded response.*GET \/v1\/market\/quotes/);
  const wrongQuestion = await fetch(`${base}/v1/chat/threads/${THREAD}/messages`, {
    method: "POST",
    body: json({ message_id: USER_MSG, snapshot_id: USER_SNAP, content: "Something never recorded" }),
  });
  assert.equal(wrongQuestion.status, 404);
});

test("capture skips a request the client aborted before any response", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "app-capture-abort-"));
  const file = join(dir, "fixture.json");
  const slow: Handler = (req, res) => {
    const timer = setTimeout(() => res.writeHead(200, { "content-type": "application/json" }).end("{}"), 2_000);
    res.once("close", () => clearTimeout(timer));
  };
  const base = await serve(t, createCapture(file)(slow));

  const controller = new AbortController();
  const request = fetch(`${base}/v1/chat/threads`, { signal: controller.signal });
  await new Promise((resolve) => setTimeout(resolve, 100));
  controller.abort();
  await assert.rejects(request);
  await new Promise((resolve) => setTimeout(resolve, 100));

  const fixture = JSON.parse(await readFile(file, "utf8")) as ReplayFixture;
  assert.deepEqual(fixture.exchanges, [], "an aborted, unanswered request isn't a recording");
});

test("capture records each exchange, request body and streamed response included, without disturbing the handler", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "app-capture-"));
  const file = join(dir, "fixture.json");
  const echoes: string[] = [];
  const handler: Handler = async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    echoes.push(body);
    if (req.url?.startsWith("/v1/stream")) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("event: a\ndata: 1\n\n");
      res.end("event: b\ndata: 2\n\n");
      return;
    }
    res.writeHead(201, { "content-type": "application/json" });
    res.end(json({ got: body }));
  };
  const base = await serve(t, createCapture(file)(handler));

  const posted = await fetch(`${base}/v1/things?x=1`, { method: "POST", body: json({ hello: "world" }) });
  assert.equal((await posted.json()).got, json({ hello: "world" }), "the handler still read the body");
  await (await fetch(`${base}/v1/stream`)).text();

  const fixture = JSON.parse(await readFile(file, "utf8")) as ReplayFixture;
  assert.equal(fixture.version, 1);
  assert.deepEqual(
    fixture.exchanges.map((e) => [e.method, e.path, e.query, e.requestBody, e.status, e.contentType]),
    [
      ["POST", "/v1/things", "x=1", json({ hello: "world" }), 201, "application/json"],
      ["GET", "/v1/stream", "", "", 200, "text/event-stream"],
    ],
  );
  assert.equal(fixture.exchanges[0]!.body, json({ got: json({ hello: "world" }) }));
  assert.equal(fixture.exchanges[1]!.body, "event: a\ndata: 1\n\nevent: b\ndata: 2\n\n");
});

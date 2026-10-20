// The UI-mode replay (#123) without its transport: request matching, the conversation
// timeline and id aliasing over a recorded fixture. It has no node: imports, so the Node
// handler (replay.ts) and the static demo (web/src/demo) run this one implementation.

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

export type ReplayRequest = {
  method: string;
  path: string;
  /** Raw query string, without "?". */
  query: string;
  body: string;
};

export type ReplayReply = Pick<RecordedExchange, "status" | "contentType" | "body">;

/** Answers one request from the recording; undefined when nothing recorded matches, so
 *  each shell words the miss for its own audience. */
export type Replay = (request: ReplayRequest) => ReplayReply | undefined;

/** Where a replay keeps its session so it outlives the page (sessionStorage fits). */
export type ReplayStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

// `recording` names the fixture the indices point into. `aliases` logs each (recorded id,
// actual id) pair in the order the replay learned or issued it. Both lookup maps are
// rebuilt from it, so they can't disagree after a reload.
type Session = {
  version: typeof SESSION_VERSION;
  recording: string;
  cursor: number;
  used: number[];
  aliases: [recorded: string, actual: string][];
};

const SESSION_KEY = "market-agent.replay-session";
const SESSION_VERSION = 2;

// The store outlives this code and can hold anything: a saved session counts only if it
// parses and this version of the replay saved it against this recording.
function readSession(saved: string | null, recording: string): Session | undefined {
  let session: Partial<Session> | null;
  try {
    session = JSON.parse(saved ?? "null") as Partial<Session> | null;
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
  const isIndex = (value: unknown) => Number.isInteger(value) && (value as number) >= -1;
  const isAlias = (pair: unknown) => Array.isArray(pair) && pair.length === 2 && pair.every((id) => typeof id === "string");
  const valid = session?.version === SESSION_VERSION && session.recording === recording && isIndex(session.cursor) &&
    Array.isArray(session.used) && session.used.every(isIndex) && Array.isArray(session.aliases) && session.aliases.every(isAlias);
  return valid ? (session as Session) : undefined;
}

export function parseReplayFixture(json: unknown, source: string): ReplayFixture {
  const fixture = json as Partial<ReplayFixture> | null;
  if (fixture?.version !== 1 || !Array.isArray(fixture.exchanges)) {
    throw new Error(`${source} is not a UI-mode replay fixture (version 1 with an exchanges array)`);
  }
  return fixture as ReplayFixture;
}

/** The questions the recording answers, in the order they were asked. */
export function recordedQuestions(fixture: ReplayFixture): string[] {
  const asked = fixture.exchanges
    .filter((e) => e.method === "POST" && /^\/v1\/chat\/threads\/[^/]+\/messages$/.test(e.path))
    .map((e) => (JSON.parse(e.requestBody) as { content: string }).content);
  return [...new Set(asked)];
}

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
// With a store, the session is saved after every request that moves the timeline and
// picked up by the next replay built on that store.
export function createReplay(fixture: ReplayFixture, store?: ReplayStore): Replay {
  const exchanges = fixture.exchanges;
  // Every capture's new thread gets a fresh server id, so a recapture of the same length
  // still differs, and a session saved against it is not resumed here.
  const recording = `${exchanges.map(issuedThreadId).find(Boolean) ?? ""}/${exchanges.length}`;
  const session = readSession(store?.getItem(SESSION_KEY) ?? null, recording) ?? { cursor: -1, used: [], aliases: [] };
  const recordedToActual = new Map<string, string>();
  const actualToRecorded = new Map<string, string>();
  const aliases: Session["aliases"] = [];
  const alias = (recorded: string, actual: string) => {
    if (recordedToActual.get(recorded) === actual && actualToRecorded.get(actual) === recorded) return;
    recordedToActual.set(recorded, actual);
    actualToRecorded.set(actual, recorded);
    aliases.push([recorded, actual]);
  };
  for (const [recorded, actual] of session.aliases) alias(recorded, actual);
  const used = new Set<number>(session.used);
  let cursor = session.cursor;
  const save = () => {
    const next: Session = { version: SESSION_VERSION, recording, cursor, used: [...used], aliases };
    store?.setItem(SESSION_KEY, JSON.stringify(next));
  };

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
      if (id !== actualIds[i]) alias(id, actualIds[i]!);
    });
  }

  return ({ method, path, query, body }) => {
    const index = match(method, path, query, body);
    if (index === undefined) return undefined;
    const e = exchanges[index]!;
    // A lookup is off the conversation's timeline: inspecting a fact early must not jump
    // the replay past turns the user hasn't asked yet.
    if (!isLookup(e)) {
      // A write or stream that only matches at or before the cursor means the client has
      // started the recorded flow again (another new thread): rewind there, so the replay
      // doesn't carry the last run's state into it. Learned ids are kept; a new run's ids
      // override them. ponytail: one replay session per store; the Node handler's tabs
      // share one (the recorded thread id can't tell them apart).
      if (!isRead(e) && index <= cursor) {
        for (const usedIndex of [...used]) if (usedIndex >= index) used.delete(usedIndex);
        cursor = index - 1;
        // A new thread gets a new id: the client navigates to it, and the URL it is already
        // on would keep the last conversation on screen. Requests using it map back.
        const threadId = issuedThreadId(e);
        if (threadId) alias(threadId, crypto.randomUUID());
      }
      learnIds(signature(e.path, e.query, e.requestBody), signature(path, query, body));
      used.add(index);
      cursor = Math.max(cursor, index);
      save();
    }
    return { status: e.status, contentType: e.contentType, body: toActual(e.body) };
  };
}

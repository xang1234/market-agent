import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Client } from "pg";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";
import {
  createResolverServer,
  handleResolveSubjects,
  validateResolveRequest,
  type ResolveResponse,
} from "../src/http.ts";
import type { QueryExecutor } from "../src/lookup.ts";
import type { SubjectKind } from "../src/subject-ref.ts";

type AppleChain = {
  issuer_id: string;
  instrument_id: string;
  listing_id: string;
};

async function seedAppleChain(client: Client): Promise<AppleChain> {
  const issuer = await client.query<{ issuer_id: string }>(
    `insert into issuers (legal_name, cik, lei, domicile, sector, industry)
     values ($1, $2, $3, $4, $5, $6)
     returning issuer_id`,
    ["Apple Inc.", "320193", "HWUPKR0MPOU8FGXBT394", "US", "Technology", "Consumer Electronics"],
  );
  const issuer_id = issuer.rows[0].issuer_id;

  const instrument = await client.query<{ instrument_id: string }>(
    `insert into instruments (issuer_id, asset_type, share_class, isin)
     values ($1, 'common_stock', null, $2)
     returning instrument_id`,
    [issuer_id, "US0378331005"],
  );
  const instrument_id = instrument.rows[0].instrument_id;

  const listing = await client.query<{ listing_id: string }>(
    `insert into listings (instrument_id, mic, ticker, trading_currency, timezone)
     values ($1, 'XNAS', 'AAPL', 'USD', 'America/New_York')
     returning listing_id`,
    [instrument_id],
  );
  return { issuer_id, instrument_id, listing_id: listing.rows[0].listing_id };
}

async function startServer(t: TestContext, db: QueryExecutor): Promise<string> {
  const server = createResolverServer(db);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

function postResolve(base: string, body: unknown): Promise<Response> {
  return fetch(`${base}/v1/subjects/resolve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

// OpenAPI-schema-shaped assertion: every ResolvedSubject has the required
// primitive fields and alternatives (if present) are SubjectRef-only.
function assertResolveResponseShape(body: unknown): asserts body is ResolveResponse {
  assert.equal(typeof body, "object");
  assert.ok(body !== null);
  const obj = body as Record<string, unknown>;
  assert.ok(Array.isArray(obj.subjects), "subjects must be an array");
  assert.ok(Array.isArray(obj.unresolved), "unresolved must be an array");

  for (const subject of obj.subjects as unknown[]) {
    assert.equal(typeof subject, "object");
    const s = subject as Record<string, unknown>;
    const ref = s.subject_ref as Record<string, unknown>;
    assert.equal(typeof ref?.kind, "string");
    assert.equal(typeof ref?.id, "string");
    assert.equal(typeof s.display_name, "string");
    assert.equal(typeof s.confidence, "number");
    if (s.alternatives !== undefined) {
      assert.ok(Array.isArray(s.alternatives));
      for (const alt of s.alternatives as unknown[]) {
        const a = alt as Record<string, unknown>;
        assert.equal(typeof a?.kind, "string");
        assert.equal(typeof a?.id, "string");
      }
    }
  }

  for (const u of obj.unresolved as unknown[]) {
    assert.equal(typeof u, "string");
  }
}

test("validateResolveRequest rejects missing or non-string text", () => {
  assert.deepEqual(validateResolveRequest(null), {
    valid: false,
    error: "request body must be a JSON object",
  });
  assert.deepEqual(validateResolveRequest({}), {
    valid: false,
    error: "'text' is required and must be a string",
  });
  assert.deepEqual(validateResolveRequest({ text: 123 }), {
    valid: false,
    error: "'text' is required and must be a string",
  });
});

test("validateResolveRequest rejects invalid allow_kinds entries", () => {
  const result = validateResolveRequest({ text: "AAPL", allow_kinds: ["issuer", "wrong"] });
  assert.equal(result.valid, false);
  assert.match((result as { error: string }).error, /invalid SubjectKind/);
});

test("validateResolveRequest accepts a minimal request", () => {
  const result = validateResolveRequest({ text: "AAPL" });
  assert.deepEqual(result, { valid: true, request: { text: "AAPL" } });
});

test("validateResolveRequest accepts allow_kinds when every entry is canonical", () => {
  const result = validateResolveRequest({
    text: "AAPL",
    allow_kinds: ["issuer", "listing"] as SubjectKind[],
  });
  assert.equal(result.valid, true);
  assert.deepEqual(
    (result as { request: { allow_kinds?: SubjectKind[] } }).request.allow_kinds,
    ["issuer", "listing"],
  );
});

test("handler: identifier-like input falls back to ticker lookup when identifier resolution misses", async () => {
  const calls: string[] = [];
  const db: QueryExecutor = {
    query: async (text, values) => {
      if (text.includes("from issuers")) {
        calls.push(`identifier:${String(values?.[0])}`);
        return { rows: [] } as never;
      }

      if (text.includes("from listings l")) {
        calls.push(`ticker:${String(values?.[0])}`);
        return {
          rows: [
            {
              listing_id: "11111111-1111-4111-a111-111111111111",
              instrument_id: "22222222-2222-4222-a222-222222222222",
              issuer_id: "33333333-3333-4333-a333-333333333333",
              mic: "XHKG",
              ticker: "700",
              share_class: null,
              legal_name: "Tencent Holdings Ltd.",
            },
          ],
        } as never;
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };

  const response = await handleResolveSubjects(db, { text: "700" });

  assert.deepEqual(calls, ["identifier:700", "ticker:700"]);
  assert.equal(response.subjects.length, 1);
  assert.equal(response.subjects[0].subject_ref.kind, "listing");
  assert.equal(response.subjects[0].subject_ref.id, "11111111-1111-4111-a111-111111111111");
  assert.deepEqual(response.unresolved, []);
});

test("handler: ticker text returns a single listing subject with matching confidence", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for resolver http coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fra-6al-3-4");
  const client = await connectedClient(t, databaseUrl);
  const apple = await seedAppleChain(client);

  const response = await handleResolveSubjects(client, { text: "AAPL" });

  assert.equal(response.subjects.length, 1);
  assert.equal(response.unresolved.length, 0);
  const [subject] = response.subjects;
  assert.equal(subject.subject_ref.kind, "listing");
  assert.equal(subject.subject_ref.id, apple.listing_id);
  assert.ok(subject.confidence > 0 && subject.confidence <= 1);
});

test("handler: CIK text routes via identifier_hint to the issuer", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for resolver http coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fra-6al-3-4");
  const client = await connectedClient(t, databaseUrl);
  const apple = await seedAppleChain(client);

  const response = await handleResolveSubjects(client, { text: "0000320193" });

  assert.equal(response.subjects.length, 1);
  assert.equal(response.subjects[0].subject_ref.kind, "issuer");
  assert.equal(response.subjects[0].subject_ref.id, apple.issuer_id);
});

test("handler: allow_kinds filters out non-matching results and surfaces the input in unresolved", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for resolver http coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fra-6al-3-4");
  const client = await connectedClient(t, databaseUrl);
  await seedAppleChain(client);

  // "AAPL" resolves to a listing; asking for issuer-only filters it out.
  const response = await handleResolveSubjects(client, {
    text: "AAPL",
    allow_kinds: ["issuer"],
  });

  assert.equal(response.subjects.length, 0);
  assert.equal(response.unresolved.length, 1);
});

test("handler: unknown text returns empty subjects and surfaces the input in unresolved", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for resolver http coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fra-6al-3-4");
  const client = await connectedClient(t, databaseUrl);

  const response = await handleResolveSubjects(client, { text: "NOTREAL" });

  assert.equal(response.subjects.length, 0);
  assert.equal(response.unresolved.length, 1);
  assert.equal(response.unresolved[0], "NOTREAL");
});

test("handler: ambiguous ticker returns one subject entry per candidate with equal confidence", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for resolver http coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fra-6al-3-4");
  const client = await connectedClient(t, databaseUrl);
  const apple = await seedAppleChain(client);
  await client.query(
    `insert into listings (instrument_id, mic, ticker, trading_currency, timezone)
     values ($1, 'XFRA', 'AAPL', 'EUR', 'Europe/Berlin')`,
    [apple.instrument_id],
  );

  const response = await handleResolveSubjects(client, { text: "AAPL" });

  assert.equal(response.subjects.length, 2);
  assert.equal(response.unresolved.length, 0);
  const confidences = response.subjects.map((s) => s.confidence);
  assert.equal(confidences[0], confidences[1], "ambiguous candidates carry equal confidence");
});

test("server: POST /v1/subjects/resolve returns 200 with the OpenAPI-shaped response", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for resolver http coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fra-6al-3-4");
  const client = await connectedClient(t, databaseUrl);
  const apple = await seedAppleChain(client);
  const base = await startServer(t, client);

  const res = await postResolve(base, { text: "AAPL" });

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/json");

  const body = await res.json();
  assertResolveResponseShape(body);
  assert.equal(body.subjects.length, 1);
  assert.equal(body.subjects[0].subject_ref.id, apple.listing_id);
});

test("server: malformed JSON body returns 400 with a descriptive error", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for resolver http coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fra-6al-3-4");
  const client = await connectedClient(t, databaseUrl);
  const base = await startServer(t, client);

  const res = await postResolve(base, "{not valid json");

  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /valid JSON/);
});

test("server: internal failures return a generic 500 and log details", async (t) => {
  const db: QueryExecutor = {
    query: async () => {
      throw new Error("secret database detail");
    },
  };
  const base = await startServer(t, db);

  const originalConsoleError = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };
  t.after(() => {
    console.error = originalConsoleError;
  });

  const res = await postResolve(base, { text: "AAPL" });

  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: "internal resolver error" });
  assert.equal(logged.length, 1);
  assert.equal(logged[0][0], "resolver request failed");
  assert.match(String(logged[0][1]), /secret database detail/);
});

test("server: oversized request body returns 413", async (t) => {
  const db: QueryExecutor = {
    query: async () => {
      throw new Error("query should not run for oversized bodies");
    },
  };
  const base = await startServer(t, db);

  const res = await postResolve(base, { text: "A".repeat(70 * 1024) });

  assert.equal(res.status, 413);
  assert.deepEqual(await res.json(), { error: "request body too large" });
});

test("server: missing 'text' returns 400 per request schema", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for resolver http coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fra-6al-3-4");
  const client = await connectedClient(t, databaseUrl);
  const base = await startServer(t, client);

  const res = await postResolve(base, { allow_kinds: ["issuer"] });

  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /'text' is required/);
});

test("server: non-POST or wrong path returns 404", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for resolver http coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fra-6al-3-4");
  const client = await connectedClient(t, databaseUrl);
  const base = await startServer(t, client);

  const wrongMethod = await fetch(`${base}/v1/subjects/resolve`, { method: "GET" });
  assert.equal(wrongMethod.status, 404);

  const wrongPath = await fetch(`${base}/v1/subjects/other`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "AAPL" }),
  });
  assert.equal(wrongPath.status, 404);
});

test("server: unknown text returns 200 with empty subjects and unresolved populated (OpenAPI-shaped)", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for resolver http coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fra-6al-3-4");
  const client = await connectedClient(t, databaseUrl);
  const base = await startServer(t, client);

  const res = await postResolve(base, { text: "NOTREAL" });

  assert.equal(res.status, 200);
  const body = await res.json();
  assertResolveResponseShape(body);
  assert.equal(body.subjects.length, 0);
  assert.deepEqual(body.unresolved, ["NOTREAL"]);
});

import type { TestContext } from "node:test";
import type { AddressInfo } from "node:net";
import type { Client } from "pg";
import { createPortfolioServer } from "../src/http.ts";

export async function startServer(
  t: TestContext,
  db: Parameters<typeof createPortfolioServer>[0],
): Promise<string> {
  const server = createPortfolioServer(db);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

export async function seedUser(client: Client, email: string): Promise<string> {
  const result = await client.query<{ user_id: string }>(
    `insert into users (email) values ($1) returning user_id`,
    [email],
  );
  return result.rows[0].user_id;
}

export function withUser(userId: string, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      "x-user-id": userId,
    },
  };
}

export async function createPortfolioFor(
  base: string,
  userId: string,
  body: { name: string; base_currency: string },
): Promise<string> {
  const res = await fetch(
    `${base}/v1/portfolios`,
    withUser(userId, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  if (res.status !== 201) {
    throw new Error(`createPortfolioFor: expected 201, got ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { portfolio: { portfolio_id: string } };
  return json.portfolio.portfolio_id;
}

export async function addHolding(
  base: string,
  userId: string,
  portfolioId: string,
  body: Record<string, unknown>,
): Promise<{ portfolio_holding_id: string }> {
  const res = await fetch(
    `${base}/v1/portfolios/${portfolioId}/holdings`,
    withUser(userId, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  if (res.status !== 201) {
    throw new Error(`addHolding: expected 201, got ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { holding: { portfolio_holding_id: string } };
  return json.holding;
}

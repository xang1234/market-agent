import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCrawlDate } from "../src/sec-daily-crawl-cli.ts";

test("resolveCrawlDate parses an explicit --date", () => {
  assert.equal(
    resolveCrawlDate(["--date", "2026-06-12"], () => new Date("2026-06-15T00:00:00Z")).toISOString().slice(0, 10),
    "2026-06-12",
  );
});

test("resolveCrawlDate defaults to today (UTC) when no flag is given", () => {
  assert.equal(
    resolveCrawlDate([], () => new Date("2026-06-15T09:00:00Z")).toISOString().slice(0, 10),
    "2026-06-15",
  );
});

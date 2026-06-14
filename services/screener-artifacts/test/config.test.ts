import test from "node:test";
import assert from "node:assert/strict";
import { loadArtifactConfig } from "../src/config.ts";

test("loadArtifactConfig applies US-first defaults when env is empty", () => {
  const config = loadArtifactConfig({});
  assert.equal(config.enabled, false);
  assert.equal(config.repo, "xang1234/stock-screener");
  assert.deepEqual(config.markets, ["US"]);
  assert.equal(
    config.releaseBaseUrl,
    "https://github.com/xang1234/stock-screener/releases/download",
  );
});

test("loadArtifactConfig parses the enable flag from common truthy spellings", () => {
  for (const value of ["1", "true", "TRUE", "yes", "on"]) {
    assert.equal(loadArtifactConfig({ SCREENER_ARTIFACTS_ENABLE: value }).enabled, true, value);
  }
  for (const value of ["0", "false", "no", "", "maybe"]) {
    assert.equal(loadArtifactConfig({ SCREENER_ARTIFACTS_ENABLE: value }).enabled, false, value);
  }
});

test("loadArtifactConfig splits, trims, and upper-cases the market list", () => {
  const config = loadArtifactConfig({ SCREENER_ARTIFACTS_MARKETS: " us, hk ,, jp " });
  assert.deepEqual(config.markets, ["US", "HK", "JP"]);
});

test("loadArtifactConfig falls back to defaults for blank overrides", () => {
  const config = loadArtifactConfig({
    SCREENER_ARTIFACTS_REPO: "   ",
    SCREENER_ARTIFACTS_MARKETS: "  ,  ",
    SCREENER_ARTIFACTS_RELEASE_BASE_URL: "",
  });
  assert.equal(config.repo, "xang1234/stock-screener");
  assert.deepEqual(config.markets, ["US"]);
  assert.equal(
    config.releaseBaseUrl,
    "https://github.com/xang1234/stock-screener/releases/download",
  );
});

test("loadArtifactConfig strips a trailing slash from the release base url", () => {
  const config = loadArtifactConfig({
    SCREENER_ARTIFACTS_RELEASE_BASE_URL: "https://example.com/releases/download/",
  });
  assert.equal(config.releaseBaseUrl, "https://example.com/releases/download");
});

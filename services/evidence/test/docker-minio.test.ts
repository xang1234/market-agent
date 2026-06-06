import test from "node:test";
import assert from "node:assert/strict";

import { interpretDockerResult, dockerAvailable } from "./docker-minio.ts";

test("interpretDockerResult throws a clear timeout error on an ETIMEDOUT result", () => {
  const result = { status: null, error: Object.assign(new Error("spawnSync docker ETIMEDOUT"), { code: "ETIMEDOUT" }) };
  assert.throws(() => interpretDockerResult(result, "run", 90_000), /docker run failed: timed out after 90000ms/);
});

test("interpretDockerResult surfaces stderr on a non-zero exit", () => {
  const result = { status: 1, stderr: "boom", stdout: "" };
  assert.throws(() => interpretDockerResult(result, "port", 15_000), /boom/);
});

test("interpretDockerResult is a no-op on success", () => {
  assert.doesNotThrow(() => interpretDockerResult({ status: 0, stdout: "ok" }, "run", 90_000));
});

test("dockerAvailable returns false when the probe times out", () => {
  const fakeSpawn = () => ({ status: null, error: Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }) });
  assert.equal(dockerAvailable(fakeSpawn), false);
});

test("dockerAvailable returns false on a non-zero probe and true on success", () => {
  assert.equal(dockerAvailable(() => ({ status: 1 })), false);
  assert.equal(dockerAvailable(() => ({ status: 0 })), true);
});

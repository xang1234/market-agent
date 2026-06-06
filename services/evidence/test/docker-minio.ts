import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import {
  CreateBucketCommand,
  ListBucketsCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";

type Cleanup = () => void | Promise<void>;
type TestContextLike = { after(callback: Cleanup): void };

// Pinned to a specific release for reproducibility across test runs over time.
// Bump deliberately when MinIO upstream ships a relevant fix; do not float to :latest.
const MINIO_IMAGE = "minio/minio:RELEASE.2025-09-07T16-13-09Z";
const MINIO_USER = "minioadmin";
const MINIO_PASSWORD = "minioadmin";

const DOCKER_PROBE_TIMEOUT_MS = 10_000; // `docker version` probe (dockerAvailable)
const DOCKER_CMD_TIMEOUT_MS = 15_000; // `docker port` / `docker rm` — fast commands
const DOCKER_RUN_TIMEOUT_MS = 90_000; // `docker run` — may pull the pinned image

type SpawnResult = {
  status: number | null;
  error?: Error;
  stdout?: string;
  stderr?: string;
};

type SpawnFn = (command: string, args: string[], timeoutMs: number) => SpawnResult;

const defaultSpawn: SpawnFn = (command, args, timeoutMs) =>
  spawnSync(command, args, { encoding: "utf8", timeout: timeoutMs });

function run(command: string, args: string[], timeoutMs: number): SpawnResult {
  return defaultSpawn(command, args, timeoutMs);
}

// Turn a spawnSync result into a clear failure. A timed-out command parks the
// event loop until killed, so it surfaces here as `error` (ETIMEDOUT) with a
// null status; a normal failure surfaces as a non-zero status.
export function interpretDockerResult(result: SpawnResult, action: string, timeoutMs: number): void {
  if (result.error) {
    const timedOut = (result.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
    const reason = timedOut ? `timed out after ${timeoutMs}ms` : result.error.message;
    throw new Error(`docker ${action} failed: ${reason}`);
  }
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

export function dockerAvailable(spawn: SpawnFn = defaultSpawn): boolean {
  const result = spawn("docker", ["version", "--format", "{{.Server.Version}}"], DOCKER_PROBE_TIMEOUT_MS);
  return !result.error && result.status === 0;
}

function createContainerName(prefix: string): string {
  return `${prefix}-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function startMinio(containerName: string): { hostPort: string } {
  const result = run("docker", [
    "run",
    "--detach",
    "--rm",
    "--name",
    containerName,
    "-e",
    `MINIO_ROOT_USER=${MINIO_USER}`,
    "-e",
    `MINIO_ROOT_PASSWORD=${MINIO_PASSWORD}`,
    "-p",
    "127.0.0.1::9000",
    MINIO_IMAGE,
    "server",
    "/data",
  ], DOCKER_RUN_TIMEOUT_MS);
  interpretDockerResult(result, "run", DOCKER_RUN_TIMEOUT_MS);

  const portResult = run("docker", ["port", containerName, "9000/tcp"], DOCKER_CMD_TIMEOUT_MS);
  interpretDockerResult(portResult, "port", DOCKER_CMD_TIMEOUT_MS);
  const match = portResult.stdout?.trim().match(/:(\d+)$/);
  assert.ok(match, `expected docker port output to include a host port, got: ${portResult.stdout?.trim()}`);
  return { hostPort: match[1] };
}

function stopMinio(containerName: string): void {
  run("docker", ["rm", "--force", containerName], DOCKER_CMD_TIMEOUT_MS);
}

async function waitForMinio(client: S3Client, maxAttempts = 120): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await client.send(new ListBucketsCommand({}));
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`Timed out waiting for MinIO to be ready: ${String(lastError)}`);
}

export async function bootstrapMinio(
  t: TestContextLike,
  testPrefix: string,
): Promise<{ client: S3Client; bucket: string; endpoint: string }> {
  const containerName = createContainerName(testPrefix);
  const { hostPort } = startMinio(containerName);

  const endpoint = `http://127.0.0.1:${hostPort}`;
  const client = new S3Client({
    endpoint,
    region: "us-east-1",
    credentials: { accessKeyId: MINIO_USER, secretAccessKey: MINIO_PASSWORD },
    forcePathStyle: true,
    // Bound each request so a black-holed endpoint makes waitForMinio's poll
    // loop reject within seconds instead of stalling.
    requestHandler: new NodeHttpHandler({ connectionTimeout: 2_000, requestTimeout: 5_000 }),
  });

  // node:test runs t.after() hooks in registration order (FIFO), not LIFO.
  // Register client cleanup BEFORE container teardown so the SDK client is
  // destroyed against a live endpoint, and any future bucket-cleanup hook
  // added between these two also runs while the container still exists.
  t.after(() => client.destroy());
  t.after(() => stopMinio(containerName));

  await waitForMinio(client);

  const bucket = `evidence-test-${process.pid}-${Date.now()}`;
  await client.send(new CreateBucketCommand({ Bucket: bucket }));

  return { client, bucket, endpoint };
}

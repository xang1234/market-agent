import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import {
  CreateBucketCommand,
  ListBucketsCommand,
  S3Client,
} from "@aws-sdk/client-s3";

type Cleanup = () => void | Promise<void>;
type TestContextLike = { after(callback: Cleanup): void };

const MINIO_IMAGE = "minio/minio:latest";
const MINIO_USER = "minioadmin";
const MINIO_PASSWORD = "minioadmin";

function run(command: string, args: string[]) {
  return spawnSync(command, args, { encoding: "utf8" });
}

export function dockerAvailable(): boolean {
  return run("docker", ["version", "--format", "{{.Server.Version}}"]).status === 0;
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
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const portResult = run("docker", ["port", containerName, "9000/tcp"]);
  assert.equal(portResult.status, 0, portResult.stderr || portResult.stdout);
  const match = portResult.stdout.trim().match(/:(\d+)$/);
  assert.ok(match, `expected docker port output to include a host port, got: ${portResult.stdout.trim()}`);
  return { hostPort: match[1] };
}

function stopMinio(containerName: string): void {
  run("docker", ["rm", "--force", containerName]);
}

async function waitForMinio(client: S3Client, maxAttempts = 30): Promise<void> {
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
  t.after(() => stopMinio(containerName));

  const endpoint = `http://127.0.0.1:${hostPort}`;
  const client = new S3Client({
    endpoint,
    region: "us-east-1",
    credentials: { accessKeyId: MINIO_USER, secretAccessKey: MINIO_PASSWORD },
    forcePathStyle: true,
  });
  t.after(() => client.destroy());

  await waitForMinio(client);

  const bucket = `evidence-test-${process.pid}-${Date.now()}`;
  await client.send(new CreateBucketCommand({ Bucket: bucket }));

  return { client, bucket, endpoint };
}

import { S3Client } from "@aws-sdk/client-s3";
import { S3ObjectStore } from "../../evidence/src/s3-object-store.ts";
import type { ObjectStore } from "../../evidence/src/object-store.ts";
import { createLlmRouterFromEnv, type LlmSettingsLoaderEnv } from "../../llm/src/settings-loader.ts";
import type { ReaderColumnDeps } from "./column-catalog.ts";

export function createLoadDocumentText(store: ObjectStore): ReaderColumnDeps["loadDocumentText"] {
  return async (rawBlobId) => {
    const blob = await store.get(rawBlobId);
    if (blob === null) return null;
    return new TextDecoder("utf-8", { fatal: false }).decode(blob.bytes);
  };
}

type ReaderWiringEnv = LlmSettingsLoaderEnv & {
  S3_ENDPOINT?: string;
  S3_REGION?: string;
  S3_BUCKET?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
  S3_FORCE_PATH_STYLE?: string;
};

// Reader deps are optional: when the LLM router or the object store is not
// configured, the server runs without them and reader cells fail closed (the
// producer throws -> cell status "error"). Env names match .env.dev.
export async function createReaderColumnDepsFromEnv(
  env: ReaderWiringEnv = process.env as ReaderWiringEnv,
): Promise<ReaderColumnDeps | undefined> {
  if (!env.S3_BUCKET || !env.S3_REGION) return undefined;
  const router = await createLlmRouterFromEnv(env).catch(() => null);
  if (router === null) return undefined;

  const client = new S3Client({
    region: env.S3_REGION,
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
    ...(env.S3_FORCE_PATH_STYLE === "true" ? { forcePathStyle: true } : {}),
    ...(env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
      ? { credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY } }
      : {}),
  });
  const store = new S3ObjectStore({ client, bucket: env.S3_BUCKET });

  return {
    llm: { complete: (request) => router.complete(request) },
    loadDocumentText: createLoadDocumentText(store),
  };
}

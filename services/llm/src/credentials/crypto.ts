import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { LlmMasterKeyMissingError } from "../errors.ts";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const FINGERPRINT_TAIL_LENGTH = 4;
const MASTER_KEY_ENV = "LLM_MASTER_ENCRYPTION_KEY";

export type EncryptedSecret = {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
};

export type MasterKeyEnv = { [MASTER_KEY_ENV]?: string } & Record<string, string | undefined>;

export function loadMasterKey(env: MasterKeyEnv = process.env): Buffer {
  const raw = env[MASTER_KEY_ENV];
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new LlmMasterKeyMissingError();
  }
  const key = decodeBase64(raw.trim());
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `${MASTER_KEY_ENV} must decode to ${KEY_BYTES} bytes (got ${key.length})`,
    );
  }
  return key;
}

export function hasMasterKey(env: MasterKeyEnv = process.env): boolean {
  const raw = env[MASTER_KEY_ENV];
  if (typeof raw !== "string" || raw.trim() === "") return false;
  try {
    return decodeBase64(raw.trim()).length === KEY_BYTES;
  } catch {
    return false;
  }
}

export function encryptSecret(plaintext: string, masterKey: Buffer): EncryptedSecret {
  assertMasterKey(masterKey);
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("plaintext must be a non-empty string");
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, masterKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Object.freeze({ ciphertext, iv, authTag });
}

export function decryptSecret(secret: EncryptedSecret, masterKey: Buffer): string {
  assertMasterKey(masterKey);
  if (secret.iv.length !== IV_BYTES) {
    throw new Error(`encrypted secret iv must be ${IV_BYTES} bytes`);
  }
  if (secret.authTag.length !== AUTH_TAG_BYTES) {
    throw new Error(`encrypted secret auth_tag must be ${AUTH_TAG_BYTES} bytes`);
  }
  const decipher = createDecipheriv(ALGORITHM, masterKey, secret.iv);
  decipher.setAuthTag(secret.authTag);
  const plaintext = Buffer.concat([decipher.update(secret.ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

export function fingerprintSecret(plaintext: string): string {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("plaintext must be a non-empty string");
  }
  const tail = plaintext.slice(-FINGERPRINT_TAIL_LENGTH);
  return tail.padStart(FINGERPRINT_TAIL_LENGTH, "•");
}

function assertMasterKey(masterKey: Buffer): void {
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== KEY_BYTES) {
    throw new Error(`master key must be ${KEY_BYTES} bytes`);
  }
}

function decodeBase64(value: string): Buffer {
  const buffer = Buffer.from(value, "base64");
  // Round-trip protects against silent base64 truncation (Node accepts any input).
  if (buffer.toString("base64").replace(/=+$/, "") !== value.replace(/=+$/, "")) {
    throw new Error(`${MASTER_KEY_ENV} is not valid base64`);
  }
  return buffer;
}

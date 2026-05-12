import type { LlmReasoningEffort, LlmProviderCatalog } from "../providers/catalog.ts";
import { requireProviderEntry } from "../providers/catalog.ts";
import { LLM_REASONING_EFFORTS } from "../providers/catalog.ts";
import type { LlmRole } from "../roles.ts";
import { assertLlmRole } from "../roles.ts";
import {
  decryptSecret,
  encryptSecret,
  fingerprintSecret,
  type EncryptedSecret,
} from "./crypto.ts";

export type LlmCredentialsQueryExecutor = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[]; rowCount?: number | null }>;
};

export type LlmCredentialSummary = {
  user_id: string;
  role: LlmRole;
  provider_id: string;
  model: string;
  base_url: string | null;
  reasoning_effort: LlmReasoningEffort | null;
  key_fingerprint: string | null;
  created_at: string;
  updated_at: string;
};

export type LlmCredentialMaterialized = LlmCredentialSummary & {
  api_key: string | null;
};

export type UpsertLlmCredentialInput = {
  user_id: string;
  role: LlmRole;
  provider_id: string;
  model: string;
  base_url?: string | null;
  reasoning_effort?: LlmReasoningEffort | null;
  api_key?: string | null;
};

export type UpsertLlmCredentialOptions = {
  catalog: LlmProviderCatalog;
  masterKey: Buffer;
};

type CredentialRow = {
  user_id: string;
  role: string;
  provider_id: string;
  model: string;
  base_url: string | null;
  reasoning_effort: string | null;
  key_ciphertext: Buffer | null;
  key_iv: Buffer | null;
  key_auth_tag: Buffer | null;
  key_fingerprint: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SELECT_COLUMNS = `user_id::text as user_id,
       role,
       provider_id,
       model,
       base_url,
       reasoning_effort,
       key_ciphertext,
       key_iv,
       key_auth_tag,
       key_fingerprint,
       created_at,
       updated_at`;

export async function listLlmCredentials(
  db: LlmCredentialsQueryExecutor,
  userId: string,
): Promise<ReadonlyArray<LlmCredentialSummary>> {
  assertUuid(userId, "user_id");
  const { rows } = await db.query<CredentialRow>(
    `select ${SELECT_COLUMNS}
       from user_llm_credentials
      where user_id = $1::uuid
      order by role asc`,
    [userId],
  );
  return Object.freeze(rows.map(toSummary));
}

export async function getActiveLlmCredential(
  db: LlmCredentialsQueryExecutor,
  input: { user_id: string; role: LlmRole },
  options: { masterKey: Buffer },
): Promise<LlmCredentialMaterialized | null> {
  assertUuid(input.user_id, "user_id");
  assertLlmRole(input.role);
  const { rows } = await db.query<CredentialRow>(
    `select ${SELECT_COLUMNS}
       from user_llm_credentials
      where user_id = $1::uuid
        and role = $2`,
    [input.user_id, input.role],
  );
  const row = rows[0];
  if (!row) return null;
  return materialize(row, options.masterKey);
}

export async function upsertLlmCredential(
  db: LlmCredentialsQueryExecutor,
  input: UpsertLlmCredentialInput,
  options: UpsertLlmCredentialOptions,
): Promise<LlmCredentialSummary> {
  assertUuid(input.user_id, "user_id");
  assertLlmRole(input.role);
  const entry = requireProviderEntry(options.catalog, input.provider_id);
  const model = requireNonEmpty(input.model, "model");
  const baseUrl = normalizeBaseUrl(input.base_url, entry, "base_url");
  const reasoningEffort = normalizeReasoningEffort(input.reasoning_effort, entry);

  let encrypted: EncryptedSecret | null = null;
  let fingerprint: string | null = null;
  const apiKey = typeof input.api_key === "string" ? input.api_key : null;
  if (apiKey !== null) {
    if (apiKey.trim() === "") {
      // explicit "clear key" path; null out key columns
      encrypted = null;
      fingerprint = null;
    } else {
      encrypted = encryptSecret(apiKey, options.masterKey);
      fingerprint = fingerprintSecret(apiKey);
    }
  }

  const apiKeyProvided = input.api_key !== undefined;

  const { rows } = await db.query<CredentialRow>(
    `insert into user_llm_credentials
       (user_id, role, provider_id, model, base_url, reasoning_effort,
        key_ciphertext, key_iv, key_auth_tag, key_fingerprint)
     values ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (user_id, role) do update set
       provider_id = excluded.provider_id,
       model = excluded.model,
       base_url = excluded.base_url,
       reasoning_effort = excluded.reasoning_effort,
       key_ciphertext = case when $11::boolean then excluded.key_ciphertext else user_llm_credentials.key_ciphertext end,
       key_iv         = case when $11::boolean then excluded.key_iv         else user_llm_credentials.key_iv         end,
       key_auth_tag   = case when $11::boolean then excluded.key_auth_tag   else user_llm_credentials.key_auth_tag   end,
       key_fingerprint= case when $11::boolean then excluded.key_fingerprint else user_llm_credentials.key_fingerprint end,
       updated_at = now()
     returning ${SELECT_COLUMNS}`,
    [
      input.user_id,
      input.role,
      entry.id,
      model,
      baseUrl,
      reasoningEffort,
      encrypted?.ciphertext ?? null,
      encrypted?.iv ?? null,
      encrypted?.authTag ?? null,
      fingerprint,
      apiKeyProvided,
    ],
  );
  return toSummary(rows[0]!);
}

export async function deleteLlmCredential(
  db: LlmCredentialsQueryExecutor,
  input: { user_id: string; role: LlmRole },
): Promise<boolean> {
  assertUuid(input.user_id, "user_id");
  assertLlmRole(input.role);
  const result = await db.query(
    `delete from user_llm_credentials
      where user_id = $1::uuid
        and role = $2`,
    [input.user_id, input.role],
  );
  return (result.rowCount ?? 0) > 0;
}

function materialize(row: CredentialRow, masterKey: Buffer): LlmCredentialMaterialized {
  assertLlmRole(row.role);
  const summary = toSummary(row);
  let apiKey: string | null = null;
  if (row.key_ciphertext && row.key_iv && row.key_auth_tag) {
    apiKey = decryptSecret(
      {
        ciphertext: Buffer.isBuffer(row.key_ciphertext)
          ? row.key_ciphertext
          : Buffer.from(row.key_ciphertext as unknown as Uint8Array),
        iv: Buffer.isBuffer(row.key_iv) ? row.key_iv : Buffer.from(row.key_iv as unknown as Uint8Array),
        authTag: Buffer.isBuffer(row.key_auth_tag)
          ? row.key_auth_tag
          : Buffer.from(row.key_auth_tag as unknown as Uint8Array),
      },
      masterKey,
    );
  }
  return Object.freeze({ ...summary, api_key: apiKey });
}

function toSummary(row: CredentialRow): LlmCredentialSummary {
  assertLlmRole(row.role);
  return Object.freeze({
    user_id: row.user_id,
    role: row.role,
    provider_id: row.provider_id,
    model: row.model,
    base_url: row.base_url,
    reasoning_effort: row.reasoning_effort === null
      ? null
      : assertReasoningEffort(row.reasoning_effort),
    key_fingerprint: row.key_fingerprint,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  });
}

function assertReasoningEffort(value: string): LlmReasoningEffort {
  if (!(LLM_REASONING_EFFORTS as ReadonlyArray<string>).includes(value)) {
    throw new Error(`invalid reasoning_effort '${value}'`);
  }
  return value as LlmReasoningEffort;
}

function normalizeBaseUrl(
  value: string | null | undefined,
  entry: ReturnType<typeof requireProviderEntry>,
  field: string,
): string | null {
  if (value === undefined || value === null) {
    return entry.default_base_url ?? null;
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    return entry.default_base_url ?? null;
  }
  if (!entry.base_url_editable && entry.default_base_url !== null && trimmed !== entry.default_base_url) {
    throw new Error(`provider '${entry.id}' does not allow overriding ${field}`);
  }
  return trimmed;
}

function normalizeReasoningEffort(
  value: LlmReasoningEffort | null | undefined,
  entry: ReturnType<typeof requireProviderEntry>,
): LlmReasoningEffort | null {
  if (value === undefined || value === null) return null;
  if (!entry.supports_reasoning_effort) {
    throw new Error(`provider '${entry.id}' does not support reasoning_effort`);
  }
  if (!(LLM_REASONING_EFFORTS as ReadonlyArray<string>).includes(value)) {
    throw new Error(`invalid reasoning_effort '${value}'`);
  }
  return value;
}

function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function assertUuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new Error(`${field} must be a UUID`);
  }
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

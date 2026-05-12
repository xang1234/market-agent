import {
  LlmAuthError,
  LlmCredentialMissingError,
  LlmError,
  LlmMasterKeyMissingError,
  LlmRateLimitError,
  LlmTransportError,
  OpenAiCompatibleProvider,
  assertLlmRole,
  deleteLlmCredential,
  getActiveLlmCredential,
  hasMasterKey,
  isLlmRole,
  listLlmCredentials,
  loadLlmProviderCatalog,
  loadMasterKey,
  requireProviderEntry,
  upsertLlmCredential,
  type LlmCredentialMaterialized,
  type LlmCredentialSummary,
  type LlmCredentialsQueryExecutor,
  type LlmProvider,
  type LlmProviderCatalog,
  type LlmProviderCatalogEntry,
  type LlmReasoningEffort,
  type LlmRole,
} from "../../llm/src/index.ts";

export type LlmAdapterProviderEntry = {
  id: string;
  label: string;
  default_base_url: string | null;
  default_model: string | null;
  suggested_models: ReadonlyArray<string>;
  requires_key: boolean;
  base_url_editable: boolean;
  supports_reasoning_effort: boolean;
  supports_tools: boolean;
  supports_json_mode: boolean;
  supports_streaming: boolean;
};

export type LlmAdapterCredential = {
  role: LlmRole;
  provider_id: string;
  model: string;
  base_url: string | null;
  reasoning_effort: LlmReasoningEffort | null;
  key_fingerprint: string | null;
  created_at: string;
  updated_at: string;
};

export type LlmAdapterTestResult =
  | { ok: true; latency_ms: number; model: string }
  | { ok: false; error_code: string; message: string; latency_ms: number };

export type DevApiLlmUpsertInput = {
  user_id: string;
  role: LlmRole;
  body: Record<string, unknown>;
};

export type DevApiLlmAdapter = {
  listProviders(): Promise<{ providers: ReadonlyArray<LlmAdapterProviderEntry> }>;
  listCredentials(input: { user_id: string }): Promise<{
    credentials: ReadonlyArray<LlmAdapterCredential>;
  }>;
  upsertCredential(input: DevApiLlmUpsertInput): Promise<LlmAdapterCredential>;
  deleteCredential(input: { user_id: string; role: LlmRole }): Promise<boolean>;
  testCredential(input: { user_id: string; role: LlmRole }): Promise<LlmAdapterTestResult>;
};

export class DevApiLlmRequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "DevApiLlmRequestError";
    this.status = status;
  }
}

export type CreateServiceLlmAdapterDeps = {
  db: LlmCredentialsQueryExecutor;
  env?: Record<string, string | undefined>;
  providerFactory?: (config: ServiceLlmProviderFactoryInput) => LlmProvider;
};

export type ServiceLlmProviderFactoryInput = {
  entry: LlmProviderCatalogEntry;
  credential: LlmCredentialMaterialized;
};

export async function createServiceLlmAdapter(
  deps: CreateServiceLlmAdapterDeps,
): Promise<DevApiLlmAdapter | null> {
  const env = deps.env ?? process.env;
  if (!hasMasterKey(env)) return null;
  const masterKey = loadMasterKey(env);
  const catalog = await loadLlmProviderCatalog();
  const providerFactory = deps.providerFactory ?? defaultProviderFactory;
  return buildAdapter({ db: deps.db, masterKey, catalog, providerFactory });
}

export function createFixtureLlmAdapter(): DevApiLlmAdapter {
  const credentials = new Map<string, LlmAdapterCredential>();
  return {
    async listProviders() {
      const catalog = await loadLlmProviderCatalog();
      return { providers: catalog.map(toAdapterEntry) };
    },
    async listCredentials({ user_id }) {
      const matched = [...credentials.entries()]
        .filter(([key]) => key.startsWith(`${user_id}::`))
        .map(([, value]) => value)
        .sort((a, b) => a.role.localeCompare(b.role));
      return { credentials: matched };
    },
    async upsertCredential({ user_id, role, body }) {
      const catalog = await loadLlmProviderCatalog();
      const parsed = parseUpsertBody(body, catalog);
      const existing = credentials.get(`${user_id}::${role}`);
      const fingerprint = parsed.apiKey === undefined
        ? existing?.key_fingerprint ?? null
        : parsed.apiKey === ""
          ? null
          : parsed.apiKey.slice(-4).padStart(4, "•");
      const now = "2026-05-12T00:00:00.000Z";
      const next: LlmAdapterCredential = {
        role,
        provider_id: parsed.providerId,
        model: parsed.model,
        base_url: parsed.baseUrl,
        reasoning_effort: parsed.reasoningEffort,
        key_fingerprint: fingerprint,
        created_at: existing?.created_at ?? now,
        updated_at: now,
      };
      credentials.set(`${user_id}::${role}`, next);
      return next;
    },
    async deleteCredential({ user_id, role }) {
      return credentials.delete(`${user_id}::${role}`);
    },
    async testCredential({ user_id, role }) {
      const credential = credentials.get(`${user_id}::${role}`);
      if (!credential) throw new DevApiLlmRequestError(404, "credential not found");
      return { ok: true, latency_ms: 1, model: credential.model };
    },
  };
}

function buildAdapter(input: {
  db: LlmCredentialsQueryExecutor;
  masterKey: Buffer;
  catalog: LlmProviderCatalog;
  providerFactory: NonNullable<CreateServiceLlmAdapterDeps["providerFactory"]>;
}): DevApiLlmAdapter {
  return {
    async listProviders() {
      return { providers: input.catalog.map(toAdapterEntry) };
    },
    async listCredentials({ user_id }) {
      const rows = await listLlmCredentials(input.db, user_id);
      return { credentials: rows.map(toAdapterCredential) };
    },
    async upsertCredential({ user_id, role, body }) {
      const parsed = parseUpsertBody(body, input.catalog);
      const summary = await upsertLlmCredential(
        input.db,
        {
          user_id,
          role,
          provider_id: parsed.providerId,
          model: parsed.model,
          base_url: parsed.baseUrl,
          reasoning_effort: parsed.reasoningEffort,
          ...(parsed.apiKey === undefined ? {} : { api_key: parsed.apiKey }),
        },
        { catalog: input.catalog, masterKey: input.masterKey },
      );
      return toAdapterCredential(summary);
    },
    async deleteCredential({ user_id, role }) {
      return deleteLlmCredential(input.db, { user_id, role });
    },
    async testCredential({ user_id, role }) {
      const credential = await getActiveLlmCredential(
        input.db,
        { user_id, role },
        { masterKey: input.masterKey },
      );
      if (credential === null) {
        throw new DevApiLlmRequestError(404, "credential not found");
      }
      const entry = requireProviderEntry(input.catalog, credential.provider_id);
      const startedAt = Date.now();
      try {
        const provider = input.providerFactory({ entry, credential });
        await provider.chatComplete({
          messages: [{ role: "user", content: "ping" }],
          maxTokens: 1,
        });
        return { ok: true, latency_ms: Date.now() - startedAt, model: credential.model };
      } catch (error) {
        return {
          ok: false,
          latency_ms: Date.now() - startedAt,
          error_code: errorCodeOf(error),
          message: errorMessageOf(error),
        };
      }
    },
  };
}

function defaultProviderFactory(input: ServiceLlmProviderFactoryInput): LlmProvider {
  if (input.entry.requires_key && input.credential.api_key === null) {
    throw new LlmCredentialMissingError(input.credential.role);
  }
  const baseUrl = input.credential.base_url ?? input.entry.default_base_url;
  if (baseUrl === null) {
    throw new Error(`provider '${input.entry.id}' requires a base_url`);
  }
  return new OpenAiCompatibleProvider({
    providerId: input.entry.id,
    baseUrl,
    apiKey: input.credential.api_key,
    model: input.credential.model,
    reasoningEffort: input.credential.reasoning_effort,
    supportsReasoningEffort: input.entry.supports_reasoning_effort,
  });
}

function toAdapterEntry(entry: LlmProviderCatalogEntry): LlmAdapterProviderEntry {
  return Object.freeze({
    id: entry.id,
    label: entry.label,
    default_base_url: entry.default_base_url,
    default_model: entry.default_model,
    suggested_models: entry.suggested_models,
    requires_key: entry.requires_key,
    base_url_editable: entry.base_url_editable,
    supports_reasoning_effort: entry.supports_reasoning_effort,
    supports_tools: entry.supports_tools,
    supports_json_mode: entry.supports_json_mode,
    supports_streaming: entry.supports_streaming,
  });
}

function toAdapterCredential(summary: LlmCredentialSummary): LlmAdapterCredential {
  return Object.freeze({
    role: summary.role,
    provider_id: summary.provider_id,
    model: summary.model,
    base_url: summary.base_url,
    reasoning_effort: summary.reasoning_effort,
    key_fingerprint: summary.key_fingerprint,
    created_at: summary.created_at,
    updated_at: summary.updated_at,
  });
}

type ParsedUpsertBody = {
  providerId: string;
  model: string;
  baseUrl: string | null;
  reasoningEffort: LlmReasoningEffort | null;
  apiKey: string | undefined;
};

function parseUpsertBody(
  body: Record<string, unknown>,
  catalog: LlmProviderCatalog,
): ParsedUpsertBody {
  const providerId = requireString(body.provider_id, "provider_id");
  // throws if unknown:
  requireProviderEntry(catalog, providerId);
  const model = requireString(body.model, "model");
  const baseUrl = optionalNullableString(body.base_url, "base_url");
  const reasoningEffortRaw = optionalNullableString(body.reasoning_effort, "reasoning_effort");
  const reasoningEffort = reasoningEffortRaw === null
    ? null
    : assertReasoningEffortValue(reasoningEffortRaw);
  const apiKey = body.api_key === undefined ? undefined : requireApiKey(body.api_key);
  return { providerId, model, baseUrl, reasoningEffort, apiKey };
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new DevApiLlmRequestError(400, `${field} is required`);
  }
  return value.trim();
}

function optionalNullableString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new DevApiLlmRequestError(400, `${field} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function requireApiKey(value: unknown): string {
  if (typeof value !== "string") {
    throw new DevApiLlmRequestError(400, "api_key must be a string");
  }
  return value;
}

function assertReasoningEffortValue(value: string): LlmReasoningEffort {
  if (value === "off" || value === "low" || value === "medium" || value === "high" || value === "max") {
    return value;
  }
  throw new DevApiLlmRequestError(400, `reasoning_effort '${value}' is invalid`);
}

export function parseLlmRolePathSegment(value: string): LlmRole | null {
  return isLlmRole(value) ? value : null;
}

export function assertLlmRoleOrThrow(value: string): LlmRole {
  const role = parseLlmRolePathSegment(value);
  if (role === null) {
    throw new DevApiLlmRequestError(404, "role not found");
  }
  return role;
}

function errorCodeOf(error: unknown): string {
  if (error instanceof LlmError) return error.code;
  if (error instanceof Error && error.name.length > 0) return error.name;
  return "unknown_error";
}

function errorMessageOf(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return "test failed";
}

// Re-export some types so http.ts can use them without re-importing from services/llm.
export {
  LlmAuthError,
  LlmCredentialMissingError,
  LlmError,
  LlmMasterKeyMissingError,
  LlmRateLimitError,
  LlmTransportError,
  assertLlmRole,
};
export type { LlmRole };

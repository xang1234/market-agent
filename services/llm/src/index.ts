export { LLM_ROLES, assertLlmRole, isLlmRole, type LlmRole } from "./roles.ts";

export {
  LlmAuthError,
  LlmBadResponseError,
  LlmCredentialMissingError,
  LlmError,
  LlmMasterKeyMissingError,
  LlmRateLimitError,
  LlmTransportError,
  type LlmErrorCode,
} from "./errors.ts";

export {
  LLM_REASONING_EFFORTS,
  getProviderEntry,
  loadLlmProviderCatalog,
  requireProviderEntry,
  resetLlmProviderCatalogCacheForTests,
  type LlmProviderCatalog,
  type LlmProviderCatalogEntry,
  type LlmReasoningEffort,
} from "./providers/catalog.ts";

export {
  decryptSecret,
  encryptSecret,
  fingerprintSecret,
  hasMasterKey,
  loadMasterKey,
  type EncryptedSecret,
  type MasterKeyEnv,
} from "./credentials/crypto.ts";

export {
  deleteLlmCredential,
  getActiveLlmCredential,
  listLlmCredentials,
  upsertLlmCredential,
  type LlmCredentialMaterialized,
  type LlmCredentialSummary,
  type LlmCredentialsQueryExecutor,
  type UpsertLlmCredentialInput,
  type UpsertLlmCredentialOptions,
} from "./credentials/store.ts";

export {
  OpenAiCompatibleProvider,
  type LlmChatCompletion,
  type LlmChatMessage,
  type LlmChatRequest,
  type LlmFetch,
  type LlmProvider,
  type LlmResponseFormat,
  type LlmToolCall,
  type LlmToolSchema,
  type OpenAiCompatibleProviderConfig,
} from "./provider.ts";

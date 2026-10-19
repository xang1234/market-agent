import type { ChatVerificationMode } from "./coordinator.ts";
import type { ChatServerOptions } from "./http.ts";

export type ChatRuntimeEnv = {
  CHAT_DATABASE_URL?: string;
  DATABASE_URL?: string;
  CHAT_VERIFICATION_MODE?: string;
  NODE_ENV?: string;
};

export async function loadChatServerOptionsFromEnv(
  env: ChatRuntimeEnv = process.env,
): Promise<ChatServerOptions> {
  // Validated even when unset; only a non-default mode is passed on (the coordinator defaults to strict).
  const verificationMode = readChatVerificationMode(env);
  const options: ChatServerOptions = verificationMode === "strict" ? {} : { verificationMode };
  if (!(env.CHAT_DATABASE_URL ?? env.DATABASE_URL)) {
    return options;
  }

  const runtime = await import("./local-runtime.ts");
  // With the lane on, the server does not start until verified finance is ready.
  await runtime.financialRuntime.assertReady();
  return {
    ...options,
    persistAssistantMessage: runtime.persistAssistantMessage,
    preResolveSubject: runtime.preResolveSubject,
    loadPriorSubjects: runtime.loadPriorSubjects,
    generateThreadTitle: runtime.generateThreadTitle,
    analystToolRuntime: runtime.analystToolRuntime,
    financialRuntime: runtime.financialRuntime,
  };
}

// display_unverified shows answers that failed verification (labelled, never
// saved) so they can be debugged in development. It must never reach users.
export function readChatVerificationMode(env: ChatRuntimeEnv): ChatVerificationMode {
  const mode = env.CHAT_VERIFICATION_MODE?.trim() || "strict";
  if (mode !== "strict" && mode !== "display_unverified") {
    throw new Error(`CHAT_VERIFICATION_MODE must be 'strict' or 'display_unverified' (got '${mode}')`);
  }
  if (mode === "display_unverified" && env.NODE_ENV === "production") {
    throw new Error("CHAT_VERIFICATION_MODE=display_unverified is not allowed in production");
  }
  return mode;
}

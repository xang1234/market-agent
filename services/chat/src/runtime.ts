import type { ChatAssistantMessagePersistence } from "./coordinator.ts";
import type { ChatServerOptions } from "./http.ts";

export type ChatRuntimeEnv = {
  CHAT_PERSISTENCE_MODULE?: string;
};

export async function loadChatServerOptionsFromEnv(
  env: ChatRuntimeEnv = process.env,
): Promise<ChatServerOptions> {
  if (env.CHAT_PERSISTENCE_MODULE == null || env.CHAT_PERSISTENCE_MODULE.trim() === "") {
    return {};
  }

  const module = await import(env.CHAT_PERSISTENCE_MODULE);
  if (typeof module.persistAssistantMessage !== "function") {
    throw new Error("CHAT_PERSISTENCE_MODULE must export persistAssistantMessage");
  }

  return {
    persistAssistantMessage: module.persistAssistantMessage as ChatAssistantMessagePersistence,
  };
}

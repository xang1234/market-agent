import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { ChatAssistantMessagePersistence } from "./coordinator.ts";
import type { ChatServerOptions } from "./http.ts";

export type ChatRuntimeEnv = {
  CHAT_PERSISTENCE_MODULE?: string;
};

export async function loadChatServerOptionsFromEnv(
  env: ChatRuntimeEnv = process.env,
  cwd = process.cwd(),
): Promise<ChatServerOptions> {
  if (env.CHAT_PERSISTENCE_MODULE == null || env.CHAT_PERSISTENCE_MODULE.trim() === "") {
    return {};
  }

  const module = await import(moduleSpecifier(env.CHAT_PERSISTENCE_MODULE, cwd));
  if (typeof module.persistAssistantMessage !== "function") {
    throw new Error("CHAT_PERSISTENCE_MODULE must export persistAssistantMessage");
  }

  return {
    persistAssistantMessage: module.persistAssistantMessage as ChatAssistantMessagePersistence,
  };
}

function moduleSpecifier(specifier: string, cwd: string): string {
  const trimmed = specifier.trim();
  if (trimmed.startsWith(".") || trimmed.startsWith("/")) {
    return pathToFileURL(resolve(cwd, trimmed)).href;
  }
  return trimmed;
}

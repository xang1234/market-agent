import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type {
  ChatAnalystToolRuntime,
  ChatAssistantMessagePersistence,
  ChatSubjectClarificationRenderer,
  ChatThreadTitleGenerator,
} from "./coordinator.ts";
import type { ChatServerOptions } from "./http.ts";
import type { ChatSubjectPreResolver } from "./subjects.ts";

export type ChatRuntimeEnv = {
  CHAT_PERSISTENCE_MODULE?: string;
  CHAT_SUBJECT_RESOLVER_MODULE?: string;
  CHAT_THREAD_TITLE_MODULE?: string;
  CHAT_ANALYST_RUNTIME_MODULE?: string;
  CHAT_DATABASE_URL?: string;
  DATABASE_URL?: string;
};

const DEFAULT_CHAT_RUNTIME_MODULE = new URL("./local-runtime.ts", import.meta.url).href;

export async function loadChatServerOptionsFromEnv(
  env: ChatRuntimeEnv = process.env,
  cwd = process.cwd(),
): Promise<ChatServerOptions> {
  const options: ChatServerOptions = {};

  const databaseUrl = env.CHAT_DATABASE_URL ?? env.DATABASE_URL;
  const persistenceModule = env.CHAT_PERSISTENCE_MODULE?.trim() ||
    (databaseUrl ? DEFAULT_CHAT_RUNTIME_MODULE : "");
  const analystRuntimeModule = env.CHAT_ANALYST_RUNTIME_MODULE?.trim() ||
    (databaseUrl ? DEFAULT_CHAT_RUNTIME_MODULE : "");
  const threadTitleModule = env.CHAT_THREAD_TITLE_MODULE?.trim() ||
    (databaseUrl ? DEFAULT_CHAT_RUNTIME_MODULE : "");
  const subjectResolverModule = env.CHAT_SUBJECT_RESOLVER_MODULE?.trim() ||
    (databaseUrl ? DEFAULT_CHAT_RUNTIME_MODULE : "");

  if (persistenceModule !== "") {
    const module = await import(moduleSpecifier(persistenceModule, cwd));
    if (typeof module.persistAssistantMessage !== "function") {
      throw new Error("CHAT_PERSISTENCE_MODULE must export persistAssistantMessage");
    }

    options.persistAssistantMessage = module.persistAssistantMessage as ChatAssistantMessagePersistence;
  }

  if (subjectResolverModule !== "") {
    const module = await import(moduleSpecifier(subjectResolverModule, cwd));
    if (typeof module.preResolveSubject !== "function") {
      throw new Error("CHAT_SUBJECT_RESOLVER_MODULE must export preResolveSubject");
    }

    options.preResolveSubject = module.preResolveSubject as ChatSubjectPreResolver;
    if (module.renderSubjectClarification !== undefined) {
      if (typeof module.renderSubjectClarification !== "function") {
        throw new Error("CHAT_SUBJECT_RESOLVER_MODULE renderSubjectClarification export must be a function");
      }
      options.renderSubjectClarification = module.renderSubjectClarification as ChatSubjectClarificationRenderer;
    }
  }

  if (threadTitleModule !== "") {
    const module = await import(moduleSpecifier(threadTitleModule, cwd));
    if (typeof module.generateThreadTitle !== "function") {
      throw new Error("CHAT_THREAD_TITLE_MODULE must export generateThreadTitle");
    }

    options.generateThreadTitle = module.generateThreadTitle as ChatThreadTitleGenerator;
  }

  if (analystRuntimeModule !== "") {
    const module = await import(moduleSpecifier(analystRuntimeModule, cwd));
    if (typeof module.analystToolRuntime !== "function") {
      throw new Error("CHAT_ANALYST_RUNTIME_MODULE must export analystToolRuntime");
    }

    options.analystToolRuntime = module.analystToolRuntime as ChatAnalystToolRuntime;
  }

  return options;
}

function moduleSpecifier(specifier: string, cwd: string): string {
  const trimmed = specifier.trim();
  if (trimmed.startsWith("file:")) {
    return trimmed;
  }
  if (trimmed.startsWith(".") || isAbsolute(trimmed)) {
    return pathToFileURL(resolve(cwd, trimmed)).href;
  }
  return trimmed;
}

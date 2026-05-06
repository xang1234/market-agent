import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type {
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
};

export async function loadChatServerOptionsFromEnv(
  env: ChatRuntimeEnv = process.env,
  cwd = process.cwd(),
): Promise<ChatServerOptions> {
  const options: ChatServerOptions = {};

  if (env.CHAT_PERSISTENCE_MODULE != null && env.CHAT_PERSISTENCE_MODULE.trim() !== "") {
    const module = await import(moduleSpecifier(env.CHAT_PERSISTENCE_MODULE, cwd));
    if (typeof module.persistAssistantMessage !== "function") {
      throw new Error("CHAT_PERSISTENCE_MODULE must export persistAssistantMessage");
    }

    options.persistAssistantMessage = module.persistAssistantMessage as ChatAssistantMessagePersistence;
  }

  if (env.CHAT_SUBJECT_RESOLVER_MODULE != null && env.CHAT_SUBJECT_RESOLVER_MODULE.trim() !== "") {
    const module = await import(moduleSpecifier(env.CHAT_SUBJECT_RESOLVER_MODULE, cwd));
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

  if (env.CHAT_THREAD_TITLE_MODULE != null && env.CHAT_THREAD_TITLE_MODULE.trim() !== "") {
    const module = await import(moduleSpecifier(env.CHAT_THREAD_TITLE_MODULE, cwd));
    if (typeof module.generateThreadTitle !== "function") {
      throw new Error("CHAT_THREAD_TITLE_MODULE must export generateThreadTitle");
    }

    options.generateThreadTitle = module.generateThreadTitle as ChatThreadTitleGenerator;
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

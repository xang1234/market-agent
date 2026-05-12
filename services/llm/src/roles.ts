export const LLM_ROLES = ["summary", "analyst", "reader"] as const;

export type LlmRole = (typeof LLM_ROLES)[number];

export function isLlmRole(value: unknown): value is LlmRole {
  return typeof value === "string" && (LLM_ROLES as ReadonlyArray<string>).includes(value);
}

export function assertLlmRole(value: unknown): asserts value is LlmRole {
  if (!isLlmRole(value)) {
    throw new Error(`invalid llm role '${String(value)}'; expected one of ${LLM_ROLES.join(", ")}`);
  }
}

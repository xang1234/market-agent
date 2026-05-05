export type ThreadTurn = {
  role: "user" | "assistant" | "tool";
  text: string;
};

export type ThreadSummaryModelInput = {
  turns: ReadonlyArray<ThreadTurn>;
  previousSummary?: string;
};

export type ThreadSummaryModel = (
  input: ThreadSummaryModelInput,
) => Promise<string> | string;

export type MaybeRegenerateThreadSummaryInput = {
  turns: ReadonlyArray<ThreadTurn>;
  previousSummary?: string;
  previousSummarizedThroughTurn?: number;
  summarizeEveryTurns: number;
  keepRecentTurns: number;
  model: ThreadSummaryModel;
};

export type ThreadSummaryResult = {
  regenerated: boolean;
  summary: string;
  summarizedThroughTurn: number;
};

export type BuildPromptCachePrefixInput = {
  systemPrompt: string;
  summary?: string;
};

export async function maybeRegenerateThreadSummary(
  input: MaybeRegenerateThreadSummaryInput,
): Promise<ThreadSummaryResult> {
  assertPositiveInteger(input.summarizeEveryTurns, "summarizeEveryTurns");
  assertNonNegativeInteger(input.keepRecentTurns, "keepRecentTurns");
  if (input.previousSummarizedThroughTurn !== undefined) {
    assertNonNegativeInteger(
      input.previousSummarizedThroughTurn,
      "previousSummarizedThroughTurn",
    );
  }

  const summarizedThroughTurn = Math.max(0, input.turns.length - input.keepRecentTurns);
  const previousSummary = input.previousSummary?.trim() ?? "";
  const previousSummarizedThroughTurn = input.previousSummarizedThroughTurn ?? 0;
  if (
    summarizedThroughTurn === 0 ||
    input.turns.length % input.summarizeEveryTurns !== 0
  ) {
    return Object.freeze({
      regenerated: false,
      summary: previousSummary,
      summarizedThroughTurn: previousSummarizedThroughTurn,
    });
  }

  const summary = normalizeSummary(await input.model({
    turns: input.turns.slice(0, summarizedThroughTurn),
    ...(previousSummary ? { previousSummary } : {}),
  }));
  return Object.freeze({
    regenerated: true,
    summary,
    summarizedThroughTurn,
  });
}

export function buildPromptCachePrefix(input: BuildPromptCachePrefixInput): string {
  const systemPrompt = input.systemPrompt.trim();
  const summary = input.summary?.trim();
  if (!summary) return systemPrompt;
  return `${systemPrompt}\n\nThread summary:\n${summary}`;
}

function normalizeSummary(value: string): string {
  const collapsed = value.replace(/\s+/gu, " ").trim();
  return collapsed.length > 0 ? collapsed : "No durable prior context.";
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
}

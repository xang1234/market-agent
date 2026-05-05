export type ThreadTitleModelInput = {
  userIntent?: string;
  assistantText: string;
};

export type ThreadTitleModel = (
  input: ThreadTitleModelInput,
) => Promise<string> | string;

export type GenerateThreadTitleInput = ThreadTitleModelInput & {
  model: ThreadTitleModel;
};

const MAX_THREAD_TITLE_LENGTH = 60;
const SMALL_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "but",
  "by",
  "for",
  "in",
  "nor",
  "of",
  "on",
  "or",
  "per",
  "the",
  "to",
  "vs",
]);

export async function generateThreadTitle(
  input: GenerateThreadTitleInput,
): Promise<string> {
  try {
    return normalizeThreadTitle(await input.model({
      userIntent: input.userIntent,
      assistantText: input.assistantText,
    }));
  } catch {
    return fallbackThreadTitle(input);
  }
}

export function fallbackThreadTitle(input: ThreadTitleModelInput): string {
  const source = nonEmpty(input.userIntent) ?? nonEmpty(input.assistantText) ?? "New Chat";
  return normalizeThreadTitle(toTitleCase(source.replace(/[.]+$/u, "")));
}

export function normalizeThreadTitle(value: string): string {
  const firstLine = value.split(/\r?\n/u)[0] ?? "";
  const collapsed = firstLine.replace(/\s+/gu, " ").trim();
  const title = collapsed.length > 0 ? collapsed : "New Chat";
  if (title.length <= MAX_THREAD_TITLE_LENGTH) return title;
  return `${title.slice(0, MAX_THREAD_TITLE_LENGTH - 1).trimEnd()}…`;
}

function nonEmpty(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toTitleCase(value: string): string {
  return value
    .split(/\s+/u)
    .map((word, index) => titleCaseWord(word, index))
    .join(" ");
}

function titleCaseWord(word: string, index: number): string {
  const lower = word.toLowerCase();
  if (index > 0 && SMALL_WORDS.has(lower)) return lower;
  if (/^[a-z]+-[a-z]+$/iu.test(word)) {
    return word
      .split("-")
      .map((part) => (part.length <= 2 ? part.toUpperCase() : titleCaseWord(part, 0)))
      .join("-");
  }
  const match = lower.match(/^([^a-z0-9]*)([a-z0-9])(.*)$/u);
  if (!match) return word;
  return `${match[1]}${match[2].toUpperCase()}${match[3]}`;
}

import type { MentionProminence } from "../mention-repo.ts";

export type MentionProminenceSections = {
  headline?: string | null;
  lead?: string | null;
  body?: string | null;
  incidental?: string | null;
};

const PROMINENCE_SECTION_ORDER = Object.freeze([
  "headline",
  "lead",
  "body",
  "incidental",
] as const);

export function classifyMentionProminence(
  mentionText: string,
  sections: MentionProminenceSections,
): MentionProminence {
  const normalizedMention = normalizeForMentionSearch(mentionText);
  if (!normalizedMention) {
    return "incidental";
  }

  for (const prominence of PROMINENCE_SECTION_ORDER) {
    const sectionText = normalizeForMentionSearch(sections[prominence] ?? "");
    if (containsMentionToken(sectionText, normalizedMention)) {
      return prominence;
    }
  }

  return "incidental";
}

function normalizeForMentionSearch(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function containsMentionToken(sectionText: string, normalizedMention: string): boolean {
  const escapedMention = normalizedMention.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapedMention}(?=$|[^\\p{L}\\p{N}])`, "u").test(sectionText);
}

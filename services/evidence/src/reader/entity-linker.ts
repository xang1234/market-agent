import type { ResolverEnvelope } from "../../../resolver/src/envelope.ts";
import type { SubjectRef } from "../../../resolver/src/subject-ref.ts";

import {
  createMention,
  type MentionProminence,
  type MentionRow,
} from "../mention-repo.ts";
import type { QueryExecutor } from "../types.ts";

export type DetectedMentionCandidate = {
  text: string;
  prominence: MentionProminence;
  mention_count: number;
  confidence: number;
};

export type ResolveMention = (text: string) => Promise<ResolverEnvelope>;

export type SkippedMention = {
  text: string;
  reason: "ambiguous" | "not_found";
  envelope: ResolverEnvelope;
};

export type LinkDocumentMentionsResult = {
  mentions: readonly MentionRow[];
  skipped: readonly SkippedMention[];
};

export async function linkDocumentMentions(input: {
  db: QueryExecutor;
  document_id: string;
  candidates: readonly DetectedMentionCandidate[];
  resolveMention: ResolveMention;
}): Promise<LinkDocumentMentionsResult> {
  const mentionsByKey = new Map<string, {
    subject: SubjectRef;
    prominence: MentionProminence;
    mention_count: number;
    confidence: number;
  }>();
  const skipped: SkippedMention[] = [];

  for (const candidate of input.candidates) {
    const envelope = await input.resolveMention(candidate.text);
    if (envelope.outcome !== "resolved") {
      skipped.push({
        text: candidate.text,
        reason: envelope.outcome === "ambiguous" ? "ambiguous" : "not_found",
        envelope,
      });
      continue;
    }

    const subject = envelope.subject_ref satisfies SubjectRef;
    const confidence = Math.min(candidate.confidence, envelope.confidence);
    const key = `${subject.kind}:${subject.id}:${candidate.prominence}`;
    const existing = mentionsByKey.get(key);
    if (existing) {
      existing.mention_count += candidate.mention_count;
      existing.confidence = Math.max(existing.confidence, confidence);
      continue;
    }

    mentionsByKey.set(key, {
      subject,
      prominence: candidate.prominence,
      mention_count: candidate.mention_count,
      confidence,
    });
  }

  const mentions: MentionRow[] = [];
  for (const mention of mentionsByKey.values()) {
    mentions.push(
      await createMention(input.db, {
        document_id: input.document_id,
        subject_kind: mention.subject.kind,
        subject_id: mention.subject.id,
        prominence: mention.prominence,
        mention_count: mention.mention_count,
        confidence: mention.confidence,
      }),
    );
  }

  return Object.freeze({
    mentions: Object.freeze(mentions),
    skipped: Object.freeze(skipped),
  });
}

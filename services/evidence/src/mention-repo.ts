import type { SubjectKind, SubjectRef } from "../../resolver/src/subject-ref.ts";
import { SUBJECT_KINDS } from "../../resolver/src/subject-ref.ts";

import type { QueryExecutor } from "./types.ts";
import {
  assertOneOf,
  assertPositiveInteger,
  assertUuidV4,
} from "./validators.ts";

export const MENTION_PROMINENCES = Object.freeze([
  "headline",
  "lead",
  "body",
  "incidental",
] as const);

export type MentionProminence = (typeof MENTION_PROMINENCES)[number];

export type MentionInput = {
  document_id: string;
  subject_kind: SubjectKind;
  subject_id: string;
  prominence: MentionProminence;
  mention_count: number;
  confidence: number;
};

export type MentionRow = {
  mention_id: string;
  document_id: string;
  subject_ref: SubjectRef;
  prominence: MentionProminence;
  mention_count: number;
  confidence: number;
  created_at: string;
};

export type MentionIdentity = Pick<MentionInput, "subject_kind" | "subject_id" | "prominence">;

type MentionDbRow = {
  mention_id: string;
  document_id: string;
  subject_kind: SubjectKind;
  subject_id: string;
  prominence: MentionProminence;
  mention_count: number | string;
  confidence: number | string;
  created_at: Date | string;
};

const MENTION_COLUMNS = `mention_id,
               document_id,
               subject_kind,
               subject_id,
               prominence,
               mention_count,
               confidence,
               created_at`;

export async function createMention(
  db: QueryExecutor,
  input: MentionInput,
): Promise<MentionRow> {
  validateMentionInput(input);

  const { rows } = await db.query<MentionDbRow>(
    `insert into mentions
       (document_id, subject_kind, subject_id, prominence, mention_count, confidence)
     values ($1::uuid, $2::subject_kind, $3::uuid, $4, $5, $6)
     on conflict (document_id, subject_kind, subject_id, prominence) do update
       set mention_count = excluded.mention_count,
           confidence = greatest(mentions.confidence, excluded.confidence)
     returning ${MENTION_COLUMNS}`,
    [
      input.document_id,
      input.subject_kind,
      input.subject_id,
      input.prominence,
      input.mention_count,
      input.confidence,
    ],
  );

  return mentionRowFromDb(rows[0]);
}

export async function listMentionsForDocument(
  db: QueryExecutor,
  documentId: string,
): Promise<readonly MentionRow[]> {
  assertUuidV4(documentId, "document_id");

  const { rows } = await db.query<MentionDbRow>(
    `select ${MENTION_COLUMNS}
       from mentions
      where document_id = $1
      order by case prominence
                 when 'headline' then 1
                 when 'lead' then 2
                 when 'body' then 3
                 else 4
               end,
               confidence desc,
               mention_id asc`,
    [documentId],
  );

  return Object.freeze(rows.map(mentionRowFromDb));
}

export async function deleteMentionsForDocumentExcept(
  db: QueryExecutor,
  documentId: string,
  keepMentions: readonly MentionIdentity[],
): Promise<number> {
  assertUuidV4(documentId, "document_id");
  for (const mention of keepMentions) {
    assertOneOf(mention.subject_kind, SUBJECT_KINDS, "subject_kind");
    assertUuidV4(mention.subject_id, "subject_id");
    assertOneOf(mention.prominence, MENTION_PROMINENCES, "prominence");
  }

  if (keepMentions.length === 0) {
    const result = await db.query(
      `delete from mentions
        where document_id = $1::uuid`,
      [documentId],
    );
    return result.rowCount ?? 0;
  }

  const values: unknown[] = [documentId];
  const keepPredicates = keepMentions.map((mention) => {
    values.push(mention.subject_kind, mention.subject_id, mention.prominence);
    const offset = values.length - 2;
    return `(subject_kind = $${offset}::subject_kind and subject_id = $${offset + 1}::uuid and prominence = $${offset + 2})`;
  });

  const result = await db.query(
    `delete from mentions
      where document_id = $1::uuid
        and not (${keepPredicates.join(" or ")})`,
    values,
  );
  return result.rowCount ?? 0;
}

function validateMentionInput(input: MentionInput): void {
  assertUuidV4(input.document_id, "document_id");
  assertOneOf(input.subject_kind, SUBJECT_KINDS, "subject_kind");
  assertUuidV4(input.subject_id, "subject_id");
  assertOneOf(input.prominence, MENTION_PROMINENCES, "prominence");
  assertPositiveInteger(input.mention_count, "mention_count");
  assertConfidence(input.confidence, "confidence");
}

function assertConfidence(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label}: must be a finite number in [0, 1]`);
  }
}

function mentionRowFromDb(row: MentionDbRow | undefined): MentionRow {
  if (!row) {
    throw new Error("mention insert/select did not return a row");
  }

  return Object.freeze({
    mention_id: row.mention_id,
    document_id: row.document_id,
    subject_ref: Object.freeze({ kind: row.subject_kind, id: row.subject_id }),
    prominence: row.prominence,
    mention_count: Number(row.mention_count),
    confidence: Number(row.confidence),
    created_at: isoString(row.created_at),
  });
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

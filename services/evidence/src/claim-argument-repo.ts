import type { SubjectKind, SubjectRef } from "../../resolver/src/subject-ref.ts";
import { SUBJECT_KINDS } from "../../resolver/src/subject-ref.ts";

import type { QueryExecutor } from "./types.ts";
import {
  assertOneOf,
  assertUuidV4,
} from "./validators.ts";

export const CLAIM_ARGUMENT_ROLES = Object.freeze([
  "subject",
  "object",
  "customer",
  "supplier",
  "competitor",
  "regulator",
  "beneficiary",
  "constrained_party",
  "affected_party",
] as const);

export type ClaimArgumentRole = (typeof CLAIM_ARGUMENT_ROLES)[number];

export type ClaimArgumentInput = {
  claim_id: string;
  subject_kind: SubjectKind;
  subject_id: string;
  role: ClaimArgumentRole;
};

export type ClaimArgumentRow = {
  claim_argument_id: string;
  claim_id: string;
  subject_ref: SubjectRef;
  role: ClaimArgumentRole;
  created_at: string;
};

type ClaimArgumentDbRow = {
  claim_argument_id: string;
  claim_id: string;
  subject_kind: SubjectKind;
  subject_id: string;
  role: string;
  created_at: Date | string;
};

const CLAIM_ARGUMENT_COLUMNS = `claim_argument_id,
               claim_id,
               subject_kind,
               subject_id,
               role,
               created_at`;

export async function createClaimArgument(
  db: QueryExecutor,
  input: ClaimArgumentInput,
): Promise<ClaimArgumentRow> {
  validateClaimArgumentInput(input);

  const { rows } = await db.query<ClaimArgumentDbRow>(
    `insert into claim_arguments
       (claim_id, subject_kind, subject_id, role)
     values ($1::uuid, $2::subject_kind, $3::uuid, $4)
     returning ${CLAIM_ARGUMENT_COLUMNS}`,
    [
      input.claim_id,
      input.subject_kind,
      input.subject_id,
      input.role,
    ],
  );

  return claimArgumentRowFromDb(rows[0]);
}

export async function listClaimArgumentsForClaim(
  db: QueryExecutor,
  claimId: string,
): Promise<readonly ClaimArgumentRow[]> {
  assertUuidV4(claimId, "claim_id");

  const { rows } = await db.query<ClaimArgumentDbRow>(
    `select ${CLAIM_ARGUMENT_COLUMNS}
       from claim_arguments
      where claim_id = $1
      order by role,
               claim_argument_id`,
    [claimId],
  );

  return Object.freeze(rows.map(claimArgumentRowFromDb));
}

function validateClaimArgumentInput(input: ClaimArgumentInput): void {
  assertUuidV4(input.claim_id, "claim_id");
  assertOneOf(input.subject_kind, SUBJECT_KINDS, "subject_kind");
  assertUuidV4(input.subject_id, "subject_id");
  assertOneOf(input.role, CLAIM_ARGUMENT_ROLES, "role");
}

function claimArgumentRowFromDb(row: ClaimArgumentDbRow | undefined): ClaimArgumentRow {
  if (!row) {
    throw new Error("claim argument insert/select did not return a row");
  }

  assertOneOf(row.role, CLAIM_ARGUMENT_ROLES, "role");

  return Object.freeze({
    claim_argument_id: row.claim_argument_id,
    claim_id: row.claim_id,
    subject_ref: Object.freeze({ kind: row.subject_kind, id: row.subject_id }),
    role: row.role,
    created_at: isoString(row.created_at),
  });
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

import { createHash } from "node:crypto";

import type { SubjectRef } from "../../resolver/src/subject-ref.ts";
import { SUBJECT_KINDS } from "../../resolver/src/subject-ref.ts";

import type { QueryExecutor } from "./types.ts";
import {
  assertIso8601WithOffset,
  assertNonEmptyString,
  assertOneOf,
  assertUuidV4,
} from "./validators.ts";

export const CLAIM_CLUSTER_MEMBER_RELATIONS = Object.freeze([
  "support",
  "contradict",
] as const);

export type ClaimClusterMemberRelation = (typeof CLAIM_CLUSTER_MEMBER_RELATIONS)[number];

export type ClaimCanonicalSignatureInput = {
  predicate: string;
  text_canonical: string;
  event_type: string;
  effective_time: string | null;
  subjects: ReadonlyArray<SubjectRef>;
};

export type ClaimClusterInput = {
  canonical_signature: string;
  seen_at: string;
};

export type ClaimClusterRow = {
  cluster_id: string;
  canonical_signature: string;
  first_seen_at: string;
  last_seen_at: string;
  support_count: number;
  contradiction_count: number;
  aggregate_confidence: number;
  created_at: string;
  updated_at: string;
};

export type ClaimClusterMemberInput = {
  cluster_id: string;
  claim_id: string;
  relation: ClaimClusterMemberRelation;
};

export type ClaimClusterMemberRow = {
  claim_cluster_member_id: string;
  cluster_id: string;
  claim_id: string;
  relation: ClaimClusterMemberRelation;
  created_at: string;
};

export type AddClaimClusterMemberResult = {
  member: ClaimClusterMemberRow;
  cluster: ClaimClusterRow;
};

type ClaimClusterDbRow = Omit<
  ClaimClusterRow,
  "first_seen_at" | "last_seen_at" | "aggregate_confidence" | "created_at" | "updated_at"
> & {
  first_seen_at: Date | string;
  last_seen_at: Date | string;
  aggregate_confidence: number | string;
  created_at: Date | string;
  updated_at: Date | string;
};

type ClaimClusterMemberDbRow = Omit<ClaimClusterMemberRow, "relation" | "created_at"> & {
  relation: string;
  created_at: Date | string;
};

const CLAIM_CLUSTER_COLUMNS = `cluster_id,
               canonical_signature,
               first_seen_at,
               last_seen_at,
               support_count,
               contradiction_count,
               aggregate_confidence,
               created_at,
               updated_at`;

export function buildClaimCanonicalSignature(input: ClaimCanonicalSignatureInput): string {
  assertNonEmptyString(input.predicate, "predicate");
  assertNonEmptyString(input.text_canonical, "text_canonical");
  assertNonEmptyString(input.event_type, "event_type");
  if (input.effective_time !== null) {
    assertIso8601WithOffset(input.effective_time, "effective_time");
  }
  if (!Array.isArray(input.subjects) || input.subjects.length === 0) {
    throw new Error("subjects: must contain at least one subject");
  }

  const subjects = Array.from(new Set(input.subjects.map((subject, index) => {
    assertOneOf(subject.kind, SUBJECT_KINDS, `subjects[${index}].kind`);
    assertUuidV4(subject.id, `subjects[${index}].id`);
    return `${subject.kind}:${subject.id.toLowerCase()}`;
  }))).sort();
  const effectiveTime = input.effective_time === null
    ? null
    : new Date(input.effective_time).toISOString();

  const payload = JSON.stringify({
    version: 1,
    predicate: input.predicate.trim().toLowerCase(),
    text_canonical: input.text_canonical.trim().toLowerCase(),
    event_type: input.event_type.trim().toLowerCase(),
    effective_time: effectiveTime,
    subjects,
  });

  return `claim:v1:${createHash("sha256").update(payload).digest("hex")}`;
}

export async function upsertClaimCluster(
  db: QueryExecutor,
  input: ClaimClusterInput,
): Promise<ClaimClusterRow> {
  assertNonEmptyString(input.canonical_signature, "canonical_signature");
  assertIso8601WithOffset(input.seen_at, "seen_at");

  const { rows } = await db.query<ClaimClusterDbRow>(
    `insert into claim_clusters
       (canonical_signature, first_seen_at, last_seen_at)
     values ($1, $2::timestamptz, $2::timestamptz)
     on conflict (canonical_signature) do update
       set first_seen_at = least(claim_clusters.first_seen_at, excluded.first_seen_at),
           last_seen_at = greatest(claim_clusters.last_seen_at, excluded.last_seen_at),
           updated_at = now()
     returning ${CLAIM_CLUSTER_COLUMNS}`,
    [input.canonical_signature, input.seen_at],
  );

  return claimClusterRowFromDb(rows[0]);
}

export async function getClaimClusterBySignature(
  db: QueryExecutor,
  canonicalSignature: string,
): Promise<ClaimClusterRow | null> {
  assertNonEmptyString(canonicalSignature, "canonical_signature");

  const { rows } = await db.query<ClaimClusterDbRow>(
    `select ${CLAIM_CLUSTER_COLUMNS}
       from claim_clusters
      where canonical_signature = $1`,
    [canonicalSignature],
  );

  return rows[0] ? claimClusterRowFromDb(rows[0]) : null;
}

export async function addClaimClusterMember(
  db: QueryExecutor,
  input: ClaimClusterMemberInput,
): Promise<AddClaimClusterMemberResult> {
  validateClaimClusterMemberInput(input);

  const { rows } = await db.query<ClaimClusterMemberDbRow & ClaimClusterDbRow & {
    member_cluster_id: string;
    member_claim_id: string;
    member_created_at: Date | string;
  }>(
    `with locked_cluster as (
       select cluster_id
         from claim_clusters
        where cluster_id = $1::uuid
        for update
     ),
     existing_member as (
       select cm.claim_cluster_member_id,
              cm.cluster_id as member_cluster_id,
              cm.claim_id as member_claim_id,
              cm.relation as previous_relation,
              cm.created_at as member_created_at
         from claim_cluster_members cm
         join locked_cluster lc on lc.cluster_id = cm.cluster_id
        where cm.claim_id = $2::uuid
     ),
     upserted_member as (
       insert into claim_cluster_members
         (cluster_id, claim_id, relation)
       select lc.cluster_id, $2::uuid, $3
         from locked_cluster lc
       on conflict (cluster_id, claim_id) do update
         set relation = excluded.relation
       returning claim_cluster_member_id,
                 cluster_id as member_cluster_id,
                 claim_id as member_claim_id,
                 relation,
                 created_at as member_created_at
     ),
     changed_member as (
       select um.claim_cluster_member_id,
              um.member_cluster_id,
              um.member_claim_id,
              um.relation,
              um.member_created_at,
              em.claim_cluster_member_id is null as inserted,
              em.previous_relation
         from upserted_member um
         left join existing_member em on em.member_cluster_id = um.member_cluster_id
                                     and em.member_claim_id = um.member_claim_id
     ),
     claim_confidence as (
       select confidence::numeric as confidence
         from claims
        where claim_id = $2::uuid
     ),
     deltas as (
       select case
                when cm.inserted and cm.relation = 'support' then 1
                when cm.previous_relation = 'contradict' and cm.relation = 'support' then 1
                when cm.previous_relation = 'support' and cm.relation = 'contradict' then -1
                else 0
              end as support_delta,
              case
                when cm.inserted and cm.relation = 'contradict' then 1
                when cm.previous_relation = 'support' and cm.relation = 'contradict' then 1
                when cm.previous_relation = 'contradict' and cm.relation = 'support' then -1
                else 0
              end as contradiction_delta,
              case when cm.inserted then 1 else 0 end as total_delta,
              claim_confidence.confidence
         from changed_member cm
         cross join claim_confidence
     ),
     updated_cluster as (
       update claim_clusters cc
          set support_count = cc.support_count + d.support_delta,
              contradiction_count = cc.contradiction_count + d.contradiction_delta,
              aggregate_confidence = case
                when d.total_delta = 1 then (
                  (cc.aggregate_confidence * (cc.support_count + cc.contradiction_count)) + d.confidence
                ) / nullif(cc.support_count + cc.contradiction_count + 1, 0)
                else cc.aggregate_confidence
              end,
              updated_at = now()
         from deltas d
        where cc.cluster_id = $1::uuid
        returning cc.${CLAIM_CLUSTER_COLUMNS.replaceAll("\n               ", "\n                 cc.")}
     )
     select um.claim_cluster_member_id,
            um.member_cluster_id,
            um.member_claim_id,
            um.relation,
            um.member_created_at,
            uc.*
       from changed_member um
       join updated_cluster uc on uc.cluster_id = um.member_cluster_id`,
    [input.cluster_id, input.claim_id, input.relation],
  );

  const row = rows[0];
  return Object.freeze({
    member: claimClusterMemberRowFromDb(row && {
      claim_cluster_member_id: row.claim_cluster_member_id,
      cluster_id: row.member_cluster_id,
      claim_id: row.member_claim_id,
      relation: row.relation,
      created_at: row.member_created_at,
    }),
    cluster: claimClusterRowFromDb(row),
  });
}

function validateClaimClusterMemberInput(input: ClaimClusterMemberInput): void {
  assertUuidV4(input.cluster_id, "cluster_id");
  assertUuidV4(input.claim_id, "claim_id");
  assertOneOf(input.relation, CLAIM_CLUSTER_MEMBER_RELATIONS, "relation");
}

function claimClusterRowFromDb(row: ClaimClusterDbRow | undefined): ClaimClusterRow {
  if (!row) {
    throw new Error("claim cluster insert/select did not return a row");
  }

  return Object.freeze({
    cluster_id: row.cluster_id,
    canonical_signature: row.canonical_signature,
    first_seen_at: isoString(row.first_seen_at),
    last_seen_at: isoString(row.last_seen_at),
    support_count: Number(row.support_count),
    contradiction_count: Number(row.contradiction_count),
    aggregate_confidence: Number(row.aggregate_confidence),
    created_at: isoString(row.created_at),
    updated_at: isoString(row.updated_at),
  });
}

function claimClusterMemberRowFromDb(row: ClaimClusterMemberDbRow | undefined): ClaimClusterMemberRow {
  if (!row) {
    throw new Error("claim cluster member insert/select did not return a row");
  }

  assertOneOf(row.relation, CLAIM_CLUSTER_MEMBER_RELATIONS, "relation");

  return Object.freeze({
    claim_cluster_member_id: row.claim_cluster_member_id,
    cluster_id: row.cluster_id,
    claim_id: row.claim_id,
    relation: row.relation,
    created_at: isoString(row.created_at),
  });
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

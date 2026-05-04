import type { QueryResult } from "pg";

export const HOME_FINDING_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type HomeFindingSeverity = (typeof HOME_FINDING_SEVERITIES)[number];

export type SubjectRef = {
  kind: "issuer" | "instrument" | "listing" | "theme" | "macro_topic" | "portfolio" | "screen";
  id: string;
};

export type QueryExecutor = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
};

export type FindingCardBlock = {
  id: string;
  kind: "finding_card";
  snapshot_id: string;
  data_ref: {
    kind: "finding_card";
    id: string;
  };
  source_refs: ReadonlyArray<string>;
  as_of: string;
  finding_id: string;
  headline: string;
  severity: HomeFindingSeverity;
  subject_refs?: ReadonlyArray<SubjectRef>;
};

export type HomeFinding = {
  finding_id: string;
  agent_id: string;
  snapshot_id: string;
  subject_refs: ReadonlyArray<SubjectRef>;
  claim_cluster_ids: ReadonlyArray<string>;
  severity: HomeFindingSeverity;
  headline: string;
  summary_blocks: ReadonlyArray<FindingCardBlock>;
  created_at: string;
};

export type HomeFindingCard = {
  home_card_id: string;
  dedupe_key: string;
  primary_finding: HomeFinding;
  support_count: number;
  contributing_finding_count: number;
  severity: HomeFindingSeverity;
  headline: string;
  subject_refs: ReadonlyArray<SubjectRef>;
  summary_blocks: ReadonlyArray<FindingCardBlock>;
  created_at: string;
  agent_ids: ReadonlyArray<string>;
  finding_ids: ReadonlyArray<string>;
  claim_cluster_ids: ReadonlyArray<string>;
  user_affinity: number;
};

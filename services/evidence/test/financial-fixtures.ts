import type { TestContext } from "node:test";
import type { Client } from "pg";
import { bootstrapDatabase, connectedClient } from "../../../db/test/docker-pg.ts";

export const H = {
  v1: "1".repeat(64),
  v2: "2".repeat(64),
  private: "3".repeat(64),
  proof: "5".repeat(64),
} as const;

export const IDS = {
  owner: "1f000000-0000-4000-8000-000000000001",
  other: "1f000000-0000-4000-8000-000000000002",
  issuer: "1f000000-0000-4000-8000-0000000000a1",
  privateOnlyIssuer: "1f000000-0000-4000-8000-0000000000a2",
  metric: "1f000000-0000-4000-8000-0000000000b1",
  sourceV1: "1f000000-0000-4000-8000-0000000000c1",
  sourceV2: "1f000000-0000-4000-8000-0000000000c2",
  privateSource: "1f000000-0000-4000-8000-0000000000c3",
  document: "1f000000-0000-4000-8000-0000000000e1",
  original: "1f000000-0000-4000-8000-0000000000d1",
  restated: "1f000000-0000-4000-8000-0000000000d2",
  fy2022: "1f000000-0000-4000-8000-0000000000d3",
  privateFact: "1f000000-0000-4000-8000-0000000000d4",
  estimated: "1f000000-0000-4000-8000-0000000000d5",
  invalidated: "1f000000-0000-4000-8000-0000000000d6",
  candidate: "1f000000-0000-4000-8000-0000000000d7",
  exportOnly: "1f000000-0000-4000-8000-0000000000d8",
  derived: "1f000000-0000-4000-8000-0000000000d9",
  privateOnly: "1f000000-0000-4000-8000-0000000000da",
} as const;

export const ORIGINAL_VALUE = "383285000000.123456789012345678";

export async function financialDatabase(t: TestContext, prefix: string): Promise<Client> {
  const { databaseUrl } = await bootstrapDatabase(t, prefix);
  const client = await connectedClient(t, databaseUrl);
  await seed(client);
  return client;
}

async function seed(db: Client): Promise<void> {
  const fact = (
    id: string,
    options: {
      source?: string;
      subject?: string;
      year?: number;
      value?: string;
      method?: string;
      status?: string;
      channels?: string;
      invalidated?: boolean;
      supersedes?: string | null;
      supersededBy?: string | null;
    } = {},
  ) => {
    const year = options.year ?? 2023;
    return `('${id}', 'issuer', '${options.subject ?? IDS.issuer}', '${IDS.metric}', 'fiscal_y', '${year}-01-01', '${year}-12-31', ${year}, 'FY',
      ${options.value ?? "100"}, 'currency', 'USD', 1, '${year + 1}-01-10T00:00:00Z', '${year + 1}-01-10T00:00:00Z', '${year + 1}-02-01T00:00:00Z',
      '${options.source ?? IDS.sourceV1}', '${options.method ?? "reported"}', '${options.status ?? "authoritative"}', 'filing_time', 'full',
      '${options.channels ?? '["app"]'}'::jsonb, 1, ${options.invalidated ? "now()" : "null"},
      ${options.supersedes ? `'${options.supersedes}'` : "null"}, ${options.supersededBy ? `'${options.supersededBy}'` : "null"})`;
  };
  await db.query(`
    insert into users (user_id, email) values ('${IDS.owner}', 'owner@example.test'), ('${IDS.other}', 'other@example.test');
    insert into metrics (metric_id, metric_key, display_name, unit_class, aggregation, interpretation, canonical_source_class)
      values ('${IDS.metric}', 'revenue', 'Revenue', 'currency', 'sum', 'higher_is_better', 'filing');
    insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at, content_hash, user_id) values
      ('${IDS.sourceV1}', 'sec_edgar', 'filing', 'primary', 'public', '2024-02-01T00:00:00Z', 'sha256:${H.v1}', null),
      ('${IDS.sourceV2}', 'sec_edgar', 'filing', 'primary', 'public', '2024-06-01T00:00:00Z', '${H.v2}', null),
      ('${IDS.privateSource}', 'user_upload', 'upload', 'user', 'user_private', '2024-02-02T00:00:00Z', '${H.private}', '${IDS.owner}');
    insert into documents (document_id, source_id, kind, content_hash, raw_blob_id, deleted_at) values
      ('${IDS.document}', '${IDS.sourceV1}', 'filing', 'sha256:${H.v1}', 'sha256:${H.v1}', null);
    insert into facts (fact_id, subject_kind, subject_id, metric_id, period_kind, period_start, period_end, fiscal_year, fiscal_period,
                       value_num, unit, currency, scale, as_of, reported_at, observed_at, source_id, method, verification_status,
                       freshness_class, coverage_level, entitlement_channels, confidence, invalidated_at, supersedes, superseded_by) values
      ${fact(IDS.original, { value: ORIGINAL_VALUE, supersededBy: IDS.restated })},
      ${fact(IDS.restated, { source: IDS.sourceV2, value: "383000000000", supersedes: IDS.original })},
      ${fact(IDS.fy2022, { year: 2022, value: "365817000000" })},
      ${fact(IDS.privateFact, { source: IDS.privateSource, method: "extracted", status: "corroborated" })},
      ${fact(IDS.estimated, { method: "estimated" })},
      ${fact(IDS.invalidated, { method: "extracted", invalidated: true })},
      ${fact(IDS.candidate, { method: "extracted", status: "candidate" })},
      ${fact(IDS.exportOnly, { method: "extracted", channels: '["export"]' })},
      ${fact(IDS.derived, { method: "derived" })},
      ${fact(IDS.privateOnly, { subject: IDS.privateOnlyIssuer, source: IDS.privateSource, method: "extracted" })};
  `);
}

export function publicationInput(overrides: Record<string, unknown> = {}) {
  return {
    source_id: IDS.sourceV1,
    document_id: null,
    source_version_hash: H.v1,
    available_not_before: null,
    available_no_later_than: "2024-01-10T23:59:59.999-05:00",
    timing_precision: "date" as const,
    source_timezone: "America/New_York",
    proof_method: "accession_bound_archive" as const,
    proof_ref: "s3://proofs/0000320193-24-000006",
    proof_hash: H.proof,
    mapping_version: "sec-acceptance-mapping.v1",
    ...overrides,
  };
}

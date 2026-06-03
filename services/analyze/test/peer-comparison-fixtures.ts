// Shared fakes for the peer-comparison emitter + the section runner: a one-peer
// gross_margin key-stats envelope and a stateful fake DB that resolves metric ids,
// captures derived-fact inserts, and serves the fact-load select.
import { randomUUID } from "node:crypto";

import type { KeyStatsEnvelope } from "../../fundamentals/src/key-stats.ts";
import type { PeerSetResolver } from "../../fundamentals/src/peer-set-resolver.ts";
import type { StatsRepository } from "../../fundamentals/src/stats-repository.ts";
import type { IssuerSubjectRef } from "../../fundamentals/src/subject-ref.ts";

export const SNAP = "11111111-1111-4111-a111-111111111111";
export const BLOCK_ID = "peer-table-1";
export const AS_OF = "2024-11-01T20:30:00.000Z";
export const GROSS_MARGIN_METRIC_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0038";
export const SRC = "00000000-0000-4000-a000-0000000000ed";

export const PRIMARY: IssuerSubjectRef = { kind: "issuer", id: "22222222-2222-4222-a222-222222222222" };
export const PEER: IssuerSubjectRef = { kind: "issuer", id: "33333333-3333-4333-a333-333333333333" };
export const REV_PRIMARY = "f0000000-0000-4000-8000-000000000001";
export const REV_PEER = "f0000000-0000-4000-8000-000000000002";

function envelope(subject: IssuerSubjectRef, grossMargin: number, revenueFactId: string): KeyStatsEnvelope {
  const period = {
    basis: "as_reported" as const,
    period_kind: "fiscal_y" as const,
    period_start: "2023-10-01",
    period_end: "2024-09-28",
    fiscal_year: 2024,
    fiscal_period: "FY" as const,
    as_of: AS_OF,
  };
  return {
    subject,
    family: "key_stats",
    reporting_currency: "USD",
    ...period,
    stats: [
      {
        stat_key: "gross_margin",
        value_num: grossMargin,
        unit: "ratio",
        format_hint: "percent",
        coverage_level: "full",
        ...period,
        computation: { kind: "ratio", expression: "gross_profit / revenue" },
        warnings: [],
        inputs: [
          {
            kind: "statement_line",
            role: "numerator",
            metric_key: "gross_profit",
            metric_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0007",
            fact_id: randomUUID(),
            value_num: grossMargin * 100,
            unit: "currency",
            currency: "USD",
            coverage_level: "full",
            source_id: SRC,
            ...period,
          },
          {
            kind: "statement_line",
            role: "denominator",
            metric_key: "revenue",
            metric_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0003",
            fact_id: revenueFactId,
            value_num: 100,
            unit: "currency",
            currency: "USD",
            coverage_level: "full",
            source_id: SRC,
            ...period,
          },
        ],
      },
    ],
  };
}

export const resolver: PeerSetResolver = {
  async resolvePeers() {
    return [PEER];
  },
};

export const stats: StatsRepository = {
  async find(issuerId) {
    if (issuerId === PRIMARY.id) return envelope(PRIMARY, 0.46, REV_PRIMARY);
    if (issuerId === PEER.id) return envelope(PEER, 0.69, REV_PEER);
    return null;
  },
};

// Echo the createFact insert values back as a RETURNING row (only fact_id is read).
function factRow(factId: string, v: unknown[]): Record<string, unknown> {
  return {
    fact_id: factId,
    subject_kind: v[0], subject_id: v[1], metric_id: v[2], period_kind: v[3],
    period_start: v[4], period_end: v[5], fiscal_year: v[6], fiscal_period: v[7],
    value_num: v[8], value_text: v[9], unit: v[10], currency: v[11], scale: v[12],
    as_of: v[13], reported_at: v[14], observed_at: v[15], source_id: v[16],
    method: v[17], adjustment_basis: v[18], definition_version: v[19],
    verification_status: v[20], freshness_class: v[21], coverage_level: v[22],
    quality_flags: JSON.parse(v[23] as string), entitlement_channels: JSON.parse(v[24] as string),
    confidence: v[25], supersedes: v[26] ?? null, superseded_by: null,
    invalidated_at: null, ingestion_batch_id: v[27] ?? null,
    created_at: v[15], updated_at: v[15],
  };
}

// Stateful fake DB: resolves derived metric_ids, captures fact inserts, and serves
// the fact-load select for both inserted (derived) and pre-seeded (reused revenue) facts.
export function fakeDb() {
  const facts = new Map<string, Record<string, unknown>>();
  for (const factId of [REV_PRIMARY, REV_PEER]) {
    facts.set(factId, {
      fact_id: factId,
      source_id: SRC,
      unit: "currency",
      period_kind: "fiscal_y",
      period_start: "2023-10-01",
      period_end: "2024-09-28",
      fiscal_year: 2024,
      fiscal_period: "FY",
    });
  }
  const db = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async query(text: string, params?: unknown[]): Promise<any> {
      if (/from metrics/i.test(text)) {
        const keys = (params?.[0] as string[]) ?? [];
        return { rows: keys.filter((k) => k === "gross_margin").map((k) => ({ metric_key: k, metric_id: GROSS_MARGIN_METRIC_ID })) };
      }
      if (/insert into facts/i.test(text)) {
        const v = params ?? [];
        const factId = randomUUID();
        facts.set(factId, {
          fact_id: factId,
          source_id: v[16],
          unit: v[10],
          period_kind: v[3],
          period_start: v[4],
          period_end: v[5],
          fiscal_year: v[6],
          fiscal_period: v[7],
        });
        return { rows: [{ ...factRow(factId, v) }] };
      }
      if (/from facts/i.test(text)) {
        const ids = (params?.[0] as string[]) ?? [];
        return { rows: ids.map((id) => facts.get(id)).filter(Boolean) };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
  return { db };
}

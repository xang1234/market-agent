// Deterministic peer selection for the metrics_comparison emitter: same-industry
// issuers ranked by market cap. Kept behind the PeerSetResolver interface so the
// SQL implementation can later be swapped for the get_peer_set tool without
// touching callers (signed off 2026-06-01: same issuers.industry, top N=5).

import type { FundamentalsQueryExecutor } from "./sec-facts-repository.ts";
import { freezeIssuerRef, type IssuerSubjectRef, type UUID } from "./subject-ref.ts";
import { assertPositiveInteger, assertUuid } from "./validators.ts";

export const DEFAULT_PEER_LIMIT = 5;

export type PeerSetResolver = {
  // The comparison peers for an issuer: same-industry issuers excluding the
  // primary, ranked by latest market cap (desc), capped at `limit`. The caller
  // prepends the primary itself to form the full comparison set.
  resolvePeers(issuerId: UUID, options?: { limit?: number }): Promise<ReadonlyArray<IssuerSubjectRef>>;
};

// SQL-backed resolver. Ranks by each issuer's latest market_cap fact; issuers
// without one sort last (kept only to fill the quota when ranked peers are
// scarce), and issuer_id is the deterministic tiebreak. A null primary industry
// yields no peers (industry = null never matches).
export function createSqlPeerSetResolver(db: FundamentalsQueryExecutor): PeerSetResolver {
  return {
    async resolvePeers(issuerId, options = {}) {
      assertUuid(issuerId, "resolvePeers.issuer_id");
      const limit = options.limit ?? DEFAULT_PEER_LIMIT;
      assertPositiveInteger(limit, "resolvePeers.limit");

      const { rows } = await db.query<{ issuer_id: string }>(
        `select peer.issuer_id::text as issuer_id
           from issuers peer
           join issuers primary_issuer on primary_issuer.issuer_id = $1
           left join lateral (
             select f.value_num
               from facts f
               join metrics m on m.metric_id = f.metric_id
              where f.subject_kind = 'issuer'
                and f.subject_id = peer.issuer_id
                and m.metric_key = 'market_cap'
                and f.invalidated_at is null
                and f.superseded_by is null
              order by f.as_of desc
              limit 1
           ) cap on true
          where peer.issuer_id <> $1
            and peer.industry is not null
            and peer.industry = primary_issuer.industry
          order by cap.value_num desc nulls last, peer.issuer_id
          limit $2`,
        [issuerId, limit],
      );

      return Object.freeze(
        rows.map((row) => freezeIssuerRef({ kind: "issuer", id: row.issuer_id }, "resolvePeers.peer")),
      );
    },
  };
}

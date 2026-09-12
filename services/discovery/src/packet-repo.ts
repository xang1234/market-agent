import type { QueryExecutor } from "../../agents/src/agent-repo.ts";
import { requestHash } from "./scout-support.ts";
import type { DiscoveryRepository, EvidencePacket, Lease, StoredResearchPacket } from "./ports.ts";
import { DiscoveryError } from "./types.ts";
import { json, jsonValue, requireUuid, transaction } from "./repository-support.ts";
import { lockLiveLease } from "./worker-lock.ts";

type PacketRow = { research_packet: unknown; research_packet_hash: string | null; issuer_id: string | null; state: string; assessment: unknown; snapshot_id: string | null };

/** Durable packet storage deliberately owns worker-only JSON and fresh visibility checks. */
export function createPacketStore(db: QueryExecutor, clock: () => Date): Pick<DiscoveryRepository,
  "authorizeExistingCandidates" | "loadResearchPacket" | "saveResearchPacket" | "refreshResearchPacket"
> {
  return {
    async authorizeExistingCandidates(lease, candidates) {
      const supplied = candidates.filter((candidate) => candidate.identity !== null).map((candidate) => ({
        candidate_id: candidate.candidate_id,
        issuer_id: candidate.identity!.issuer_id,
        listing_id: candidate.identity!.listing_id,
        legal_name: candidate.identity!.legal_name,
        ticker: candidate.identity!.ticker,
        mic: candidate.identity!.mic,
        currency: candidate.identity!.currency,
        asset_type: candidate.identity!.asset_type,
        primary_domain_lead: candidate.primary_domain_lead,
        evidence_refs: candidate.evidence_refs,
      }));
      if (supplied.length === 0) return new Set();
      return transaction(db, async (tx) => {
        await lockLiveLease(tx, lease, clock());
        const { rows } = await tx.query<{ candidate_id: string }>(
          `with supplied as (
             select * from jsonb_to_recordset($2::jsonb) as input(
               candidate_id uuid,issuer_id uuid,listing_id uuid,legal_name text,ticker text,mic text,currency text,asset_type text,primary_domain_lead boolean,evidence_refs jsonb
             )
           ), evidence as (
             select supplied.candidate_id,
               case
                 when ref.kind='document' then d.document_id is not null and source_document.source_id is not null
                   and (ref.claim_id is null or c.claim_id is not null)
                   and exists (select 1 from mentions m where m.document_id=d.document_id and m.subject_kind='issuer' and m.subject_id=supplied.issuer_id)
                 when ref.kind='fact' then f.fact_id is not null and source_fact.source_id is not null
                   and f.entitlement_channels ? 'app' and f.invalidated_at is null and f.superseded_by is null
                 else false
               end as usable,
               ref.kind='document' and d.document_id is not null and source_document.source_id is not null
                 and (ref.claim_id is null or c.claim_id is not null)
                 and exists (select 1 from mentions m where m.document_id=d.document_id and m.subject_kind='issuer' and m.subject_id=supplied.issuer_id)
                 and source_document.trust_tier='primary'
                 and (source_document.provider='sec_edgar' or exists (
                   select 1 from ir_document_assets a where a.document_id=d.document_id and a.issuer_id=supplied.issuer_id and a.issuer_attested
                 )) as primary_usable
             from supplied
             cross join lateral jsonb_to_recordset(supplied.evidence_refs) as ref(kind text,source_id uuid,document_id uuid,claim_id uuid,fact_id uuid)
             left join documents d on ref.kind='document' and d.document_id=ref.document_id and d.source_id=ref.source_id and d.deleted_at is null
             left join sources source_document on source_document.source_id=d.source_id and (source_document.user_id is null or source_document.user_id=$1::uuid)
             left join claims c on c.claim_id=ref.claim_id and c.document_id=d.document_id and c.reported_by_source_id=ref.source_id and c.superseded_at is null
             left join facts f on ref.kind='fact' and f.fact_id=ref.fact_id and f.source_id=ref.source_id and f.subject_kind='issuer' and f.subject_id=supplied.issuer_id
             left join sources source_fact on source_fact.source_id=f.source_id and (source_fact.user_id is null or source_fact.user_id=$1::uuid)
           )
           select supplied.candidate_id::text as candidate_id
             from supplied
             join listings l on l.listing_id=supplied.listing_id
             join instruments i on i.instrument_id=l.instrument_id and i.issuer_id=supplied.issuer_id and i.asset_type::text=supplied.asset_type
             join issuers iss on iss.issuer_id=i.issuer_id and iss.legal_name=supplied.legal_name
            where l.active_to is null and l.ticker=supplied.ticker and l.mic=supplied.mic and l.trading_currency=supplied.currency
              and l.mic in ('XNYS','XNAS','XASE','ARCX','BATS','IEXG') and i.asset_type in ('common_stock','adr')
              and exists (select 1 from evidence where evidence.candidate_id=supplied.candidate_id and evidence.usable)
              and (not supplied.primary_domain_lead or exists (
                select 1 from evidence where evidence.candidate_id=supplied.candidate_id and evidence.primary_usable
              ))`,
          [lease.user_id, json(supplied)],
        );
        return new Set(rows.map((row) => row.candidate_id));
      });
    },
    async loadResearchPacket(lease, candidateId) {
      requireUuid(candidateId, "candidate_id");
      return transaction(db, async (tx) => {
        await lockLiveLease(tx, lease, clock());
        const row = await lockedPacketRow(tx, lease, candidateId);
        if (row.research_packet === null || row.research_packet === undefined || row.research_packet_hash === null) return null;
        const packet = jsonValue<EvidencePacket>(row.research_packet, "research_packet");
        if (requestHash(packet) !== row.research_packet_hash) throw new DiscoveryError("validation", "stored research packet hash is invalid");
        return Object.freeze({ packet, packet_hash: row.research_packet_hash });
      });
    },
    async saveResearchPacket(lease, packet) {
      requireUuid(packet.candidate_id, "candidate_id");
      const packet_hash = requestHash(packet);
      return transaction(db, async (tx) => {
        await lockLiveLease(tx, lease, clock());
        const row = await lockedPacketRow(tx, lease, packet.candidate_id);
        if (row.issuer_id !== packet.identity.issuer_id) throw new DiscoveryError("request_conflict", "candidate issuer no longer matches the research packet");
        if (row.research_packet !== null && row.research_packet !== undefined) {
          const existing = jsonValue<EvidencePacket>(row.research_packet, "research_packet");
          if (row.research_packet_hash !== requestHash(existing) || row.research_packet_hash !== packet_hash) {
            throw new DiscoveryError("request_conflict", "candidate already has a different immutable research packet");
          }
          return Object.freeze({ packet: existing, packet_hash });
        }
        await tx.query(
          "update discovery_candidates set research_packet=$3::jsonb,research_packet_hash=$4,updated_at=now() where run_id=$1::uuid and candidate_id=$2::uuid",
          [lease.run_id, packet.candidate_id, json(packet), packet_hash],
        );
        return Object.freeze({ packet, packet_hash });
      });
    },
    async refreshResearchPacket(lease, packet) {
      return transaction(db, async (tx) => {
        await lockLiveLease(tx, lease, clock());
        const row = await lockedPacketRow(tx, lease, packet.candidate_id);
        if (row.issuer_id !== packet.identity.issuer_id || row.research_packet_hash !== requestHash(packet)) {
          throw new DiscoveryError("request_conflict", "research packet is not the durable original packet");
        }
        const eligible = await tx.query<{ listing_id: string }>(
          `select l.listing_id::text as listing_id
             from listings l join instruments i on i.instrument_id=l.instrument_id join issuers iss on iss.issuer_id=i.issuer_id
            where l.listing_id=$1::uuid and i.issuer_id=$2::uuid and iss.legal_name=$3
              and l.ticker=$4 and l.mic=$5 and l.trading_currency=$6 and i.asset_type::text=$7
              and l.active_to is null and l.mic in ('XNYS','XNAS','XASE','ARCX','BATS','IEXG') and i.asset_type in ('common_stock','adr')`,
          [
            packet.identity.listing_id, packet.identity.issuer_id, packet.identity.legal_name,
            packet.identity.ticker, packet.identity.mic, packet.identity.currency, packet.identity.asset_type,
          ],
        );
        if (!eligible.rows[0]) throw new DiscoveryError("not_found", "candidate identity is no longer eligible");
        const documentIds = unique([...packet.excerpts.map((item) => item.document_id), ...packet.claims.map((item) => item.document_id)]);
        const documents = await visibleDocuments(tx, lease.user_id, documentIds);
        const factIds = unique(packet.facts.map((item) => item.fact_id));
        const facts = await visibleFacts(tx, lease.user_id, factIds);
        const excerpts = packet.excerpts.filter((item) => documents.get(item.document_id) === item.source_id);
        const claims = packet.claims.filter((item) => documents.get(item.document_id) === item.source_id);
        const quoteClaims = await visibleQuoteClaims(tx, lease.user_id, documentIds);
        const currentFacts = packet.facts.filter((item) => facts.get(item.fact_id) === item.source_id);
        const removed = packet.excerpts.length - excerpts.length + packet.claims.length - claims.length + packet.facts.length - currentFacts.length;
        return Object.freeze({
          ...packet,
          excerpts,
          claims: uniqueClaims([...claims, ...quoteClaims]),
          facts: currentFacts,
          coverage_gaps: [...new Set([...packet.coverage_gaps, ...(removed > 0 ? ["current_source_access_changed"] : [])])],
        });
      });
    },
  };
}

async function visibleQuoteClaims(
  tx: QueryExecutor,
  userId: string,
  ids: string[],
): Promise<EvidencePacket["claims"]> {
  if (ids.length === 0) return [];
  const { rows } = await tx.query<{ claim_id: string; document_id: string; source_id: string; text_canonical: string }>(
    `select qc.claim_id::text as claim_id,qc.document_id::text as document_id,qc.source_id::text as source_id,c.text_canonical
       from discovery_quote_claims qc
       join claims c on c.claim_id=qc.claim_id
       join documents d on d.document_id=qc.document_id and d.deleted_at is null
       join sources s on s.source_id=qc.source_id and (s.user_id is null or s.user_id=$2::uuid)
      where qc.document_id=any($1::uuid[]) and d.source_id=qc.source_id`,
    [ids, userId],
  );
  return rows;
}

async function lockedPacketRow(tx: QueryExecutor, lease: Lease, candidateId: string): Promise<PacketRow> {
  const { rows } = await tx.query<PacketRow>(
    `select research_packet,research_packet_hash,issuer_id::text as issuer_id,state,assessment,snapshot_id::text as snapshot_id
       from discovery_candidates where run_id=$1::uuid and candidate_id=$2::uuid for update`,
    [lease.run_id, candidateId],
  );
  const row = rows[0];
  if (!row || row.state !== "researching" || row.assessment !== null || row.snapshot_id !== null) {
    throw new DiscoveryError("request_conflict", "candidate is not available for research");
  }
  return row;
}

async function visibleDocuments(tx: QueryExecutor, userId: string, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { rows } = await tx.query<{ document_id: string; source_id: string }>(
    `select d.document_id::text as document_id,d.source_id::text as source_id
       from documents d join sources s on s.source_id=d.source_id
      where d.document_id=any($1::uuid[]) and d.deleted_at is null and (s.user_id is null or s.user_id=$2::uuid)`,
    [ids, userId],
  );
  return new Map(rows.map((row) => [row.document_id, row.source_id]));
}

async function visibleFacts(tx: QueryExecutor, userId: string, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { rows } = await tx.query<{ fact_id: string; source_id: string }>(
    `select f.fact_id::text as fact_id,f.source_id::text as source_id from facts f join sources s on s.source_id=f.source_id
      where f.fact_id=any($1::uuid[]) and f.invalidated_at is null and f.superseded_by is null
        and f.entitlement_channels ? 'app' and (s.user_id is null or s.user_id=$2::uuid)`,
    [ids, userId],
  );
  return new Map(rows.map((row) => [row.fact_id, row.source_id]));
}

function unique(values: string[]): string[] { return [...new Set(values)]; }
function uniqueClaims(claims: EvidencePacket["claims"]): EvidencePacket["claims"] {
  const result = new Map<string, EvidencePacket["claims"][number]>();
  for (const claim of claims) result.set(claim.claim_id, claim);
  return [...result.values()];
}

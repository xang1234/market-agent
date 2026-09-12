import type { CampaignQuote } from "../../evidence/src/campaign-claims.ts";
import type { EvidencePacket } from "./ports.ts";
import type { AnalystOutput, RawCitation, SkepticOutput } from "./types.ts";

/**
 * Converts model excerpt citations into the normalized-document coordinates
 * required by the durable quote-claim ledger. `excerpt.normalized_start` is
 * already a canonical-document offset, so adding an index in the same
 * whitespace-normalized text cannot move that coordinate system.
 */
export function canonicalCampaignQuotes(
  role: AnalystOutput<RawCitation> | SkepticOutput<RawCitation>,
  packet: EvidencePacket,
): CampaignQuote[] {
  const excerpts = new Map(packet.excerpts.map((excerpt) => [excerpt.excerpt_id, excerpt]));
  const quotes = new Map<string, CampaignQuote>();
  for (const citation of roleCitations(role)) {
    if (citation.kind !== "excerpt") continue;
    const excerpt = excerpts.get(citation.id);
    if (excerpt === undefined) throw new Error("excerpt citation is outside the supplied packet");
    const normalizedQuote = normalize(citation.quote);
    if (citation.quote !== normalizedQuote) throw new Error("excerpt quote must use canonical normalized whitespace");
    const text = normalize(excerpt.text);
    const index = text.indexOf(normalizedQuote);
    if (index < 0) throw new Error("excerpt quote does not match the supplied excerpt");
    if (text.indexOf(normalizedQuote, index + 1) >= 0) {
      throw new Error("excerpt quote is ambiguous across multiple canonical source locations");
    }
    if (!Number.isSafeInteger(excerpt.normalized_start) || excerpt.normalized_start < 0) {
      throw new Error("excerpt has an invalid canonical document offset");
    }
    quotes.set(`${citation.id}\u0000${citation.quote}`, {
      excerpt_id: excerpt.excerpt_id,
      document_id: excerpt.document_id,
      source_id: excerpt.source_id,
      document_hash: excerpt.document_hash,
      normalized_start: excerpt.normalized_start + index,
      quote: citation.quote,
    });
  }
  return [...quotes.values()];
}

function roleCitations(role: AnalystOutput<RawCitation> | SkepticOutput<RawCitation>): RawCitation[] {
  return [
    ...role.exposure.citations,
    ...role.business_quality.citations,
    ...role.valuation_context.citations,
    ...role.criteria.flatMap((criterion) => criterion.citations),
    ...("counterarguments" in role ? role.counterarguments.flatMap((counterargument) => counterargument.citations) : []),
  ];
}

function normalize(value: string): string { return value.replace(/\s+/gu, " ").trim(); }

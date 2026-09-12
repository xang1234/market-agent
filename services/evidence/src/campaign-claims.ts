import { createHash } from "node:crypto";

import { withTransaction } from "./transaction.ts";
import type { QueryExecutor } from "./types.ts";
import { assertNonEmptyString, assertUuidV4 } from "./validators.ts";

export type CampaignQuote = Readonly<{
  excerpt_id: string;
  document_id: string;
  source_id: string;
  document_hash: string;
  normalized_start: number;
  quote: string;
}>;

export function campaignQuoteKey(input: Pick<CampaignQuote, "document_id" | "document_hash" | "normalized_start" | "quote">): string {
  assertUuidV4(input.document_id, "document_id");
  assertNonEmptyString(input.document_hash, "document_hash");
  if (!Number.isSafeInteger(input.normalized_start) || input.normalized_start < 0) throw new Error("normalized_start must be a non-negative safe integer");
  const quote = normalizedQuote(input.quote);
  return sha256(JSON.stringify({ document_id: input.document_id, document_hash: input.document_hash, normalized_start: input.normalized_start, quote }));
}

export async function persistCampaignQuotes(
  db: QueryExecutor,
  input: { operation_key: string; request_hash: string; quotes: ReadonlyArray<CampaignQuote> },
): Promise<Map<string, { kind: "claim"; id: string }>> {
  assertNonEmptyString(input.operation_key, "operation_key");
  assertHash(input.request_hash, "request_hash");
  const quotes = input.quotes.map(normalizeQuote);
  if (new Set(quotes.map((quote) => quote.excerpt_id + "\u0000" + quote.quote)).size !== quotes.length) {
    throw new Error("quote citations must be unique");
  }
  return withTransaction(db, async ({ db: tx }) => {
    const citations = new Map<string, { kind: "claim"; id: string }>();
    for (const quote of quotes) {
      const quote_key = campaignQuoteKey(quote);
      const known = await tx.query<{ claim_id: string }>(
        "select claim_id::text as claim_id from discovery_quote_claims where quote_key=$1 for update",
        [quote_key],
      );
      const existing = known.rows[0]?.claim_id;
      if (existing !== undefined) {
        citations.set(citationMapKey(quote), { kind: "claim", id: existing });
        continue;
      }

      const claim_id = uuidFromHash(quote_key);
      await tx.query(
        `insert into claims (claim_id,document_id,predicate,text_canonical,polarity,modality,reported_by_source_id,confidence,status)
         values ($1::uuid,$2::uuid,'campaign_exact_quote',$3,'neutral'::polarity,'quoted'::claim_modality,$4::uuid,1,'extracted'::claim_status)
         on conflict (claim_id) do nothing`,
        [claim_id, quote.document_id, quote.quote, quote.source_id],
      );
      const inserted = await tx.query<{ claim_id: string }>(
        `insert into discovery_quote_claims (quote_key,operation_key,request_hash,claim_id,document_id,source_id,document_hash,normalized_start,quote_hash)
         values ($1,$2,$3,$4::uuid,$5::uuid,$6::uuid,$7,$8,$9)
         on conflict (quote_key) do nothing
         returning claim_id::text as claim_id`,
        [quote_key, input.operation_key, input.request_hash, claim_id, quote.document_id, quote.source_id, quote.document_hash, quote.normalized_start, sha256(normalizedQuote(quote.quote))],
      );
      const mapped = inserted.rows[0]?.claim_id;
      if (mapped === undefined) {
        const raced = await tx.query<{ claim_id: string }>(
          "select claim_id::text as claim_id from discovery_quote_claims where quote_key=$1 for update",
          [quote_key],
        );
        const racedClaim = raced.rows[0]?.claim_id;
        if (racedClaim === undefined) throw new Error("quote claim mapping was not persisted");
        citations.set(citationMapKey(quote), { kind: "claim", id: racedClaim });
        continue;
      }
      await tx.query(
        `insert into claim_evidence (claim_id,document_id,locator,excerpt_hash,confidence)
         values ($1::uuid,$2::uuid,$3::jsonb,$4,1)`,
        [mapped, quote.document_id, JSON.stringify({ kind: "normalized_text", offset_start: quote.normalized_start, offset_end: quote.normalized_start + normalizedQuote(quote.quote).length }), sha256(normalizedQuote(quote.quote))],
      );
      citations.set(citationMapKey(quote), { kind: "claim", id: mapped });
    }
    return citations;
  });
}

function normalizeQuote(value: CampaignQuote): CampaignQuote {
  assertUuidV4(value.excerpt_id, "excerpt_id");
  assertUuidV4(value.document_id, "document_id");
  assertUuidV4(value.source_id, "source_id");
  assertNonEmptyString(value.document_hash, "document_hash");
  if (!Number.isSafeInteger(value.normalized_start) || value.normalized_start < 0) throw new Error("normalized_start must be a non-negative safe integer");
  normalizedQuote(value.quote);
  return value;
}

function normalizedQuote(value: string): string {
  if (typeof value !== "string" || value !== value.trim()) throw new Error("quote must be trimmed");
  const normalized = value.replace(/\s+/gu, " ");
  if (value !== normalized) throw new Error("quote must use canonical normalized whitespace");
  if (normalized.length < 20 || normalized.length > 1_000) throw new Error("quote must contain 20 to 1,000 normalized characters");
  return normalized;
}

function citationMapKey(quote: CampaignQuote): string { return `excerpt:${quote.excerpt_id}:${quote.quote}`; }
function sha256(value: string): string { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function assertHash(value: string, label: string): void {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) throw new Error(`${label} must be a sha256 hash`);
}
function uuidFromHash(hash: string): string {
  const hex = hash.slice("sha256:".length);
  const bytes = hex.slice(0, 32).split("");
  bytes[12] = "4";
  bytes[16] = ["8", "9", "a", "b"][Number.parseInt(bytes[16]!, 16) & 3]!;
  const id = bytes.join("");
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20, 32)}`;
}

// Press release / earnings transcript / news article ingestion.
//
// Three byte-in orchestrators — the caller fetches bytes from whatever
// provider (BusinessWire API, Seeking Alpha, Reuters, etc.); this layer
// canonicalizes the URL, attributes the publisher, and routes through
// the license-aware ingest pipeline. Provider-specific HTTP fetchers
// are intentionally out of scope (each lands as its own bead).

import { type DocumentInput } from "./document-repo.ts";
import { ingestDocument, type IngestDocumentResult } from "./ingest.ts";
import type { ObjectStore } from "./object-store.ts";
import {
  createSource,
  type SourceKind,
  type SourceRow,
  type TrustTier,
} from "./source-repo.ts";
import type { QueryExecutor } from "./types.ts";
import {
  assertIso8601WithOffset,
  assertNonEmptyBytes,
  assertNonEmptyString,
  assertOneOf,
} from "./validators.ts";

// Spec § 5.2 mappings — the kind-specific subset of trust tiers the
// orchestrator accepts. Anything outside these (e.g., trust_tier="user"
// for a press release) is rejected at the API boundary.
export const PRESS_RELEASE_ALLOWED_TRUST_TIERS: ReadonlyArray<TrustTier> = Object.freeze([
  "primary",
  "secondary",
]);
export const TRANSCRIPT_ALLOWED_TRUST_TIERS: ReadonlyArray<TrustTier> = Object.freeze([
  "secondary",
  "tertiary",
]);
export const NEWS_ARTICLE_ALLOWED_TRUST_TIERS: ReadonlyArray<TrustTier> = Object.freeze([
  "secondary",
  "tertiary",
]);

// Provider-string substrings that mark "this is the issuer's own
// newsroom" — the orchestrator defaults trust_tier to "primary" when
// the press-release provider matches. Caller can always override.
const ISSUER_PROVIDER_PATTERNS = [/^issuer_/, /^ir_/];

// ---- canonicalizeNewsUrl ---------------------------------------------------

const TRACKING_PARAM_NAMES: ReadonlyArray<string> = Object.freeze([
  // utm_* covers all utm_source/utm_medium/utm_campaign/utm_term/utm_content variants.
  // Handled via prefix match below — the rest of the list is exact-match.
  "fbclid",
  "gclid",
  "mc_eid",
  "mc_cid",
  "_hsenc",
  "_hsmi",
  "yclid",
  "msclkid",
]);

export function canonicalizeNewsUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`canonicalizeNewsUrl: invalid URL "${rawUrl}"`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `canonicalizeNewsUrl: scheme must be http(s); received "${parsed.protocol}"`,
    );
  }

  // Lowercase host (per RFC 3986 case-insensitive); preserve path/query case.
  parsed.host = parsed.host.toLowerCase();

  // Strip tracking params: utm_* prefix + the exact-match list above.
  // URLSearchParams.delete is in-place; iterate over a snapshot of names.
  const namesToCheck = Array.from(parsed.searchParams.keys());
  for (const name of namesToCheck) {
    if (name.startsWith("utm_") || TRACKING_PARAM_NAMES.includes(name)) {
      parsed.searchParams.delete(name);
    }
  }

  // Drop trailing slash from path — but only if there IS a path beyond "/".
  // "https://example.com/" stays as "/" (root-vs-no-path semantics differ).
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }

  return parsed.toString();
}

// ---- shared input/result types ---------------------------------------------

type IngestDeps = {
  db: QueryExecutor;
  objectStore: ObjectStore;
};

type IngestResult = {
  source: SourceRow;
  ingest: IngestDocumentResult;
};

// ---- ingestPressRelease ----------------------------------------------------

export type IngestPressReleaseInput = {
  bytes: Uint8Array;
  provider: string;
  canonicalUrl: string;
  publisher: string;
  publishedAt: string;
  // Optional headline; falls back to publisher because press releases
  // don't always have a separable title in the wire payload (the
  // publisher attribution is what users scan in lists).
  title?: string;
  providerDocId?: string;
  trustTier?: TrustTier;
  licenseClass?: string;
  retrievedAt?: string;
};

export async function ingestPressRelease(
  deps: IngestDeps,
  input: IngestPressReleaseInput,
): Promise<IngestResult> {
  assertNonEmptyBytes(input.bytes, "bytes");
  assertNonEmptyString(input.provider, "provider");
  assertNonEmptyString(input.publisher, "publisher");
  assertIso8601WithOffset(input.publishedAt, "published_at");

  const trustTier = input.trustTier ?? defaultPressReleaseTrustTier(input.provider);
  assertOneOf(trustTier, PRESS_RELEASE_ALLOWED_TRUST_TIERS, "trust_tier");

  const licenseClass = input.licenseClass ?? "public";
  const canonicalUrl = canonicalizeNewsUrl(input.canonicalUrl);

  return persistKindedSource(deps, {
    provider: input.provider,
    kind: "press_release",
    canonicalUrl,
    trustTier,
    licenseClass,
    bytes: input.bytes,
    document: {
      title: input.title ?? input.publisher,
      provider_doc_id: input.providerDocId,
      published_at: input.publishedAt,
    },
    retrievedAt: input.retrievedAt,
  });
}

function defaultPressReleaseTrustTier(provider: string): TrustTier {
  return ISSUER_PROVIDER_PATTERNS.some((pattern) => pattern.test(provider))
    ? "primary"
    : "secondary";
}

// ---- ingestEarningsTranscript ----------------------------------------------

export type IngestEarningsTranscriptInput = {
  bytes: Uint8Array;
  provider: string;
  canonicalUrl: string;
  publisher: string;
  publishedAt: string;
  // e.g., "2026Q1", "2026FY". Required so the transcript is dedupable
  // and routable per (issuer, period) without re-parsing the body.
  fiscalPeriod: string;
  issuer: string;
  providerDocId?: string;
  trustTier?: TrustTier;
  licenseClass?: string;
  retrievedAt?: string;
};

export async function ingestEarningsTranscript(
  deps: IngestDeps,
  input: IngestEarningsTranscriptInput,
): Promise<IngestResult> {
  assertNonEmptyBytes(input.bytes, "bytes");
  assertNonEmptyString(input.provider, "provider");
  assertNonEmptyString(input.publisher, "publisher");
  assertNonEmptyString(input.issuer, "issuer");
  assertNonEmptyString(input.fiscalPeriod, "fiscal_period");
  assertIso8601WithOffset(input.publishedAt, "published_at");

  const trustTier = input.trustTier ?? "secondary";
  assertOneOf(trustTier, TRANSCRIPT_ALLOWED_TRUST_TIERS, "trust_tier");

  const licenseClass = input.licenseClass ?? "licensed";
  const canonicalUrl = canonicalizeNewsUrl(input.canonicalUrl);

  return persistKindedSource(deps, {
    provider: input.provider,
    kind: "transcript",
    canonicalUrl,
    trustTier,
    licenseClass,
    bytes: input.bytes,
    document: {
      title: `${input.issuer} — ${input.fiscalPeriod} earnings call`,
      author: input.publisher,
      provider_doc_id: input.providerDocId,
      published_at: input.publishedAt,
    },
    retrievedAt: input.retrievedAt,
  });
}

// ---- ingestNewsArticle -----------------------------------------------------

export type IngestNewsArticleInput = {
  bytes: Uint8Array;
  provider: string;
  canonicalUrl: string;
  publisher: string;
  title: string;
  publishedAt: string;
  author?: string;
  providerDocId?: string;
  trustTier?: TrustTier;
  licenseClass?: string;
  retrievedAt?: string;
};

export async function ingestNewsArticle(
  deps: IngestDeps,
  input: IngestNewsArticleInput,
): Promise<IngestResult> {
  assertNonEmptyBytes(input.bytes, "bytes");
  assertNonEmptyString(input.provider, "provider");
  assertNonEmptyString(input.publisher, "publisher");
  assertNonEmptyString(input.title, "title");
  assertIso8601WithOffset(input.publishedAt, "published_at");

  const trustTier = input.trustTier ?? "tertiary";
  assertOneOf(trustTier, NEWS_ARTICLE_ALLOWED_TRUST_TIERS, "trust_tier");

  const licenseClass = input.licenseClass ?? "free";
  const canonicalUrl = canonicalizeNewsUrl(input.canonicalUrl);

  return persistKindedSource(deps, {
    provider: input.provider,
    kind: "article",
    canonicalUrl,
    trustTier,
    licenseClass,
    bytes: input.bytes,
    document: {
      title: input.title,
      author: input.author,
      provider_doc_id: input.providerDocId,
      published_at: input.publishedAt,
    },
    retrievedAt: input.retrievedAt,
  });
}

// The kinds these orchestrators use both as source_kind and document_kind.
// Kept narrow (not the full SourceKind union) so adding a new ingest kind
// requires an explicit edit here.
type NewsIngestKind = Extract<SourceKind, "press_release" | "transcript" | "article">;

type PersistInput = {
  provider: string;
  kind: NewsIngestKind;
  canonicalUrl: string;
  trustTier: TrustTier;
  licenseClass: string;
  bytes: Uint8Array;
  document: Omit<DocumentInput, "source_id" | "content_hash" | "raw_blob_id" | "kind">;
  retrievedAt?: string;
};

async function persistKindedSource(
  deps: IngestDeps,
  input: PersistInput,
): Promise<IngestResult> {
  const source = await createSource(deps.db, {
    provider: input.provider,
    kind: input.kind,
    canonical_url: input.canonicalUrl,
    trust_tier: input.trustTier,
    license_class: input.licenseClass,
    retrieved_at: input.retrievedAt ?? new Date().toISOString(),
  });

  const ingest = await ingestDocument(
    { db: deps.db, objectStore: deps.objectStore },
    {
      source: { source_id: source.source_id, license_class: source.license_class },
      bytes: input.bytes,
      document: { ...input.document, kind: input.kind },
    },
  );

  return Object.freeze({ source, ingest });
}

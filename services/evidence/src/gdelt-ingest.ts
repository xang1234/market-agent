import { assertSubjectRef, type SubjectRef } from "../../shared/src/subject-ref.ts";
import type {
  ReaderExtractionToolName,
  ReaderToolHandler,
  ReaderToolOutput,
} from "../../tools/src/reader-tool-dispatcher.ts";
import type { JsonObject } from "../../tools/src/registry.ts";
import {
  GDELT_ARTICLE_DISCOVERY_PROVIDER,
  GDELT_DISCOVERY_LICENSE_CLASS,
  GDELT_DISCOVERY_SOURCE_KIND,
  GDELT_DISCOVERY_TRUST_TIER,
} from "./gdelt-source.ts";
import { ingestDocument, type IngestDocumentResult } from "./ingest.ts";
import type { DocumentRow } from "./document-repo.ts";
import { createMention } from "./mention-repo.ts";
import type { ObjectStore } from "./object-store.ts";
import type {
  GdeltArticleDiscovery,
  GdeltArticleDiscoveryRequest,
  GdeltArticleDiscoveryResult,
} from "./providers/gdelt.ts";
import {
  createSource,
  deleteSource,
  type SourceRow,
} from "./source-repo.ts";
import type { QueryExecutor } from "./types.ts";
import {
  assertIso8601WithOffset,
  assertNonEmptyString,
  assertOptionalNonEmptyString,
} from "./validators.ts";

export const GDELT_ROUTED_READER_TOOL_NAMES = Object.freeze([
  "extract_mentions",
  "extract_claims",
  "extract_events",
  "classify_sentiment",
] as const satisfies ReadonlyArray<ReaderExtractionToolName>);

export type GdeltRoutedReaderToolName = (typeof GDELT_ROUTED_READER_TOOL_NAMES)[number];

export type GdeltArticleDiscoveryClient = {
  searchArticles(request: GdeltArticleDiscoveryRequest): Promise<GdeltArticleDiscoveryResult>;
};

export type GdeltSubject = {
  subjectRef: SubjectRef;
  issuerName: string;
  ticker?: string;
  aliases?: ReadonlyArray<string>;
};

export type GdeltReaderToolMap = Partial<Record<GdeltRoutedReaderToolName, ReaderToolHandler>>;

export type IngestGdeltArticleDiscoveriesDeps = {
  db: QueryExecutor;
  objectStore: ObjectStore;
  discoveryClient: GdeltArticleDiscoveryClient;
  readerTools?: GdeltReaderToolMap;
};

export type IngestGdeltArticleDiscoveriesInput =
  Omit<GdeltArticleDiscoveryRequest, "query" | "mode"> & {
    subject: GdeltSubject;
    retrievedAt?: string;
  };

export type GdeltArticleSkipReason =
  | "domain_mismatch"
  | "language_mismatch"
  | "irrelevant_subject_match";

export type GdeltReaderToolRun =
  | Readonly<{
      toolName: GdeltRoutedReaderToolName;
      ok: true;
      output: ReaderToolOutput;
    }>
  | Readonly<{
      toolName: GdeltRoutedReaderToolName;
      ok: false;
      error: string;
    }>;

export type GdeltArticleIngestRecord = Readonly<{
  article: GdeltArticleDiscovery;
  source: SourceRow;
  document: DocumentRow;
  ingest: IngestDocumentResult | null;
  status: "created" | "already_present";
  readerToolRuns: ReadonlyArray<GdeltReaderToolRun>;
}>;

export type IngestGdeltArticleDiscoveriesResult = Readonly<{
  query: string;
  request: GdeltArticleDiscoveryRequest;
  requestUrl: string;
  retrievedAt: string;
  articles: ReadonlyArray<GdeltArticleIngestRecord>;
  skipped: ReadonlyArray<Readonly<{
    article: GdeltArticleDiscovery;
    reason: GdeltArticleSkipReason;
  }>>;
}>;

type ExistingGdeltArticle = Readonly<{
  source: SourceRow;
  document: DocumentRow;
}>;

type JoinedGdeltArticleRow = {
  s_source_id: string;
  s_provider: string;
  s_kind: SourceRow["kind"];
  s_canonical_url: string | null;
  s_trust_tier: SourceRow["trust_tier"];
  s_license_class: string;
  s_retrieved_at: Date | string;
  s_content_hash: string | null;
  s_user_id: string | null;
  s_created_at: Date | string;
  d_document_id: string;
  d_source_id: string;
  d_provider_doc_id: string | null;
  d_kind: DocumentRow["kind"];
  d_parent_document_id: string | null;
  d_conversation_id: string | null;
  d_title: string | null;
  d_author: string | null;
  d_published_at: Date | string | null;
  d_lang: string | null;
  d_content_hash: string;
  d_raw_blob_id: string;
  d_parse_status: DocumentRow["parse_status"];
  d_deleted_at: Date | string | null;
  d_created_at: Date | string;
  d_updated_at: Date | string;
};

const MARKET_CONTEXT_RE =
  /\b(stock|stocks|share|shares|equity|equities|earnings|revenue|guidance|analyst|analysts|investor|investors|nasdaq|nyse|market|markets)\b/i;

export async function ingestGdeltArticleDiscoveries(
  deps: IngestGdeltArticleDiscoveriesDeps,
  input: IngestGdeltArticleDiscoveriesInput,
): Promise<IngestGdeltArticleDiscoveriesResult> {
  validateIngestInput(input);

  const query = buildGdeltSubjectArticleQuery(input.subject);
  const request: GdeltArticleDiscoveryRequest = Object.freeze({
    query,
    ...(input.maxRecords !== undefined ? { maxRecords: input.maxRecords } : {}),
    ...(input.sort !== undefined ? { sort: input.sort } : {}),
    ...(input.timespan !== undefined ? { timespan: input.timespan } : {}),
    ...(input.startDateTime !== undefined ? { startDateTime: input.startDateTime } : {}),
    ...(input.endDateTime !== undefined ? { endDateTime: input.endDateTime } : {}),
    ...(input.searchLanguage !== undefined ? { searchLanguage: input.searchLanguage } : {}),
    ...(input.domains !== undefined ? { domains: input.domains } : {}),
  });
  const discovery = await deps.discoveryClient.searchArticles(request);
  const retrievedAt = normalizeRetrievedAt(input.retrievedAt ?? discovery.retrievedAt);

  const articles: GdeltArticleIngestRecord[] = [];
  const skipped: Array<{ article: GdeltArticleDiscovery; reason: GdeltArticleSkipReason }> = [];
  for (const article of discovery.articles) {
    const reason = skipReason(article, input);
    if (reason) {
      skipped.push({ article, reason });
      continue;
    }

    const persisted = await persistGdeltArticle(deps, {
      article,
      subject: input.subject,
      query,
      retrievedAt,
      requestUrl: discovery.requestUrl,
    });
    const readerToolRuns = await routeReaderTools(deps.readerTools, {
      article,
      subject: input.subject,
      query,
      document: persisted.document,
    });
    await createDiscoveryMention(deps.db, {
      article,
      subject: input.subject,
      document: persisted.document,
    });
    articles.push(Object.freeze({ ...persisted, readerToolRuns }));
  }

  return Object.freeze({
    query,
    request,
    requestUrl: discovery.requestUrl,
    retrievedAt,
    articles: Object.freeze(articles),
    skipped: Object.freeze(skipped.map((item) => Object.freeze(item))),
  });
}

export function buildGdeltSubjectArticleQuery(subject: GdeltSubject): string {
  validateSubject(subject);

  const phraseParts = subjectPhrases(subject).map((phrase) => `"${phrase}"`);
  const ticker = normalizeTicker(subject.ticker);
  if (ticker) {
    phraseParts.push(`(${ticker} stock OR ${ticker} shares OR $${ticker})`);
  }
  return phraseParts.length === 1 ? phraseParts[0] : `(${phraseParts.join(" OR ")})`;
}

function validateIngestInput(input: IngestGdeltArticleDiscoveriesInput): void {
  validateSubject(input.subject);
  if (input.retrievedAt !== undefined) {
    assertIso8601WithOffset(input.retrievedAt, "retrieved_at");
  }
}

function validateSubject(subject: GdeltSubject): void {
  assertSubjectRef(subject.subjectRef, "subject");
  assertNonEmptyString(subject.issuerName, "issuerName");
  assertNormalizedPhrase(subject.issuerName, "issuerName");
  assertOptionalNonEmptyString(subject.ticker, "ticker");
  if (subject.ticker !== undefined) {
    assertTickerSyntax(subject.ticker);
  }
  for (const [index, alias] of (subject.aliases ?? []).entries()) {
    assertNonEmptyString(alias, `aliases[${index}]`);
    assertNormalizedPhrase(alias, `aliases[${index}]`);
  }
}

function subjectPhrases(subject: GdeltSubject): ReadonlyArray<string> {
  const phrases: string[] = [];
  const seen = new Set<string>();
  for (const raw of [subject.issuerName, ...(subject.aliases ?? [])]) {
    const phrase = normalizePhrase(raw);
    const key = phrase.toLowerCase();
    if (!seen.has(key)) {
      phrases.push(phrase);
      seen.add(key);
    }
  }
  return Object.freeze(phrases);
}

function normalizePhrase(value: string): string {
  return value.replace(/["“”]/g, " ").trim().replace(/\s+/g, " ");
}

function normalizeTicker(value: string | undefined): string | null {
  if (value === undefined) return null;
  const ticker = value.trim().toUpperCase();
  return ticker.length === 0 ? null : ticker;
}

function assertTickerSyntax(value: string): void {
  const ticker = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9.-]{0,15}$/.test(ticker)) {
    throw new Error("ticker: must contain only letters, digits, dot, or dash");
  }
}

function assertNormalizedPhrase(value: string, label: string): void {
  if (normalizePhrase(value).length === 0) {
    throw new Error(`${label}: must contain searchable text`);
  }
}

function skipReason(
  article: GdeltArticleDiscovery,
  input: IngestGdeltArticleDiscoveriesInput,
): GdeltArticleSkipReason | null {
  if (input.domains && input.domains.length > 0 && !domainMatches(article, input.domains)) {
    return "domain_mismatch";
  }
  if (input.searchLanguage !== undefined && !languageMatches(article.language, input.searchLanguage)) {
    return "language_mismatch";
  }
  if (!articleMatchesSubject(article, input.subject)) {
    return "irrelevant_subject_match";
  }
  return null;
}

function domainMatches(article: GdeltArticleDiscovery, domains: ReadonlyArray<string>): boolean {
  const articleDomain = normalizeDomain(article.domain ?? domainFromUrl(article.url));
  return domains.some((domain) => {
    const allowed = normalizeDomain(domain);
    return articleDomain === allowed || articleDomain.endsWith(`.${allowed}`);
  });
}

function languageMatches(articleLanguage: string | null, requestedLanguage: string): boolean {
  if (!articleLanguage) return false;
  return normalizeLanguage(articleLanguage) === normalizeLanguage(requestedLanguage);
}

function articleMatchesSubject(article: GdeltArticleDiscovery, subject: GdeltSubject): boolean {
  const text = searchableText(article);
  const normalizedText = normalizeSearchText(text);

  for (const phrase of subjectPhrases(subject)) {
    if (containsNormalizedPhrase(normalizedText, phrase)) {
      return true;
    }
  }

  const ticker = normalizeTicker(subject.ticker);
  if (!ticker) return false;
  const tickerRe = new RegExp(`(^|[^A-Za-z0-9])\\$?${escapeRegExp(ticker)}(?=$|[^A-Za-z0-9])`, "i");
  return tickerRe.test(text) && MARKET_CONTEXT_RE.test(text);
}

async function persistGdeltArticle(
  deps: IngestGdeltArticleDiscoveriesDeps,
  input: {
    article: GdeltArticleDiscovery;
    subject: GdeltSubject;
    query: string;
    retrievedAt: string;
    requestUrl: string;
  },
): Promise<Omit<GdeltArticleIngestRecord, "readerToolRuns">> {
  const existing = await findExistingGdeltArticle(deps.db, input.article.url);
  if (existing) {
    return Object.freeze({
      article: input.article,
      source: existing.source,
      document: existing.document,
      ingest: null,
      status: "already_present" as const,
    });
  }

  const source = await createSource(deps.db, {
    provider: GDELT_ARTICLE_DISCOVERY_PROVIDER,
    kind: GDELT_DISCOVERY_SOURCE_KIND,
    canonical_url: input.article.url,
    trust_tier: GDELT_DISCOVERY_TRUST_TIER,
    license_class: GDELT_DISCOVERY_LICENSE_CLASS,
    retrieved_at: input.retrievedAt,
    content_hash: input.article.providerMetadataHash,
  });

  let ingest: IngestDocumentResult;
  try {
    ingest = await ingestDocument(
      { db: deps.db, objectStore: deps.objectStore },
      {
        source: { source_id: source.source_id, license_class: source.license_class },
        bytes: buildGdeltMetadataDocumentBytes(input),
        document: {
          provider_doc_id: input.article.providerMetadataHash,
          kind: "article",
          title: input.article.title,
          author: input.article.domain ?? undefined,
          published_at: input.article.seenAt,
          lang: input.article.language ?? undefined,
        },
      },
    );
  } catch (error) {
    await cleanupSourceAfterFailedIngest(deps.db, source.source_id, error);
  }

  return Object.freeze({
    article: input.article,
    source,
    document: ingest.document,
    ingest,
    status: "created" as const,
  });
}

async function findExistingGdeltArticle(
  db: QueryExecutor,
  canonicalUrl: string,
): Promise<ExistingGdeltArticle | null> {
  const { rows } = await db.query<JoinedGdeltArticleRow>(
    `select s.source_id::text as s_source_id,
            s.provider as s_provider,
            s.kind as s_kind,
            s.canonical_url as s_canonical_url,
            s.trust_tier as s_trust_tier,
            s.license_class as s_license_class,
            s.retrieved_at as s_retrieved_at,
            s.content_hash as s_content_hash,
            s.user_id::text as s_user_id,
            s.created_at as s_created_at,
            d.document_id::text as d_document_id,
            d.source_id::text as d_source_id,
            d.provider_doc_id as d_provider_doc_id,
            d.kind as d_kind,
            d.parent_document_id::text as d_parent_document_id,
            d.conversation_id as d_conversation_id,
            d.title as d_title,
            d.author as d_author,
            d.published_at as d_published_at,
            d.lang as d_lang,
            d.content_hash as d_content_hash,
            d.raw_blob_id as d_raw_blob_id,
            d.parse_status as d_parse_status,
            d.deleted_at as d_deleted_at,
            d.created_at as d_created_at,
            d.updated_at as d_updated_at
       from documents d
       join sources s on s.source_id = d.source_id
      where s.provider = $1
        and s.canonical_url = $2
        and s.kind = $3
        and s.license_class = $4
        and d.kind = 'article'
        and d.deleted_at is null
      order by d.created_at asc, d.document_id asc
      limit 1`,
    [
      GDELT_ARTICLE_DISCOVERY_PROVIDER,
      canonicalUrl,
      GDELT_DISCOVERY_SOURCE_KIND,
      GDELT_DISCOVERY_LICENSE_CLASS,
    ],
  );
  const row = rows[0];
  return row ? Object.freeze({ source: sourceFromJoinedRow(row), document: documentFromJoinedRow(row) }) : null;
}

async function routeReaderTools(
  readerTools: GdeltReaderToolMap | undefined,
  input: {
    article: GdeltArticleDiscovery;
    subject: GdeltSubject;
    query: string;
    document: DocumentRow;
  },
): Promise<ReadonlyArray<GdeltReaderToolRun>> {
  if (!readerTools) return Object.freeze([]);

  const runs: GdeltReaderToolRun[] = [];
  const schema_hint = buildReaderSchemaHint(input);
  for (const toolName of GDELT_ROUTED_READER_TOOL_NAMES) {
    const handler = readerTools[toolName];
    if (!handler) continue;
    try {
      const output = await handler({ document_id: input.document.document_id, schema_hint });
      runs.push(Object.freeze({ toolName, ok: true as const, output }));
    } catch (error) {
      runs.push(Object.freeze({ toolName, ok: false as const, error: errorMessage(error) }));
    }
  }
  return Object.freeze(runs);
}

async function createDiscoveryMention(
  db: QueryExecutor,
  input: {
    article: GdeltArticleDiscovery;
    subject: GdeltSubject;
    document: DocumentRow;
  },
): Promise<void> {
  await createMention(db, {
    document_id: input.document.document_id,
    subject_kind: input.subject.subjectRef.kind,
    subject_id: input.subject.subjectRef.id,
    prominence: discoveryMentionProminence(input.article, input.subject),
    mention_count: 1,
    confidence: 0.6,
  });
}

function discoveryMentionProminence(
  article: GdeltArticleDiscovery,
  subject: GdeltSubject,
): "headline" | "lead" | "incidental" {
  const titleText = normalizeSearchText(article.title);
  for (const phrase of subjectPhrases(subject)) {
    if (containsNormalizedPhrase(titleText, phrase)) return "headline";
  }
  const snippetText = normalizeSearchText(article.snippet ?? "");
  for (const phrase of subjectPhrases(subject)) {
    if (containsNormalizedPhrase(snippetText, phrase)) return "lead";
  }
  return "incidental";
}

function buildReaderSchemaHint(input: {
  article: GdeltArticleDiscovery;
  subject: GdeltSubject;
  query: string;
}): JsonObject {
  return Object.freeze({
    provider: GDELT_ARTICLE_DISCOVERY_PROVIDER,
    storage_policy: "metadata_only",
    allowed_text: allowedReaderText(input.article),
    query: input.query,
    subject_ref: Object.freeze({
      kind: input.subject.subjectRef.kind,
      id: input.subject.subjectRef.id,
    }),
    article: Object.freeze(articleMetadata(input.article)),
  });
}

function buildGdeltMetadataDocumentBytes(input: {
  article: GdeltArticleDiscovery;
  subject: GdeltSubject;
  query: string;
  requestUrl: string;
}): Uint8Array {
  const payload = Object.freeze({
    provider: GDELT_ARTICLE_DISCOVERY_PROVIDER,
    storage_policy: "metadata_only",
    subject_ref: Object.freeze({
      kind: input.subject.subjectRef.kind,
      id: input.subject.subjectRef.id,
    }),
    query: input.query,
    request_url: input.requestUrl,
    article: Object.freeze(articleMetadata(input.article)),
  });
  return new TextEncoder().encode(JSON.stringify(payload));
}

function articleMetadata(article: GdeltArticleDiscovery): JsonObject {
  return Object.freeze({
    url: article.url,
    title: article.title,
    seen_at: article.seenAt,
    domain: article.domain,
    language: article.language,
    source_country: article.sourceCountry,
    snippet: article.snippet,
    image_url: article.imageUrl,
    provider_metadata_hash: article.providerMetadataHash,
  });
}

function allowedReaderText(article: GdeltArticleDiscovery): string {
  return [article.title, article.snippet].filter((value): value is string => Boolean(value)).join("\n\n");
}

function searchableText(article: GdeltArticleDiscovery): string {
  return [article.title, article.snippet, article.domain].filter((value): value is string => Boolean(value)).join(" ");
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9$]+/g, " ").trim().replace(/\s+/g, " ");
}

function containsNormalizedPhrase(normalizedText: string, phrase: string): boolean {
  return ` ${normalizedText} `.includes(` ${normalizeSearchText(phrase)} `);
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^www\./, "");
}

function domainFromUrl(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

function normalizeLanguage(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function normalizeRetrievedAt(retrievedAt: string): string {
  assertIso8601WithOffset(retrievedAt, "retrieved_at");
  return new Date(retrievedAt).toISOString();
}

async function cleanupSourceAfterFailedIngest(
  db: QueryExecutor,
  sourceId: string,
  ingestError: unknown,
): Promise<never> {
  try {
    await deleteSource(db, sourceId);
  } catch (cleanupError) {
    throw new AggregateError(
      [ingestError, cleanupError],
      `GDELT article ingest failed and source cleanup failed for ${sourceId}`,
    );
  }
  throw ingestError;
}

function sourceFromJoinedRow(row: JoinedGdeltArticleRow): SourceRow {
  return Object.freeze({
    source_id: row.s_source_id,
    provider: row.s_provider,
    kind: row.s_kind,
    canonical_url: row.s_canonical_url,
    trust_tier: row.s_trust_tier,
    license_class: row.s_license_class,
    retrieved_at: isoString(row.s_retrieved_at),
    content_hash: row.s_content_hash,
    user_id: row.s_user_id,
    created_at: isoString(row.s_created_at),
  });
}

function documentFromJoinedRow(row: JoinedGdeltArticleRow): DocumentRow {
  return Object.freeze({
    document_id: row.d_document_id,
    source_id: row.d_source_id,
    provider_doc_id: row.d_provider_doc_id,
    kind: row.d_kind,
    parent_document_id: row.d_parent_document_id,
    conversation_id: row.d_conversation_id,
    title: row.d_title,
    author: row.d_author,
    published_at: nullableIsoString(row.d_published_at),
    lang: row.d_lang,
    content_hash: row.d_content_hash,
    raw_blob_id: row.d_raw_blob_id,
    parse_status: row.d_parse_status,
    deleted_at: nullableIsoString(row.d_deleted_at),
    created_at: isoString(row.d_created_at),
    updated_at: isoString(row.d_updated_at),
  });
}

function nullableIsoString(value: Date | string | null): string | null {
  return value === null ? null : isoString(value);
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
